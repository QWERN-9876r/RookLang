import { describe, expect, it } from 'vitest';
import type * as ast from '../src/ast.ts';
import { check } from '../src/checker/checker.ts';
import { compile } from '../src/index.ts';
import { parse } from '../src/parser/parser.ts';
import { mountWithDom } from './fake-dom.ts';

// `derived summary string { ...; return text }`: a derived value computed by a block that runs like
// the body of a function. It becomes a function in JS, called first and in the updates of what the
// block reads.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

function js(source: string): string {
  const { code, diagnostics } = compile(source);

  expect(diagnostics).toEqual([]);

  return code;
}

/** A component with `body` before `return <p>{markup}</p>`. */
const component = (body: string, markup = '') =>
  `comp A() {\n    state count = 1\n${body}\n    return <p>${markup}</p>\n}\ndocument.body.append(<A />)\n`;

describe('syntax', () => {
  it('reads the block, with or without a type', () => {
    const { program, diagnostics } = parse(
      component(
        '    derived a {\n        return count\n    }\n    derived b number {\n        return count\n    }\n    derived c ({ x number }) {\n        return { x: count }\n    }',
      ),
    );

    expect(diagnostics).toEqual([]);

    const body = (program.body[0] as ast.ComponentDeclaration).body.body;
    const [a, b, c] = body.slice(1, 4) as ast.VariableDeclaration[];

    expect([a!.type, a!.values, a!.body?.kind]).toEqual([null, [], 'FuncExpression']);
    expect(b!.type?.kind).toBe('TypeReference');
    expect(c!.type?.kind).toBe('ObjectType');
  });

  it.each([component('    derived a, b {\n        return 1\n    }')])(
    'reports a block with several names: %j',
    (source) => {
      expect(errors(source)[0]).toBe(
        'derived is one name and the expression it is computed from, e.g. derived double = count * 2, or a block that returns it: derived total number { ... return sum }',
      );
    },
  );

  it('allows no state declarations in the block', () => {
    expect(
      errors(component('    derived a {\n        state x = 1\n        return x\n    }')),
    ).toEqual([
      'state is declared at the top level of a component, not inside blocks or functions',
    ]);
  });
});

describe('types', () => {
  it('infers the type from the returns, or checks the one written', () => {
    expect(
      errors(
        component(`    derived label {
        if count > 1 {
            return "many"
        }
        return "one"
    }
    derived twice number {
        let n = count
        n *= 2
        return n
    }
    const a string = label
    const b number = twice`),
      ),
    ).toEqual([]);
    expect(errors(component('    derived a string {\n        return count\n    }'))).toEqual([
      'cannot use number as string in return',
    ]);
  });

  it('needs a value at the end of the block', () => {
    expect(
      errors(
        component(
          '    derived a number {\n        if count > 1 {\n            return 1\n        }\n    }',
        ),
      ),
    ).toEqual(['derived "a" must return its value at the end of the block, e.g. return total']);
    expect(errors(component('    derived a {\n        return\n    }'))).toEqual([
      'derived "a" returns no value: return it, e.g. return total',
    ]);
  });

  it('does not let the block change state, or the derived value be assigned', () => {
    expect(
      errors(
        component(`    derived a {
        count = 2
        return count
    }
    func f() {
        a = 1
    }`),
      ),
    ).toEqual([
      'derived "a" cannot change the state "count": change it in an event handler or an effect',
      'cannot assign to "a": it is derived, so change what it is computed from',
    ]);
  });

  it('keeps the narrowing of constants in the block', () => {
    expect(
      errors(`comp A(name ?string) {
    state count = 1
    derived greeting {
        if name == null {
            return "Hello"
        }
        return \`Hello, \${name.toUpperCase()} \${count}\`
    }
    return <p>{greeting}</p>
}`),
    ).toEqual([]);
  });
});

describe('code', () => {
  it('makes the block a function, called first and in the updates', () => {
    const code = js(
      component(
        '    derived label {\n        return count > 1 ? "many" : "one"\n    }',
        '<button onClick={count++}>{label}</button>',
      ),
    );

    expect(code).toContain('const $$computeLabel');
    expect(code).toContain('let label = $$computeLabel');
    expect(code).toMatch(/label = \$\$computeLabel\d+\(\);\n/);
  });

  it('runs a block that reads no state once', () => {
    expect(js(component('    derived sum {\n        return 1 + 2\n    }', '{sum}'))).toContain(
      'const sum = (() => {\n',
    );
  });
});

describe('running', () => {
  it('computes the value again when what it reads changes', () => {
    const { body } = mountWithDom(`interface Todo { title string; done bool }
comp Todos() {
    state todos []Todo = [{ title: "a", done: false }]
    derived summary {
        const done = todos.filter(t => t.done).length
        if done == 0 {
            return "Nothing done"
        }
        return \`\${done} of \${todos.length} done\`
    }
    return <p onClick={todos.push({ title: "b", done: true })}>{summary}</p>
}
document.body.append(<Todos />)
`);

    expect(String(body)).toBe('<body><p>Nothing done</p></body>');
    body.find('p').click();
    expect(String(body)).toBe('<body><p>1 of 2 done</p></body>');
  });

  it('follows the state that its local functions and other derived values read', () => {
    const { body } = mountWithDom(`comp A() {
    state count = 1
    derived double = count * 2
    func label(n number) string {
        return n > 2 ? "big" : "small"
    }
    derived text {
        const kind = label(double)
        return \`\${double} is \${kind}\`
    }
    return <p onClick={count++}>{text}</p>
}
document.body.append(<A />)
`);

    body.find('p').click();
    expect(String(body)).toBe('<body><p>4 is big</p></body>');
  });

  it('updates the markup that reads a public derived block of a decorator', () => {
    const { body } = mountWithDom(`dec counted() {
    public state count = 1
    public derived label string {
        if count > 2 {
            return "many"
        }
        return \`\${count}\`
    }

    public func add() {
        count++
    }
}
@counted
comp Clicker() {
    return <button onClick={@counted.add()}>{get(@counted.label)}</button>
}
document.body.append(<Clicker />)
`);

    body.find('button').click();
    expect(String(body)).toBe('<body><button>2</button></body>');
    body.find('button').click();
    expect(String(body)).toBe('<body><button>many</button></body>');
  });
});
