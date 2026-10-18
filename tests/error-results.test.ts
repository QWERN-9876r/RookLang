import { describe, expect, it } from 'vitest';
import { check } from '../src/checker/checker.ts';
import { compile } from '../src/index.ts';
import { parse } from '../src/parser/parser.ts';

// Values returned with an error: a function of `(User, error)` may return `null, err`, the unpacked
// value may be null, and it is not null once the error is found to be null.

const USER = `class User {
    name string
    constructor(name string) { this.name = name }
}

func loadUser(id number) (User, error) {
    if id < 0 {
        return null, error("bad id")
    }
    return new User("ann"), null
}
`;

function errors(source: string): string[] {
  return compile(source).diagnostics.map((d) => d.message);
}

/** Errors of the check without the lib files, as in the playground. */
function browserErrors(source: string): string[] {
  const { program, diagnostics } = parse(source);

  expect(diagnostics).toEqual([]);

  return check(program).diagnostics.map((d) => d.message);
}

describe('returning null with an error', () => {
  it('allows null in place of a value together with an error', () => {
    expect(errors(USER)).toEqual([]);
    expect(
      errors(`${USER}func again(id number) (User, error) {
    const user, err = loadUser(id)
    if err != null {
        return null, err
    }
    return user, null
}
func port(s string) (number, error) {
    return null, new Error(s)
}
func forward(id number) (User, error) {
    return loadUser(id)
}`),
    ).toEqual([]);
  });

  it('reports null without an error', () => {
    expect(errors(`${USER}func find(id number) (User, error) { return null, null }`)).toEqual([
      'cannot return null with no error: make the result ?User if the value may be null without an error',
    ]);
  });

  it('reports null with an error that may be null', () => {
    expect(
      errors(`${USER}func again(id number) (User, error) {
    const _, fail = loadUser(id)
    return null, fail
}`),
    ).toEqual([
      'null in place of User needs an error that is not null: check it first, e.g. if fail != null { return null, fail }',
    ]);
  });

  it('keeps a nullable result nullable without an error', () => {
    expect(
      errors(`${USER}func find(name string) (?User, error) { return null, null }
const user, err = find("ann")
if err != null { throw err }
console.log(user.name)`),
    ).toEqual(['"user" may be null: check it with "if user != null" or use "?."']);
  });

  it('allows null only before an error', () => {
    expect(errors(`func f() (number, string) { return null, "x" }`)).toEqual([
      'cannot use null as number in return',
    ]);
  });
});

describe('unpacked values', () => {
  it('may be null until the error is checked', () => {
    expect(errors(`${USER}const user, err = loadUser(1)\nconsole.log(user.name)`)).toEqual([
      '"user" may be null until "err" is checked: e.g. if err != null { return }',
    ]);
    expect(errors(`${USER}const user, err = loadUser(1)\nconst u User = user`)).toEqual([
      'cannot use ?User as User: it may be null, check it first',
    ]);
  });

  it('are not null after a branch that leaves on the error', () => {
    expect(
      errors(`${USER}func main() {
    const user, err = loadUser(1)
    if err != null {
        return
    }
    console.log(user.name)
}`),
    ).toEqual([]);
  });

  it('are not null where the error is null', () => {
    expect(
      errors(`${USER}const user, err = loadUser(1)
if err == null {
    console.log(user.name)
} else {
    console.log(err.message)
}
if err == null && user.name != "" {
    console.log(user.name)
}
if !(err != null) {
    console.log(user.name)
}`),
    ).toEqual([]);
  });

  it('stay nullable where the error is not null', () => {
    expect(
      errors(`${USER}const user, err = loadUser(1)
if err != null {
    console.log(user.name)
}`),
    ).toEqual(['"user" may be null until "err" is checked: e.g. if err != null { return }']);
  });

  it('are not linked without the error or in let', () => {
    expect(
      errors(`${USER}const user, _ = loadUser(1)
console.log(user?.name)
let other, err = loadUser(2)
if err != null { throw err }
console.log(other.name)`),
    ).toEqual(['"other" may be null: check it with "if other != null" or use "?."']);
  });

  it('come from several values and from await', () => {
    expect(
      errors(`${USER}func pair() (number, string, error) { return null, null, error("no") }
async func fetchUser() (User, error) { return loadUser(1) }
const n, s, err = pair()
if err != null { throw err }
const total number = n + s.length
const user, failed = await fetchUser()
if failed != null { throw failed }
console.log(user.name, total)`),
    ).toEqual([]);
  });

  it('work without the lib files', () => {
    expect(
      browserErrors(`${USER}const user, err = loadUser(1)
console.log(user.name)
if err != null { throw err }
console.log(user.name)`),
    ).toEqual(['"user" may be null until "err" is checked: e.g. if err != null { return }']);
  });
});

describe('declaration files', () => {
  it('give TypeScript a tuple of the value or the error', () => {
    const { declarations } = compile(
      `export func load() (number, error) { return 1, null }
export async func fetch() (string, error) { return "x", null }
export func find() (?string, error) { return null, null }`,
      { declarations: true },
    );

    expect(declarations).toContain(
      'export declare function load(): [number, null] | [null, Error];',
    );
    expect(declarations).toContain(
      'export declare function fetch(): Promise<[string, null] | [null, Error]>;',
    );
    expect(declarations).toContain(
      'export declare function find(): [string | null, Error | null];',
    );
  });
});
