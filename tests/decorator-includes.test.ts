import { describe, expect, it } from 'vitest';
import type * as ast from '../src/ast.ts';
import { check } from '../src/checker/checker.ts';
import { parse } from '../src/parser/parser.ts';
import { mountWithDom } from './fake-dom.ts';

// Decorators that include others, `dec shop(start number) includes counter(start), framed { ... }`:
// those are applied with it, above its own body, and the component reads all their public members
// through it, `@shop.count`. And `public ref`, which the component reads as `@framed.box`.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

/** Waits until the microtasks that run `mount` are done. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const counter = `dec counter(start number = 0) {
    public state count = start

    public func add() {
        count++
    }
}
`;

const framed = `dec framed(title string = "") {
    public ref box
    return (content Element) => <section ref={box}><h2>{title}</h2>{content}</section>
}
`;

const logged = (name: string, rest = '') => `dec ${name}()${rest} {
    console.log("body ${name}")
    mount {
        console.log("mount ${name}")
    }
    return (content Element) => <div class="${name}">{content}</div>
}
`;

/** A component with `@decorators` that returns `markup`. */
const card = (decorators: string, markup = '<p />') =>
  `${decorators}\ncomp Card() {\n    return ${markup}\n}\n`;

describe('syntax', () => {
  it('reads includes after needs, with arguments', () => {
    const { program, diagnostics } = parse(
      `${counter}dec auth() {\n}\ndec shop(n number) needs auth includes counter(n), framed {\n}`,
    );

    expect(diagnostics).toEqual([]);

    const shop = program.body[2] as ast.DecoratorDeclaration;

    expect(shop.needs.map((need) => need.name)).toEqual(['auth']);
    expect(shop.includes.map((use) => [use.name.name, use.arguments.length])).toEqual([
      ['counter', 1],
      ['framed', 0],
    ]);
  });

  it('keeps includes an ordinary name elsewhere', () => {
    expect(errors('const includes = 1\nconst n = includes + 1')).toEqual([]);
  });
});

describe('types', () => {
  it('gives the component the members of the included decorators through the combination', () => {
    expect(
      errors(`${counter}${framed}dec shop(start number) includes counter(start), framed("Shop") {
    public func addTwice() {
        @counter.add()
        @counter.add()
    }
}
${card('@shop(1)', '<p onClick={@shop.addTwice(); @shop.add()}>{@shop.count}</p>')}`),
    ).toEqual([]);
  });

  it('points from an included decorator to the combination', () => {
    expect(
      errors(
        `${counter}dec shop() includes counter {\n}\n${card('@shop', '<p>{@counter.count}</p>')}`,
      ),
    ).toEqual(['"count" of @counter comes through @shop: write @shop.count']);
  });

  it('checks the arguments of the included decorators against their parameters', () => {
    expect(errors(`${counter}dec shop(start string) includes counter(start) {\n}`)).toEqual([
      'cannot use string as number for "start" of @counter',
    ]);
    expect(errors(`${counter}dec shop() includes counter(1, 2) {\n}`)).toEqual([
      '@counter takes 1 argument',
    ]);
  });

  it('reports wrong includes', () => {
    expect(errors('dec a() includes a {\n}')).toEqual(['@a cannot include itself']);
    expect(errors(`${counter}dec a() includes counter, counter {\n}`)).toEqual([
      '@counter is included twice: name it once',
    ]);
    expect(errors(`${counter}dec a() needs counter includes counter {\n}`)).toEqual([
      '@a both needs and includes @counter: includes is enough',
    ]);
    expect(errors('dec a() includes b {\n}')).toEqual(['unknown decorator @b']);
    expect(errors('dec a() includes b {\n}\ndec b() includes a {\n}')).toEqual([
      'decorators cannot need or include each other: @a includes @b, @b includes @a; remove one of them',
    ]);
  });

  it('reports a member that two of them give', () => {
    expect(
      errors(
        `${counter}dec other() {\n    public state count = 1\n}\ndec shop() includes counter, other {\n}`,
      ),
    ).toEqual(['@shop gets "count" from both @counter and @other: rename one of them']);
    expect(
      errors(`${counter}dec shop() includes counter {\n    public const count = 1\n}`),
    ).toEqual(['@shop declares "count", which it also gets from @counter: rename one of them']);
  });

  it('counts the included decorators as applied, for needs and twice', () => {
    const badge = 'dec badge() needs counter {\n}\n';

    expect(
      errors(card(`${counter}${badge}dec shop() includes counter {\n}\n@shop\n@badge`)),
    ).toEqual([]);
    expect(errors(card(`${counter}dec shop() includes counter {\n}\n@counter\n@shop`))).toEqual([
      '@counter is applied twice (it is in @shop): apply it once',
    ]);
    expect(errors(card(`${counter}${badge}dec shop() includes badge {\n}\n@shop`))).toEqual([
      '@badge (it is in @shop) needs @counter above it: @counter @shop comp ...',
    ]);
  });

  it('cannot export a combination yet', () => {
    expect(errors(`${counter}export dec shop() includes counter {\n}`)).toEqual([
      '@shop is exported, so it cannot include decorators yet: apply them before it, e.g. @counter @shop comp ...',
    ]);
  });

  it('reads a public ref, which is read-only outside, but not its element', () => {
    expect(
      errors(`${framed}@framed
comp Card() {
    mount {
        const box HTMLElement = @framed.box
    }
    func f() {
        @framed.box.title = "framed"
        @framed.box = @framed.box
    }
    return <p />
}`),
    ).toEqual([
      '"box" of @framed is read-only outside it; give @framed a public function that changes it',
    ]);
  });
});

describe('running', () => {
  it('runs the included bodies above its own, and wraps from the inside out', async () => {
    const { output, body } = mountWithDom(
      `${logged('outer')}${logged('inner')}${logged('shop', ' includes outer, inner')}${card('@shop')}document.body.append(<Card />)`,
    );

    await flush();
    expect(output).toEqual([
      'body outer',
      'body inner',
      'body shop',
      'mount shop',
      'mount inner',
      'mount outer',
    ]);
    expect(String(body)).toBe(
      '<body><div className=outer><div className=inner><div className=shop><p></p></div></div></div></body>',
    );
  });

  it('updates the markup that reads members through the combination', () => {
    const { body } = mountWithDom(`${counter}dec shop(start number) includes counter(start) {
    public derived double = @counter.count * 2
}
@shop(5)
comp Card() {
    return <button onClick={@shop.add()}>{@shop.count} {@shop.double}</button>
}
document.body.append(<Card />)
`);

    body.find('button').click();
    expect(String(body)).toBe('<body><button>6 12</button></body>');
  });

  it('gives the included decorators the arguments that change with the properties', () => {
    const { body } = mountWithDom(`${framed}dec shop(title string) includes framed(title) {
}
@shop(title)
comp Card(title string) {
    return <p>card</p>
}
comp App() {
    state title = "one"
    return <div onClick={title = "two"}><Card title={title} /></div>
}
document.body.append(<App />)
`);

    expect(String(body)).toContain('<h2>one</h2>');
    body.find('div').click();
    expect(String(body)).toContain('<h2>two</h2>');
  });

  it('gives the component the element of a public ref', async () => {
    const { output } = mountWithDom(`${framed}dec shop() includes framed("Shop") {
}
@shop
comp Card() {
    mount {
        console.log(@shop.box.tagName)
    }
    return <p>card</p>
}
document.body.append(<Card />)
`);

    await flush();
    expect(output).toEqual(['section']);
  });
});
