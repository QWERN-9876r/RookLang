import type * as ast from '../ast.ts';
import { isChan } from '../checker/channel.ts';
import { asyncIterated, isMap } from '../checker/iterables.ts';
import { isTopic, typedArrayOf } from '../checker/types.ts';
import { declaredIn } from '../names.ts';
import { containsBreak } from '../breaks.ts';
import { declarationsOf, endsWithJump, type BindingKind } from './analysis.ts';
import { SimpleStatementEmitter } from './simple-statements.ts';
import { ARROW, BINARY, POSTFIX } from './syntax.ts';

/** if, for, switch and try. */

/** Names that keep their value, so a loop over the indexes may read the array through them. */
const FIXED: ReadonlySet<BindingKind> = new Set(['const', 'import', 'loop']);

export abstract class ControlStatementEmitter extends SimpleStatementEmitter {
  protected override ifStatement(node: ast.IfStatement): string {
    const { init } = node;

    if (init)
      return this.withInit(init, () => this.line(this.ifStatement({ ...node, init: null })));

    let text = `if (${this.expression(node.condition, 0)}) ${this.blockStatement(node.consequent)}`;

    if (node.alternate?.kind === 'IfStatement') {
      // The condition of `else if` is evaluated only when the first one is false.
      const alternate = node.alternate;

      text += ` else ${this.withHoisting(false, () => this.ifStatement(alternate))}`;
    } else if (node.alternate) {
      text += ` else ${this.blockStatement(node.alternate)}`;
    }

    return text;
  }

  /**
   * `if const v = f(); v > 0 { }` → `{ const v = f(); if (v > 0) { } }`: a block keeps the
   * variables of the initializer to the statement, which `emit` writes.
   */
  private withInit(init: ast.VariableDeclaration, emit: () => void): string {
    return this.block(() =>
      this.withScope(declarationsOf([init]), () => {
        this.statement(init);
        this.withHoisting(true, emit);
      }),
    );
  }

  /** `outer: for (...)`: the label goes on the loop itself, after what is hoisted before it. */
  private labeled(node: ast.LabeledStatement, text: string): string {
    return node.label ? `${this.label(node.label)}: ${text}` : text;
  }

  protected loopBody(body: ast.BlockStatement): string {
    return this.withBreakTarget(null, () => this.blockStatement(body));
  }

  protected override forStatement(node: ast.ForStatement): void {
    const bindings =
      node.init?.kind === 'VariableDeclaration'
        ? node.init.names.map((name): [string, BindingKind] => [name.name, 'let'])
        : [];

    this.withScope(bindings, () => {
      const init = node.init ? this.simpleStatement(node.init) : '';
      // The condition and the update run on every iteration.
      const [condition, update] = this.withHoisting(false, () => [
        node.condition ? this.expression(node.condition, 0) : '',
        node.update ? this.simpleStatement(node.update) : '',
      ]);

      if (node.init === null && node.update === null) {
        this.line(this.labeled(node, `while (${condition || 'true'}) ${this.loopBody(node.body)}`));

        return;
      }

      this.line(
        this.labeled(node, `for (${init}; ${condition}; ${update}) ${this.loopBody(node.body)}`),
      );
    });
  }

  /** A statement inside a `for` header, without the `;`. */
  protected simpleStatement(node: ast.SimpleStatement): string {
    switch (node.kind) {
      case 'VariableDeclaration':
        return this.variableDeclaration(node);

      case 'AssignmentStatement':
        return this.assignment(node);

      case 'IncDecStatement':
        return `${this.expression(node.target, POSTFIX)}${node.operator}`;

      case 'DeleteStatement':
        return `delete ${this.expression(node.target, POSTFIX)}`;

      case 'ExpressionStatement':
        return this.expression(node.expression, 0);

      case 'SendStatement':
        return this.send(node);
    }
  }

  /**
   * `for x in xs` → `for (const x of xs)`, `m.values()` for a Map, `seq()` for an iterator;
   * `for i, x in xs` iterates `xs.entries()`, which gives the keys and values of a Map too.
   */
  protected override forInStatement(node: ast.ForInStatement): void {
    const bindings: [string, BindingKind][] = [[node.value.name, 'loop']];

    if (node.key) bindings.push([node.key.name, 'loop']);
    this.withScope(bindings, () => {
      const value = this.name(node.value.name);
      const iterable = this.options.types?.get(node.iterable);
      let head: string;

      // An async iterable, such as a stream of Node, gives its values as their Promises do.
      if (iterable && asyncIterated(iterable) !== null) {
        this.line(
          this.labeled(
            node,
            `for await (const ${value} of ${this.expression(node.iterable, POSTFIX)}) ${this.loopBody(node.body)}`,
          ),
        );

        return;
      }

      // A channel gives its values as they come, until it is closed, and so does a topic.
      if (iterable && (isChan(iterable) || isTopic(iterable))) {
        this.line(
          this.labeled(
            node,
            `for await (const ${value} of $$Channel.range(${this.receivedFrom(node.iterable)})) ${this.loopBody(node.body)}`,
          ),
        );

        return;
      }

      // An iterator is a generator function: called, it gives a lazy JS iterator, of pairs if its
      // yield takes two values.
      if (iterable?.kind === 'function' && iterable.iterator) {
        const yieldType = iterable.params[0];
        const pairs = yieldType?.kind === 'function' && yieldType.params.length === 2;
        const key = node.key && node.key.name !== '_' ? this.name(node.key.name) : '';
        const values = `${this.expression(node.iterable, POSTFIX)}()`;

        head = pairs ? `const [${key}, ${value}] of ${values}` : `const ${value} of ${values}`;
      } else if (node.key === null) {
        // A Map gives its values; an untyped value may be a Map, which only the runtime tells.
        // Code that was not checked is taken as it is written.
        const untyped = iterable?.kind === 'any' || iterable?.kind === 'unknown';
        let values = this.expression(node.iterable, untyped ? ARROW : POSTFIX);

        if (iterable && isMap(iterable)) values += '.values()';
        else if (untyped) {
          values = `$$values(${values})`;
        }

        head = `const ${value} of ${values}`;
      } else if (
        iterable &&
        (iterable.kind === 'array' || iterable.kind === 'string' || typedArrayOf(iterable) !== null)
      ) {
        // Without the index, the loop goes over the values.
        if (node.key.name === '_' && node.value.name !== '_') {
          head = `const ${value} of ${this.expression(node.iterable, POSTFIX)}`;
        } else if (iterable.kind === 'string') {
          // A string has no entries(): its characters, as `for...of` gives them, are numbered.
          const pair = this.pair(node.key, node.value);

          head = `const ${pair} of Array.from(${this.expression(node.iterable, ARROW)}).entries()`;
        } else {
          this.indexLoop(node, node.key);

          return;
        }
      } else {
        head = `const ${this.pair(node.key, node.value)} of ${this.expression(node.iterable, POSTFIX)}.entries()`;
      }

      this.line(this.labeled(node, `for (${head}) ${this.loopBody(node.body)}`));
    });
  }

  /** `[i, v]` of a loop over pairs; `_` leaves its place empty. */
  private pair(key: ast.Identifier, value: ast.Identifier): string {
    const name = key.name === '_' ? '' : this.name(key.name);

    return value.name === '_' ? `[${name}]` : `[${name}, ${this.name(value.name)}]`;
  }

  /**
   * `for i, v in items` over an array or a typed array: a loop over the indexes, which runs faster
   * than one over the pairs of `entries()`. The variables of the loop cannot be assigned, so `i` is
   * the counter itself. The array is read once, as `entries()` reads it, into `$$items` unless it is
   * a name that cannot change.
   */
  private indexLoop(node: ast.ForInStatement, keyNode: ast.Identifier): void {
    const key = keyNode.name === '_' ? '$$i' : this.name(keyNode.name);
    const value = node.value.name === '_' ? null : this.name(node.value.name);
    const { iterable } = node;
    const fixed = iterable.kind === 'Identifier' && FIXED.has(this.lookup(iterable.name) ?? 'let');
    const items = fixed ? this.expression(iterable, POSTFIX) : '$$items';
    const init = fixed ? '' : `, $$items = ${this.expression(iterable, ARROW)}`;
    // A declaration of the same name in the body would clash with the element's in one block.
    const hidden = declaredIn(node.body.body).some(
      (name) => name === keyNode.name || name === node.value.name,
    );
    const body = this.withBreakTarget(null, () =>
      this.block(() => {
        if (value !== null) this.line(`const ${value} = ${items}[${key}];`);
        if (hidden) this.line(this.blockStatement(node.body));
        else this.blockStatements(node.body.body);
      }),
    );

    this.line(
      this.labeled(node, `for (let ${key} = 0${init}; ${key} < ${items}.length; ${key}++) ${body}`),
    );
  }

  protected override switchStatement(node: ast.SwitchStatement): void {
    const { init, discriminant } = node;

    if (init) {
      this.line(this.withInit(init, () => this.switchStatement({ ...node, init: null })));
    } else if (discriminant === null) this.taglessSwitch(node);
    else this.valueSwitch(node, discriminant);
  }

  /** Each `case` ends with an implicit `break`; a case with declarations gets its own block. */
  private valueSwitch(node: ast.SwitchStatement, discriminant: ast.Expression): void {
    const head = `switch (${this.expression(discriminant, 0)})`;
    const body = this.withBreakTarget(null, () =>
      this.block(() => {
        node.cases.forEach((switchCase, i) => {
          // Case values are evaluated only until one matches.
          const labels =
            switchCase.tests.length === 0
              ? ['default:']
              : this.withHoisting(false, () =>
                  switchCase.tests.map((test) => `case ${this.expression(test, 0)}:`),
                );

          for (const label of labels.slice(0, -1)) this.line(label);

          const isLast = i === node.cases.length - 1;
          const needsBreak = !isLast && !endsWithJump(switchCase.body);
          const declarations = declarationsOf(switchCase.body);
          const lines = this.capture(() => {
            this.withScope(declarations, () => this.statements(switchCase.body));
            if (needsBreak) this.line('break;');
          });

          if (declarations.length > 0) {
            this.line(`${labels.at(-1)} {\n${lines.join('\n')}\n${this.indent()}}`);
          } else {
            this.line(labels.at(-1)!);
            this.lines.push(...lines);
          }
        });
      }),
    );

    this.line(this.labeled(node, `${head} ${body}`));
  }

  /**
   * `select`: $$select gives the index of the case that went on and what it received, and a
   * switch runs the case; a `break` inside it leaves the select, as in Go. `default` is -1.
   */
  protected override selectStatement(node: ast.SelectStatement): void {
    const operations = node.cases.flatMap(({ operation }) => {
      if (operation === null) return [];
      if (operation.kind === 'UnaryExpression') {
        const zero = this.receivedZero(operation.argument);

        return [
          `{ channel: ${this.receivedFrom(operation.argument)}${zero !== 'null' ? `, zero: ${zero}` : ''} }`,
        ];
      }

      const channel = this.expression(operation.channel, ARROW);

      return [`{ channel: ${channel}, value: ${this.expression(operation.value, ARROW)} }`];
    });
    const hasDefault = node.cases.some((selectCase) => selectCase.operation === null);
    let index = 0;
    const select = this.block(() => {
      this.line(
        `const [$$case, $$received, $$ok] = await $$Channel.select([${operations.join(', ')}], ${hasDefault});`,
      );

      const body = this.withBreakTarget(null, () =>
        this.block(() => {
          for (const { names, operation, body: statements } of node.cases) {
            const label = operation === null ? 'default:' : `case ${index++}:`;
            const variables = names.filter((name) => name.name !== '_');
            const bindings: [string, BindingKind][] = [
              ...variables.map((name): [string, BindingKind] => [name.name, 'const']),
              ...declarationsOf(statements),
            ];
            const lines = this.capture(() => {
              this.withScope(bindings, () => {
                names.forEach((name, i) => {
                  if (name.name === '_') return;
                  this.line(`const ${this.name(name.name)} = ${i === 0 ? '$$received' : '$$ok'};`);
                });
                this.statements(statements);
                if (!endsWithJump(statements)) this.line('break;');
              });
            });

            this.line(`${label} {\n${lines.join('\n')}\n${this.indent()}}`);
          }
        }),
      );

      this.line(`switch ($$case) ${body}`);
    });

    this.line(this.labeled(node, select));
  }

  /**
   * `switch { case cond: ... }` becomes an if/else chain. A `break` inside it must leave the
   * switch, not an enclosing loop, so then the chain gets a label to break to.
   */
  private taglessSwitch(node: ast.SwitchStatement): void {
    const cases = node.cases.filter((switchCase) => switchCase.tests.length > 0);
    const fallback = node.cases.find((switchCase) => switchCase.tests.length === 0);
    const label = node.label
      ? this.label(node.label)
      : node.cases.some((switchCase) => containsBreak(switchCase.body))
        ? `$$switch${++this.labels}`
        : null;

    const text = this.withBreakTarget(label, () => {
      const caseBlock = (body: ast.Statement[]) => this.block(() => this.blockStatements(body));
      const branches = cases.map((switchCase) => {
        // Later conditions are evaluated only if the earlier ones are false.
        const condition = this.withHoisting(false, () =>
          switchCase.tests.length === 1
            ? this.expression(switchCase.tests[0]!, 0)
            : switchCase.tests.map((test) => this.expression(test, BINARY['||'] + 1)).join(' || '),
        );

        return `if (${condition}) ${caseBlock(switchCase.body)}`;
      });

      if (fallback) branches.push(caseBlock(fallback.body));

      return branches.join(' else ');
    });

    if (text === '') return;
    this.line(label ? `${label}: ${text}` : text);
  }

  protected override tryStatement(node: ast.TryStatement): string {
    let text = `try ${this.blockStatement(node.block)}`;
    const { handler } = node;

    if (handler) {
      const param = handler.param;
      const bindings: [string, BindingKind][] = param ? [[param.name, 'catch']] : [];

      text += this.withScope(bindings, () => {
        const head = param ? ` catch (${this.name(param.name)})` : ' catch';

        return `${head} ${this.blockStatement(handler.body)}`;
      });
    }

    if (node.finalizer) text += ` finally ${this.blockStatement(node.finalizer)}`;

    return text;
  }
}
