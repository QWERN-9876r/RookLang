import type * as ast from '../ast.ts';
import { guardedByError } from './error-results.ts';
import { AssignmentChecker } from './assignments.ts';
import { placeOf, type Binding } from './context.ts';
import { isTerminating } from './flow.ts';
import { isUntyped, isNumeric, ownStatements } from './helpers.ts';
import {
  func,
  hasZeroValue,
  isNullable,
  nonNull,
  nullable,
  typeToString,
  UNKNOWN,
  type Type,
} from './types.ts';

// Statements: declarations of variables, blocks, `mount`, `effect`. Assignments and `return`
// are in assignments.ts.

export abstract class StatementChecker extends AssignmentChecker {
  /** `ch <- value`; implemented by ChannelChecker. */
  protected abstract checkSend(node: ast.SendStatement): void;

  /** `select { ... }`; implemented by ChannelChecker. */
  protected abstract checkSelect(node: ast.SelectStatement): void;

  protected override checkStatement(node: ast.Statement): void {
    switch (node.kind) {
      case 'VariableDeclaration':
        this.checkVariableDeclaration(node);
        break;

      case 'BlockStatement':
        this.checkBlock(node.body);
        break;

      case 'ExpressionStatement':
        this.checkExpression(node.expression, null);
        break;

      case 'JsxElementStatement':
        this.checkExpression(node.element, null);
        break;

      case 'AssignmentStatement':
        this.checkAssignment(node);
        break;

      case 'DeleteStatement':
        this.checkDelete(node);
        break;

      case 'SendStatement':
        this.checkSend(node);
        break;

      case 'SelectStatement':
        this.checkSelect(node);
        break;

      case 'IncDecStatement': {
        const type = this.checkTarget(node.target);

        if (!isNumeric(type) && type.kind !== 'bigint') {
          this.error(`"${node.operator}" needs a number, not ${typeToString(type)}`, node.target);
        }

        this.forget(node.target);
        break;
      }

      case 'ReturnStatement':
        this.checkReturn(node);
        break;

      case 'IfStatement':
        this.checkIf(node);
        break;

      case 'ForStatement':
        this.checkFor(node);
        break;

      case 'ForInStatement':
        this.checkForIn(node);
        break;

      case 'SwitchStatement':
        this.checkSwitch(node);
        break;

      case 'ThrowStatement':
        this.checkValue(node.argument);
        break;

      case 'TryStatement':
        this.checkTry(node);
        break;

      case 'DeferStatement':
        if (node.body.kind === 'BlockStatement') this.checkBlock(node.body.body);
        else this.checkExpression(node.body, null);
        break;

      case 'MountStatement':
        this.checkMount(node);
        break;

      case 'EffectStatement':
        this.checkEffect(node);
        break;

      case 'ImportDeclaration':
      case 'FuncDeclaration':
      case 'ComponentDeclaration':
      case 'DecoratorDeclaration':
      case 'ClassDeclaration':
      case 'InterfaceDeclaration':
      case 'TypeAliasDeclaration':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'StyleStatement':
        // Declarations and styles are handled by declareStatements(); jumps were checked by the
        // parser.
        break;
    }
  }

  /**
   * `effect { ... }`: runs once the markup is created and again when what it reads changes, like
   * a handler. It cleans up with `defer`, so it returns nothing.
   */
  protected checkEffect(node: ast.EffectStatement): void {
    this.checkDeferring(node.body, 'an effect');
  }

  /**
   * `mount { ... }`: a function that runs once the markup is in the document, like a handler. It
   * cleans up with `defer`, as an effect does, so it returns nothing.
   */
  protected checkMount(node: ast.MountStatement): void {
    this.checkDeferring(node.body, 'mount');
  }

  private checkDeferring(body: ast.BlockStatement, what: string): void {
    for (const statement of ownStatements(body)) {
      if (statement.kind === 'ReturnStatement' && statement.values.length > 0) {
        this.error(
          `${what} returns nothing; clean up with defer, e.g. defer clearInterval(timer)`,
          statement.values[0]!,
        );
      }
    }

    this.checkFunction([], func([], []), null, body, { closure: true });
  }

  /**
   * `delete scores[name]` removes a key of an object used as a map, `{ [string]: T }`, or a field
   * that may be missing, of type `?T`; values of type `any` are not checked.
   */
  private checkDelete(node: ast.DeleteStatement): void {
    const { target } = node;

    if (target.kind !== 'MemberExpression' && target.kind !== 'IndexExpression') return;

    const object = nonNull(this.checkValue(target.object));
    const name =
      target.kind === 'MemberExpression'
        ? target.property.name
        : target.index.kind === 'StringLiteral'
          ? target.index.value
          : null;

    if (target.kind === 'IndexExpression') this.checkValue(target.index);
    // `delete user.boss` makes the field null again.
    this.forget(target);
    if (isUntyped(object)) return;
    if (object.kind === 'array') {
      this.error('delete leaves a hole in an array: remove items with splice', node);

      return;
    }

    const field = name === null || object.kind !== 'object' ? undefined : object.members.get(name);

    if (object.kind === 'object' && object.index && !field) return;
    if (field && !field.method && isNullable(field.type)) return;
    this.error(
      name === null
        ? `cannot delete a key of ${typeToString(object)}: it is not a map, { [string]: T }`
        : `cannot delete "${name}" of ${typeToString(object)}: only keys of { [string]: T } and fields of type ?T can be deleted`,
      target,
    );
  }

  protected checkBlock(statements: readonly ast.Statement[]): void {
    this.withScope(() => this.checkStatementList(statements, false));
  }

  protected checkVariableDeclaration(node: ast.VariableDeclaration): void {
    if (node.keyword === 'ref') {
      this.checkRefDeclaration(node);

      return;
    }

    const declared = node.type ? this.resolveType(node.type) : null;
    const { names, values } = node;
    // The variables exist from the start of their declaration, as in JS, so functions in the
    // initializer can use them (initializers.ts). A written type they have right away.
    const bindings = names.map((name) => {
      if (name.name === '_') return null;

      // Top-level variables were declared in advance by declareStatements().
      const existing = this.scope.values.get(name.name);
      const binding =
        existing && existing.type === null && existing.kind === node.keyword
          ? existing
          : this.declareValue(name, node.keyword, null);

      binding.type = declared;

      return binding;
    });

    this.checkInitializer(
      node,
      bindings.filter((binding) => binding !== null),
      () => {
        const types = this.initializerTypes(node, declared);

        bindings.forEach((binding, i) => {
          if (!binding) return;

          const type = types[i] ?? UNKNOWN;

          binding.type = type;

          const value = values.length === names.length ? values[i] : undefined;

          if (value && isNullable(type) && !isNullable(this.typeOfChecked(value))) {
            this.flow.set(placeOf(binding), nonNull(type));
          }
        });
        if (node.keyword === 'const' && !declared) this.linkError(node, bindings);
      },
    );
  }

  /**
   * `const user, err = loadUser(id)` of `(User, error)`: `user` is not null once `err` is found to
   * be null. Variables of `let` may be assigned apart, so only constants are linked.
   */
  private linkError(node: ast.VariableDeclaration, bindings: readonly (Binding | null)[]): void {
    const results = node.values.length === 1 ? this.typeOfChecked(node.values[0]!) : null;
    const error = bindings.at(-1);

    if (results?.kind !== 'tuple' || results.types.length !== bindings.length || !error) return;

    const guarded = guardedByError(results.types).flatMap((i) => bindings[i] ?? []);

    if (guarded.length === 0) return;
    error.guards = guarded;
    for (const binding of guarded) binding.guardedBy = error;
  }

  /** The types of the variables of a declaration: the written one, or those of their values. */
  private initializerTypes(node: ast.VariableDeclaration, declared: Type | null): Type[] {
    const { names, values } = node;
    let types: Type[];

    if (node.body) {
      types = [this.derivedBlockType(names[0]!.name, node.body.body, declared)];
    } else if (values.length === 0) {
      if (declared && !hasZeroValue(declared) && declared.kind !== 'unknown') {
        const type = typeToString(declared);

        this.error(
          `${type} has no zero value: give "${names[0]!.name}" a value or make it nullable with ${typeToString(nullable(declared))}`,
          node.type ?? node,
        );
      }

      types = names.map(() => declared ?? UNKNOWN);
    } else if (values.length === names.length) {
      types = values.map((value) => {
        const type = this.checkValue(value, declared);

        if (!declared) return this.inferredType(type, value);
        this.expectAssignable(type, declared, value);

        return declared;
      });
    } else {
      types = this.unpack(values[0]!, names.length, declared);
    }

    return types;
  }

  /** `derived total number { ... }`: the block runs like the body of a closure and returns the value. */
  private derivedBlockType(name: string, body: ast.BlockStatement, declared: Type | null): Type {
    const ends = isTerminating(body);

    if (!ends) {
      this.error(
        `derived "${name}" must return its value at the end of the block, e.g. return total`,
        {
          start: body.end - 1,
          end: body.end,
        },
      );
    }

    const saved = this.derivedBlock;
    const results = declared ? [declared] : null;

    this.derivedBlock = name;
    try {
      const types = this.checkFunction([], func([], results ?? []), results, body, {
        closure: true,
      });

      if (types.length === 1) return types[0]!;
      // A block that does not end with a return is reported above.
      if (ends) {
        this.error(
          types.length === 0
            ? `derived "${name}" returns no value: return it, e.g. return total`
            : `derived "${name}" is one value, but its block returns ${types.length}`,
          body,
        );
      }

      return UNKNOWN;
    } finally {
      this.derivedBlock = saved;
    }
  }
}
