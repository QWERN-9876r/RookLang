import { describe, expect, it } from 'vitest';
import { compileModule } from '../src/compile.ts';

const COUNTER = `comp Counter() {
    state count = 0
    return <main>
        <button onClick={count++}>{count}</button>
        <p>{count * 2}</p>
        <small>still here</small>
    </main>
}
document.body.append(<Counter />)
`;

const BOUND = `comp Input(bind value string) {
    return <input bind:value={value} />
}
comp App() {
    state name = ""
    return <Input bind:value={name} />
}
document.body.append(<App />)
`;

const SHARED = `state name = ""
comp App() {
    return <button onClick={name += "x"}>{name}</button>
}
document.body.append(<App />)
`;

describe('tracing reactive updates', () => {
  it('reports the state and only its dependent updates when enabled', () => {
    const traced = compileModule(COUNTER, { trace: true, markup: true });
    const plain = compileModule(COUNTER, { markup: true });

    expect(traced.diagnostics).toEqual([]);
    expect(traced.code).toContain(
      '$$traceReactive({ kind: "state", name: "count", value: count });',
    );
    expect(traced.code).toContain('$$traceReactive({ kind: "update", name: "count", target: 0 });');
    expect(traced.code).toContain('$$traceReactive({ kind: "update", name: "count", target: 1 });');
    expect(plain.diagnostics).toEqual([]);
    expect(plain.code).not.toContain('$$traceReactive');
  });

  it('traces state changes that pass through bound properties and module state', () => {
    const bound = compileModule(BOUND, { trace: true, markup: true });
    const shared = compileModule(SHARED, { trace: true, markup: true });

    expect(bound.diagnostics).toEqual([]);
    expect(bound.code).toContain(
      '$$traceReactive({ kind: "state", name: "value", value: value });',
    );
    expect(bound.code).toContain('$$traceReactive({ kind: "state", name: "name", value: name });');
    expect(shared.diagnostics).toEqual([]);
    expect(shared.code).toContain('$$traceReactive({ kind: "state", name: "name", value: name });');
  });
});
