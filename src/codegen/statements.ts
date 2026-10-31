import type * as ast from '../ast.ts';
import { isSuperCall } from '../checker/helpers.ts';
import { isIterator } from '../iterators.ts';
import { decoratedName, moduleNamesOf } from '../decorators.ts';
import { inlinePackages, type InlinePackage } from '../inline-packages.ts';
import { packageExports } from './imported.ts';
import { readNames } from './mutations.ts';
import { ParallelLoopEmitter } from './parallel.ts';
import { listenersName } from './shared.ts';
import { ARROW, POSTFIX } from './syntax.ts';

/**
 * Imports and classes; with the layers below, all statements and declarations. A decorator of
 * another module is not a value, but its code uses names of its module: the import brings them
 * under hidden names, `import { $$visible$log } from "./visible.js"`, which that module exports.
 * So does an inlined component of another module; a called one brings its function, `$$Card`.
 */

export abstract class StatementEmitter extends ParallelLoopEmitter {
  /** A CSS module: its object and CSS go with the styles (StyleEmitter), not to an import. */
  protected abstract styleModuleImport(node: ast.ImportDeclaration): boolean;

  private sharedReads: Set<string> | null = null;

  /** State of the module: the updates of the components that read it are kept beside it. */
  protected override emitStatement(node: ast.Statement): void {
    if (node.kind === 'ExportFromDeclaration') {
      this.exportFrom(node);

      return;
    }

    super.emitStatement(node);
    if (node.kind !== 'VariableDeclaration' || node.keyword !== 'state') return;
    if (!this.program.body.includes(node)) return;

    const exported = node.exported ? 'export ' : '';

    for (const name of node.names) {
      const listeners = this.shared.listeners.get(name.name);

      if (listeners) this.line(`${exported}const ${listeners} = new Set();`);
    }
  }

  /** Whether the components or decorators of the module read `name`, and so listen to it. */
  protected readsShared(name: string): boolean {
    if (!this.sharedReads) {
      this.sharedReads = new Set();
      for (const statement of this.program.body) {
        if (
          statement.kind === 'ComponentDeclaration' ||
          statement.kind === 'DecoratorDeclaration'
        ) {
          readNames(statement, this.sharedReads);
        }
      }
    }

    return this.sharedReads.has(name);
  }

  protected override importDeclaration(node: ast.ImportDeclaration): void {
    if (this.styleModuleImport(node)) return;

    // Imports used only as types (e.g. interfaces) do not exist at runtime, and neither do
    // components: a component used as a value is its function, imported below.
    // A data class, even used only as a type, registers itself where it is imported.
    const used = (name: ast.Identifier) =>
      (this.valueNames.has(name.name) || this.options.dataClasses?.has(name.name) === true) &&
      !this.options.components?.has(name.name);
    const clauses: string[] = [];

    if (node.defaultImport && used(node.defaultImport)) {
      clauses.push(this.name(node.defaultImport.name));
    }

    if (node.namespaceImport && used(node.namespaceImport)) {
      clauses.push(`* as ${this.name(node.namespaceImport.name)}`);
    }

    const named = node.namedImports
      .filter((specifier) => used(specifier.local))
      .map((specifier) => {
        const local = this.name(specifier.local.name);

        return specifier.imported.name === local ? local : `${specifier.imported.name} as ${local}`;
      });

    const hidden = (exported: string, local: string) =>
      named.push(exported === local ? exported : `${exported} as ${local}`);

    for (const specifier of node.namedImports) {
      const component = this.options.components?.get(specifier.local.name);
      const state = this.options.shared?.get(specifier.local.name);

      // State of that module: the components here that read it listen to its changes.
      if (state !== undefined && this.readsShared(specifier.local.name)) {
        hidden(listenersName(state), this.shared.listeners.get(specifier.local.name)!);
      }

      const inlined = this.inlinedImports.get(specifier.local.name);

      if (inlined) {
        for (const [exported, local] of inlined.imports) hidden(exported, local);
      } else if (component) {
        hidden(`$$${component.node.name.name}`, this.functionNames.get(component.node)!);
      }

      const decorator = this.options.decorators?.get(specifier.local.name);

      if (!decorator || !this.appliedDecorators.has(specifier.local.name)) continue;
      for (const name of decorator.moduleNames) {
        named.push(decoratedName(decorator.node.name.name, name));
      }

      for (const [exported, local] of this.decoratorImports.get(specifier.local.name)?.imports ??
        []) {
        hidden(exported, local);
      }
    }

    if (named.length > 0) clauses.push(`{ ${named.join(', ')} }`);

    const importsNames =
      node.defaultImport !== null || node.namespaceImport !== null || node.namedImports.length > 0;

    if (importsNames && clauses.length === 0) return;

    const source = this.importPath(node.source);

    this.line(
      clauses.length > 0 ? `import ${clauses.join(', ')} from ${source};` : `import ${source};`,
    );
  }

  /**
   * `export { log as $$visible$log }`: the names of the module that the code of exported
   * decorators uses, and that of exported components when other modules inline them.
   */
  protected hiddenExports(): void {
    const exports = new Map<string, string>();

    for (const statement of this.program.body) {
      if (statement.kind !== 'DecoratorDeclaration' || !statement.exported) continue;
      for (const name of moduleNamesOf(statement, this.program)) {
        exports.set(decoratedName(statement.name.name, name), this.name(name));
      }
    }

    const packages = inlinePackages(this.program);
    const decorators = [...packages.decorators].filter(
      (entry): entry is [string, InlinePackage] => entry[1] !== null,
    );

    for (const found of [packages.components, new Map(decorators)]) {
      for (const [exported, local] of packageExports(found, (name) => this.name(name))) {
        exports.set(exported, local);
      }
    }

    if (exports.size === 0) return;

    const names = [...exports].map(([exported, local]) =>
      exported === local ? exported : `${local} as ${exported}`,
    );

    this.blankLine();
    this.line(`export { ${names.join(', ')} };`);
  }

  /** `const { name, size: bytes, ...rest } = file`, as in JS. */
  protected override variableDeclaration(node: ast.VariableDeclaration): string {
    if (!node.pattern) return super.variableDeclaration(node);

    const { keys, rest } = node.pattern;
    const fields = keys.map((key, i) => {
      const name = this.name(node.names[i]!.name);
      const field = key.kind === 'StringLiteral' ? key.raw : key.name;

      return field === name ? name : `${field}: ${name}`;
    });

    if (rest) fields.push(`...${this.name(node.names.at(-1)!.name)}`);

    return `${node.keyword} { ${fields.join(', ')} } = ${this.expression(node.values[0]!, ARROW)}`;
  }

  /** `export { Rows } from "./rows.js"` with the hidden names that go with them (reexports.ts). */
  private exportFrom(node: ast.ExportFromDeclaration): void {
    const source = this.importPath(node.source);
    const names = node.specifiers ? (this.options.reexports?.get(node) ?? []) : null;

    if (names === null) this.line(`export * from ${source};`);
    else if (names.length > 0) this.line(`export { ${names.join(', ')} } from ${source};`);
  }

  protected importPath(source: ast.StringLiteral): string {
    const path = source.value;

    // `./button.rk` and the aliases `#ui/button.rk` and `@/ui/button.rk` (aliases.ts): the built
    // module is next to its source.
    if (this.options.rewriteImports && !isBare(path) && path.endsWith('.rk')) {
      return JSON.stringify(`${path.slice(0, -'.rk'.length)}.js`);
    }

    return source.raw;
  }

  protected override classDeclaration(node: ast.ClassDeclaration): void {
    const exported = node.exported ? 'export ' : '';
    const superClass = node.superClass
      ? ` extends ${this.expression(node.superClass, POSTFIX)}`
      : '';
    const body = this.block(() => {
      let previous: ast.ClassMember | undefined;

      // An abstract method has no code: only the subclasses have it.
      for (const member of node.members) {
        if (member.kind === 'MethodDeclaration' && member.abstract) continue;

        const bothFields =
          previous?.kind === 'FieldDeclaration' && member.kind === 'FieldDeclaration';

        if (previous && (!bothFields || this.blankLineBetween(previous, member))) this.blankLine();
        this.classMember(member);
        previous = member;
      }
    });

    this.line(`${exported}class ${this.name(node.name.name)}${superClass} ${body}`);
    // A data class is registered, so that its instances get it back in another thread
    // (runtime/classes.js); the id is the same in the worker module, which has a copy of it.
    if (node.data) {
      const id = `${node.name.name}:${hash(this.options.source.slice(node.start, node.end))}`;

      this.line(`$$dataClass(${this.name(node.name.name)}, ${JSON.stringify(id)});`);
    }
  }

  /** Visibility modifiers are checked by the compiler and do not exist in the output. */
  protected classMember(member: ast.ClassMember): void {
    switch (member.kind) {
      case 'FieldDeclaration': {
        // Field values are part of the class body, where no statements can go.
        const fieldValue = member.value;
        const value = fieldValue
          ? this.withHoisting(false, () => this.expression(fieldValue, ARROW))
          : member.type
            ? this.zeroValue(member.type)
            : null;
        const prefix = member.isStatic ? 'static ' : '';

        this.line(`${prefix}${member.name.name}${value === null ? '' : ` = ${value}`};`);
        break;
      }

      case 'ConstructorDeclaration': {
        const [params, body] = this.func(member.params, assignProperties(member));

        this.line(`constructor(${params}) ${body}`);
        break;
      }

      case 'MethodDeclaration': {
        if (!member.body) break;

        const [params, body] = this.func(member.params, member.body);
        const modifiers =
          `${member.isStatic ? 'static ' : ''}${member.async ? 'async ' : ''}` +
          (member.accessor ? `${member.accessor} ` : '');
        const star = isIterator(member.params) && !member.accessor ? '*' : '';

        this.line(`${modifiers}${star}${member.name.name}(${params}) ${body}`);
        break;
      }
    }
  }
}

/**
 * The body of a constructor whose parameters are properties, `constructor(private name string)`:
 * it assigns them first, `this.name = name`, or right after `super(...)` in a derived class.
 */
function assignProperties(node: ast.ConstructorDeclaration): ast.BlockStatement {
  const assignments = node.params.flatMap((param): ast.Statement[] => {
    if (!param.property) return [];

    const at = { start: param.start, end: param.end };
    const self: ast.ThisExpression = { kind: 'ThisExpression', ...at };
    const target: ast.MemberExpression = {
      kind: 'MemberExpression',
      object: self,
      property: param.name,
      optional: false,
      ...at,
    };

    return [
      {
        kind: 'AssignmentStatement',
        operator: '=',
        targets: [target],
        values: [param.name],
        ...at,
      },
    ];
  });

  if (assignments.length === 0) return node.body;

  const statements = node.body.body;
  const after = statements.findIndex(isSuperCall) + 1;

  return {
    ...node.body,
    body: [...statements.slice(0, after), ...assignments, ...statements.slice(after)],
  };
}

/** FNV-1a of a text, as 8 hex digits: an id that changes only with the text. */
function hash(text: string): string {
  let value = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }

  return value.toString(16).padStart(8, '0');
}

/** `pkg/file.rk` of another package, which is not built with this one. */
function isBare(path: string): boolean {
  return (
    !/^\.{1,2}\//.test(path) &&
    !path.startsWith('#') &&
    !path.startsWith('@/') &&
    !path.startsWith('~/')
  );
}
