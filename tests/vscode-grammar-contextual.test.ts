import { beforeAll, describe, expect, it } from 'vitest';
import { loadGrammar, scopeOf } from './textmate.ts';

// Words of the VS Code grammar that are keywords only in some places and names elsewhere.

beforeAll(loadGrammar);

describe('VS Code grammar: contextual keywords', () => {
  it('colours as and delete only where they are keywords', () => {
    expect(scopeOf('const n = x as number', 'as')).toBe('keyword.operator.expression.as');
    expect(scopeOf('const as = 1', 'as')).not.toBe('keyword.operator.expression.as');
    expect(scopeOf('    delete scores[name]', 'delete')).toBe('keyword.operator.expression.delete');
    expect(scopeOf('<p onClick={delete counts.a} />', 'delete')).toBe(
      'keyword.operator.expression.delete',
    );
    expect(scopeOf('const f = (delete number) => delete', 'delete')).not.toBe(
      'keyword.operator.expression.delete',
    );
  });

  it('treats ref as a keyword only at the start of a declaration', () => {
    expect(scopeOf('    ref input', 'ref')).toBe('storage.type.state');
    expect(scopeOf('    ref box HTMLElement', 'ref')).toBe('storage.type.state');
    expect(scopeOf('let ref = 1', 'ref')).toBe('variable.other.readwrite');
    expect(scopeOf('ref = 2', 'ref')).toBe('variable.other.readwrite');
  });

  it('treats state as a keyword only at the start of a declaration', () => {
    expect(scopeOf('    state count = 0', 'state')).toBe('storage.type.state');
    expect(scopeOf('let state = load()', 'state')).toBe('variable.other.readwrite');
    expect(scopeOf('state = 2', 'state')).toBe('variable.other.readwrite');
  });

  it('treats type as a keyword only at the start of a statement, and colours void and never', () => {
    expect(scopeOf('type Id string', 'type')).toBe('storage.type');
    expect(scopeOf('export type Pair<A, B any> { first A }', 'Pair')).toBe('entity.name.type');
    expect(scopeOf('const type = blob.type', 'type')).toBe('variable.other.readwrite');
    expect(scopeOf('func mime(type string) {', 'type')).not.toBe('storage.type');
    expect(scopeOf('func fail() never {', 'never')).toBe('support.type.primitive');
    expect(scopeOf('close() Promise<void>', 'void')).toBe('support.type.primitive');
  });
});
