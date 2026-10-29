import { describe, expect, it } from 'vitest';
import { check } from '../src/checker/checker.ts';
import { compile } from '../src/index.ts';
import { parse } from '../src/parser/parser.ts';

// Tagged unions and paths: comparing a tag, a field with literal types in every member of a
// union, narrows the union; a path of fields from a variable, `order.delivery`, is narrowed like
// the variable; an object literal chooses the member of a union by its tag.

function errors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  if (diagnostics.length > 0) return diagnostics.map((d) => d.message);

  return check(program).diagnostics.map((d) => d.message);
}

/** Runs a program and returns what it printed. */
async function run(source: string): Promise<string[]> {
  const { code, diagnostics } = compile(source, { runtime: 'inline' });

  expect(diagnostics).toEqual([]);

  const output: string[] = [];
  const log = (...args: unknown[]) => output.push(args.map(String).join(' '));
  const prototype = Object.getPrototypeOf(async () => {}) as { constructor: unknown };
  const AsyncFunction = prototype.constructor as new (
    ...args: string[]
  ) => (console: unknown) => Promise<void>;

  await new AsyncFunction('console', code)({ log });

  return output;
}

const delivery = `interface Pickup { kind "pickup"; shop string }
interface Courier { kind "courier"; address string; floor ?number }
type Delivery Pickup | Courier
interface Order { id number; delivery Delivery }
`;

const user = `interface User { name string; boss ?User }
`;

const mayBeNull = 'this value may be null: check it for null or use "?."';

describe('narrowing by a tag', () => {
  it('narrows in if and else, and after a branch that returns', () => {
    expect(
      errors(`${delivery}func where(d Delivery) string {
    if d.kind == "courier" {
        return d.address
    } else {
        const shop string = d.shop
    }
    return d.shop
}
func floor(d Delivery) string {
    if d.kind != "courier" {
        return d.shop
    }
    return d.address
}`),
    ).toEqual([]);
  });

  it('needs narrowing to read a field of one member', () => {
    expect(errors(`${delivery}func where(d Delivery) string {\n    return d.address\n}`)).toEqual([
      'Delivery has no member "address" in every type: narrow it with typeof or instanceof',
    ]);
  });

  it('narrows with !, && and ||', () => {
    expect(
      errors(`${delivery}func f(d Delivery) {
    if !(d.kind == "pickup") {
        const a string = d.address
    }
    if d.kind == "courier" && d.floor != null {
        const f number = d.floor
    }
    if d.kind == "pickup" || d.address == "" {
        return
    }
    const a string = d.address
}`),
    ).toEqual([]);
  });

  it('narrows in the cases of switch and in default', () => {
    expect(
      errors(`${delivery}func where(d Delivery) string {
    switch d.kind {
    case "pickup":
        return d.shop
    default:
        return d.address
    }
}`),
    ).toEqual([]);
  });

  it('narrows in {if} and {switch} of markup', () => {
    expect(
      errors(`${delivery}comp Label(d Delivery) {
    return <p>
        {if d.kind == "courier" { <b>{d.address}</b> } else { <i>{d.shop}</i> }}
        {switch d.kind {
        case "pickup":
            <i>{d.shop}</i>
        default:
            <b>{d.address}</b>
        }}
    </p>
}`),
    ).toEqual([]);
  });

  it('knows several tags, numbers and unions of literals', () => {
    expect(
      errors(`interface Draft { state "new" | "edited"; step 1; text string }
interface Sent { state "sent"; step 2; at number }
type Letter Draft | Sent
func f(l Letter) {
    if l.step == 2 {
        const at number = l.at
    }
    if l.state == "edited" {
        const text string = l.text
    }
    switch l.state {
    case "new", "edited":
        const text string = l.text
    default:
        const at number = l.at
    }
}`),
    ).toEqual([]);
  });

  it('narrows unions of classes', () => {
    expect(
      errors(`class Circle {
    kind "circle" = "circle"
    r number = 1
}
class Square {
    kind "square" = "square"
    side number = 1
}
func area(s Circle | Square) number {
    if s.kind == "circle" {
        return s.r * s.r * 3
    }
    return s.side * s.side
}`),
    ).toEqual([]);
  });
});

describe('narrowing paths', () => {
  it('narrows a path by a tag and by null', () => {
    expect(
      errors(`${delivery}${user}func where(order Order) string {
    if order.delivery.kind == "courier" {
        return order.delivery.address
    }
    return order.delivery.shop
}
func bossName(u User) string {
    if u.boss != null {
        return u.boss.name
    }
    return ""
}`),
    ).toEqual([]);
  });

  it('narrows paths with typeof and instanceof', () => {
    expect(
      errors(`interface Box { value string | number; when ?(Date | string) }
func f(b Box) {
    if typeof b.value == "string" {
        const s string = b.value
    }
    if b.when instanceof Date {
        const d Date = b.when
    }
}`),
    ).toEqual([]);
  });

  it('ends the narrowing of a path when the path or its start is assigned', () => {
    const narrowed = (statement: string) =>
      errors(`${user}func f(u User, other User) {
    let v = u
    if v.boss != null {
        ${statement}
        const name string = v.boss.name
    }
}`);

    expect(narrowed('v.name = ""')).toEqual([]);
    expect(narrowed('v.boss = other.boss')).toEqual([mayBeNull]);
    expect(narrowed('v = other')).toEqual([mayBeNull]);
    expect(narrowed('v.boss.boss = null')).toEqual([]);
    expect(narrowed('v.boss.name = "Ann"')).toEqual([]);
  });

  it('ends the narrowing of a union when its tag is assigned, not another field', () => {
    const narrowed = (statement: string) =>
      errors(`${delivery}func f(order Order, d Delivery) {
    if order.delivery.kind == "courier" && d.kind == "courier" {
        ${statement}
        const a string = order.delivery.address
        const b string = d.address
    }
}`);
    const noAddress =
      'Delivery has no member "address" in every type: narrow it with typeof or instanceof';

    expect(narrowed('order.delivery.floor = 2\n        d.floor = 2')).toEqual([]);
    expect(narrowed('order.delivery.kind = "courier"')).toEqual([noAddress]);
    expect(narrowed('d.kind = "courier"')).toEqual([noAddress]);
  });

  it('does not narrow paths that a loop assigns', () => {
    expect(
      errors(`${user}${delivery}func f(u User, others []User, order Order) {
    if u.boss != null && order.delivery.kind == "courier" {
        for other in others {
            const name string = u.boss.name
            const address string = order.delivery.address
            u.boss = other.boss
            order.delivery.floor = 1
        }
        for other in others {
            const address string = order.delivery.address
            order.delivery.kind = "courier"
        }
    }
}`),
    ).toEqual([
      mayBeNull,
      'Delivery has no member "address" in every type: narrow it with typeof or instanceof',
    ]);
  });

  it('keeps the narrowing of a path in a closure while its variable is not assigned', () => {
    expect(
      errors(`${user}func f(u User) {
    if u.boss != null {
        const read = () => {
            const name string = u.boss.name
        }
    }
    let w = u
    w = u
    if w.boss != null {
        const read = () => {
            const name string = w.boss.name
        }
    }
}`),
    ).toEqual([mayBeNull]);
  });

  it('does not narrow getters, indexes and links after ?.', () => {
    expect(
      errors(`${user}class Team {
    lead ?User = null
    get boss() ?User {
        return this.lead
    }
}
func f(t Team, users []User, u ?User) {
    if t.boss != null {
        const a string = t.boss.name
    }
    if users[0].boss != null {
        const b string = users[0].boss.name
    }
    if u?.boss != null {
        const c string = u?.boss.name
    }
    if t.lead != null {
        const d string = t.lead.name
    }
}`),
    ).toEqual([mayBeNull, mayBeNull, mayBeNull]);
  });

  it('ends the narrowing of a path deleted', () => {
    expect(
      errors(`${user}func f(u User) {
    if u.boss != null {
        delete u.boss
        const name string = u.boss.name
    }
}`),
    ).toEqual([mayBeNull]);
  });
});

describe('object literals of tagged unions', () => {
  it('chooses the member by the tag', () => {
    expect(
      errors(`${delivery}func where(order Order) {}
where({ id: 1, delivery: { kind: "pickup", shop: "Main st." } })
where({ id: 2, delivery: { kind: "courier", address: "Elm st. 5", floor: 3 } })
const all []Delivery = [{ kind: "pickup", shop: "A" }, { kind: "courier", address: "B" }]`),
    ).toEqual([]);
  });

  it('reports a tag of no member and the fields of the member chosen', () => {
    expect(
      errors(`${delivery}const a Delivery = { kind: "plane", shop: "Main st." }
const b Delivery = { kind: "pickup", shop: "Main st.", floor: 2 }
const c Delivery = { kind: "courier", address: 5 }`),
    ).toEqual([
      '"plane" is not a kind of Delivery: write "pickup" or "courier"',
      'Pickup has no field "floor"',
      'cannot use number as string for field "address"',
    ]);
  });
});

describe('decode', () => {
  it('gives a tagged union that narrows', async () => {
    expect(
      await run(`${delivery}func where(d Delivery) string {
    switch d.kind {
    case "pickup":
        return "pickup at " + d.shop
    default:
        return "courier to " + d.address
    }
}
const texts = ['{"kind":"pickup","shop":"Main st."}', '{"kind":"courier","address":"Elm st."}', '{"kind":"plane"}', '{"kind":"courier"}']
for text in texts {
    const d, err = decode<Delivery>(text)
    if err != null {
        console.log(err.message)
        continue
    }
    console.log(where(d))
}`),
    ).toEqual([
      'pickup at Main st.',
      'courier to Elm st.',
      'decode Pickup | Courier: kind: expected "pickup" | "courier", got "plane"',
      'decode Pickup | Courier: address: missing',
    ]);
  });
});
