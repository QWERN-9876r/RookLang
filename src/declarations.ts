import type * as ast from './ast.ts';
import type { CheckResult } from './checker/checker.ts';
import type { FunctionType, ObjectType, Type, TypeParam } from './checker/types.ts';
import { JS_RESERVED } from './codegen/syntax.ts';
import { generatorType, property, resultType, tsType } from './ts-types.ts';

// A TypeScript declaration file (`.d.ts`) for a compiled module, so that TypeScript code can use
// it with types. Parameter names come from the code, types from the type checker:
//
//   number, string, bool   → number, string, boolean
//   ?T, error              → T | null, Error | null
//   []T                    → T[]
//   (A, B) results         → [A, B], the array that the JS function returns
//
// Interfaces, type aliases and classes are declared even when they are not exported, since the
// exported declarations may use them. Components exist only at compile time and are left out.

export function printDeclarations(program: ast.Program, checked: CheckResult): string {
  const printer = new DeclarationPrinter(checked);

  return printer.print(program);
}

class DeclarationPrinter {
  private readonly checked: CheckResult;
  private readonly lines: string[] = [];

  constructor(checked: CheckResult) {
    this.checked = checked;
  }

  print(program: ast.Program): string {
    let exports = false;

    for (const statement of program.body) {
      if ('exported' in statement && statement.exported) exports = true;
      switch (statement.kind) {
        case 'ImportDeclaration':
          this.importDeclaration(statement);
          break;

        case 'ExportFromDeclaration':
          exports = true;
          this.exportFrom(statement);
          break;

        case 'FuncDeclaration':
          if (statement.exported) this.functionDeclaration(statement);
          break;

        case 'VariableDeclaration':
          if (statement.exported) this.variableDeclaration(statement);
          break;

        case 'ClassDeclaration':
          this.classDeclaration(statement);
          break;

        case 'InterfaceDeclaration':
          this.interfaceDeclaration(statement);
          break;

        case 'TypeAliasDeclaration':
          this.typeAlias(statement);
          break;

        default:
          break;
      }
    }

    // A declaration file without imports or exports would declare global names.
    if (!exports) this.lines.push('export {};');

    return this.lines.join('\n') + '\n';
  }

  /** Imports are repeated, so that the names they bring can be used in types. */
  private importDeclaration(node: ast.ImportDeclaration): void {
    const parts: string[] = [];

    if (node.defaultImport) parts.push(node.defaultImport.name);
    if (node.namespaceImport) parts.push(`* as ${node.namespaceImport.name}`);
    if (node.namedImports.length > 0) {
      const names = node.namedImports.map((specifier) =>
        specifier.imported.name === specifier.local.name
          ? specifier.local.name
          : `${specifier.imported.name} as ${specifier.local.name}`,
      );

      parts.push(`{ ${names.join(', ')} }`);
    }

    if (parts.length === 0) return;

    const source = node.source.value.replace(/\.rk$/, '.js');

    this.lines.push(`import ${parts.join(', ')} from ${JSON.stringify(source)};`);
  }

  /** `export { Row } from "./rows.js"`: the values and types it passes on; components have none. */
  private exportFrom(node: ast.ExportFromDeclaration): void {
    const source = JSON.stringify(node.source.value.replace(/\.rk$/, '.js'));

    if (!node.specifiers) {
      this.lines.push(`export * from ${source};`);

      return;
    }

    const { exports } = this.checked;
    const names = node.specifiers
      .filter(({ local }) => exports.values.has(local.name) || exports.types.has(local.name))
      .map(({ imported, local }) =>
        imported.name === local.name ? local.name : `${imported.name} as ${local.name}`,
      );

    if (names.length > 0) this.lines.push(`export { ${names.join(', ')} } from ${source};`);
  }

  private functionDeclaration(node: ast.FuncDeclaration): void {
    const type = this.checked.declarations.values.get(node.name.name);

    if (type?.kind !== 'function') return;

    const name = jsName(node.name.name);

    this.lines.push(
      `export declare function ${name}${this.typeParams(type.typeParams)}${this.signature(node.params, type)};`,
    );
  }

  private variableDeclaration(node: ast.VariableDeclaration): void {
    const keyword = node.keyword === 'let' ? 'let' : 'const';

    for (const name of node.names) {
      if (name.name === '_') continue;

      const type = this.checked.declarations.values.get(name.name);

      this.lines.push(
        `export declare ${keyword} ${jsName(name.name)}: ${type ? tsType(type) : 'any'};`,
      );
    }
  }

  private interfaceDeclaration(node: ast.InterfaceDeclaration): void {
    const type = this.checked.declarations.types.get(node.name.name);

    if (type?.kind !== 'object') return;

    const exported = node.exported ? 'export ' : '';

    this.lines.push(
      `${exported}interface ${node.name.name}${this.typeParams(type.typeParams ?? [])} {`,
      ...this.objectMembers(node.members, type).map((line) => `    ${line}`),
      '}',
    );
  }

  private typeAlias(node: ast.TypeAliasDeclaration): void {
    const type = this.checked.declarations.types.get(node.name.name);

    if (!type) return;

    const exported = node.exported ? 'export ' : '';
    const params = this.typeParams(type.kind === 'object' ? (type.typeParams ?? []) : []);

    // `type Pair<A, B any> { ... }` names an object type; other aliases are another name.
    if (node.type.kind === 'ObjectType' && type.kind === 'object') {
      const members = this.objectMembers(node.type.members, type);

      this.lines.push(
        `${exported}type ${node.name.name}${params} = {`,
        ...members.map((line) => `    ${line}`),
        '};',
      );

      return;
    }

    this.lines.push(`${exported}type ${node.name.name}${params} = ${tsType(type, true)};`);
  }

  /** Members of an interface or an object type, with the parameter names of its methods. */
  private objectMembers(members: readonly ast.TypeMember[], type: ObjectType): string[] {
    return members.map((member) => {
      if (member.kind === 'IndexSignature') {
        return `[key: string]: ${type.index ? tsType(type.index, false) : 'any'};`;
      }

      const name = member.name.name;
      const memberType = type.members.get(name)?.type;

      if (member.kind === 'MethodSignature' && memberType?.kind === 'function') {
        return `${name}${this.signature(member.params, memberType)};`;
      }

      return memberType ? property(name, memberType) : `${name}: any;`;
    });
  }

  private classDeclaration(node: ast.ClassDeclaration): void {
    const instance = this.checked.declarations.types.get(node.name.name);

    if (instance?.kind !== 'class') return;

    const { info } = instance;
    const exported = node.exported ? 'export ' : '';
    const base = node.superClass && expressionName(node.superClass);
    const heritage = base ? ` extends ${base}` : '';
    const lines: string[] = [];

    for (const member of node.members) {
      switch (member.kind) {
        case 'FieldDeclaration': {
          const found = (member.isStatic ? info.statics : info.members).get(member.name.name);
          const modifiers = this.modifiers(member.visibility, member.isStatic, member.readonly);

          // As in the declaration files TypeScript writes, private members have no type.
          if (member.visibility === 'private') lines.push(`${modifiers}${member.name.name};`);
          else if (found) lines.push(`${modifiers}${member.name.name}: ${tsType(found.type)};`);
          break;
        }

        case 'ConstructorDeclaration': {
          const modifiers = this.modifiers(member.visibility, false);

          // The parameters that are properties are declared as fields, as TypeScript writes them.
          member.params.forEach((param, i) => {
            const { property } = param;
            const type = info.ctor?.params[i];

            if (!property) return;

            const field = `${this.modifiers(property.visibility, false, property.readonly)}${param.name.name}`;

            lines.push(
              property.visibility === 'private' || !type
                ? `${field};`
                : `${field}: ${tsType(type)};`,
            );
          });
          if (info.ctor) {
            lines.push(`${modifiers}constructor${parameters(member.params, info.ctor)};`);
          }

          break;
        }

        case 'MethodDeclaration': {
          const found = (member.isStatic ? info.statics : info.members).get(member.name.name);
          const modifiers =
            this.modifiers(member.visibility, member.isStatic) +
            (member.abstract ? 'abstract ' : '');

          if (member.accessor) lines.push(accessor(member, modifiers, found?.type));
          else if (member.visibility === 'private')
            lines.push(`${modifiers}${member.name.name}();`);
          else if (found?.type.kind === 'function') {
            lines.push(
              `${modifiers}${member.name.name}${this.signature(member.params, found.type)};`,
            );
          }

          break;
        }
      }
    }

    this.lines.push(
      `${exported}declare ${node.abstract ? 'abstract ' : ''}class ${jsName(node.name.name)}${this.typeParams(info.typeParams)}${heritage} {`,
      ...lines.map((line) => `    ${line}`),
      '}',
    );
  }

  private modifiers(visibility: ast.Visibility, isStatic: boolean, readonly?: true): string {
    return (
      `${visibility === 'public' ? '' : `${visibility} `}${isStatic ? 'static ' : ''}` +
      (readonly ? 'readonly ' : '')
    );
  }

  /** `<T, U extends Shape>` */
  private typeParams(params: readonly TypeParam[]): string {
    if (params.length === 0) return '';

    const list = params.map((param) =>
      param.constraint ? `${param.name} extends ${tsType(param.constraint)}` : param.name,
    );

    return `<${list.join(', ')}>`;
  }

  /** `(a: number, b?: string): R` with the names of the parameters in the code. */
  private signature(params: readonly ast.Parameter[], type: FunctionType): string {
    // An iterator is a generator function: it takes no function and gives the generator.
    if (type.iterator) return `(): ${generatorType(type)}`;

    return `${parameters(params, type)}: ${resultType(type.results)}`;
  }
}

function parameters(params: readonly ast.Parameter[], type: FunctionType): string {
  const list = type.params.map((param, i) => {
    const name = params[i] ? jsName(params[i].name.name) : `arg${i + 1}`;

    return `${name}${i < type.required ? '' : '?'}: ${tsType(param)}`;
  });

  return `(${list.join(', ')})`;
}

/** `get area(): number;` or `set area(v: number);`; a private one, as TypeScript writes it, untyped. */
function accessor(node: ast.MethodDeclaration, modifiers: string, type: Type | undefined): string {
  const head = `${modifiers}${node.accessor} ${node.name.name}`;
  const param = jsName(node.params[0]?.name.name ?? 'value');

  if (node.visibility === 'private' || !type) {
    return node.accessor === 'get' ? `${head}();` : `${head}(${param});`;
  }

  return node.accessor === 'get'
    ? `${head}(): ${tsType(type)};`
    : `${head}(${param}: ${tsType(type)});`;
}

/** `Base` or `events.EventEmitter` in `extends`; other expressions cannot be written in types. */
function expressionName(node: ast.Expression): string | null {
  if (node.kind === 'Identifier') return node.name;
  if (node.kind === 'MemberExpression') {
    const object = expressionName(node.object);

    return object && `${object}.${node.property.name}`;
  }

  return null;
}

/** Names that are reserved in JS get `$`, as in the generated code. */
function jsName(name: string): string {
  return JS_RESERVED.has(name) ? `${name}$` : name;
}
