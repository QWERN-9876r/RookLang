import { describe, expect, it } from 'vitest';
import { compile as compileBrowser } from '../src/browser.ts';
import { compileModule } from '../src/compile.ts';
import { recordTrace } from '../src/trace/record.ts';

// Tracing: with the option `trace` the generated code tells the runtime where each operation of
// goroutines and channels is, the runtime tells a listener what happens (src/runtime/trace.js),
// and a recording (src/trace/record.ts) runs a program in one thread and gives its trace.

const WORKER = `async func worker(jobs <-chan number, done chan<- string) {
    for n in jobs {
        done <- \`got \${n}\`
    }
}

const jobs = chan<number>(1)
const done = chan<string>()
go worker(jobs, done)
jobs <- 7
close(jobs)
console.log(<-done)
`;

describe('the option trace of the compiler', () => {
  it('lets the browser compiler opt into source locations for a live trace', () => {
    const compiled = compileBrowser(WORKER, './main.worker.js', {
      runtime: 'inline',
      trace: true,
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.code).toContain('await $$channels.send(jobs, 7, 10);');
    expect(compiled.worker).toContain('await $$channels.send(done, `got ${n}`, 3);');
  });

  it('passes the lines of the operations and the names of the channels to the runtime', () => {
    const { code, worker, diagnostics } = compileModule(WORKER, { trace: true });

    expect(diagnostics).toEqual([]);
    expect(code).toContain('const $$go = (name, args, line) =>');
    expect(code).toContain('$$goWorker($$startWorker, name, args, line);');
    expect(code).toContain('const jobs = $$channels.make(1, 0, "jobs", 7);');
    expect(code).toContain('const done = $$channels.make(0, "", "done", 8);');
    expect(code).toContain('$$go("worker", [jobs, done], 9);');
    expect(code).toContain('await $$channels.send(jobs, 7, 10);');
    expect(code).toContain('$$channels.close(jobs, 11);');
    expect(code).toContain('await $$channels.receive(done, false, "", 12)');
    expect(worker).toContain('for await (const n of $$channels.range(jobs, 2)) {');
    expect(worker).toContain('await $$channels.send(done, `got ${n}`, 3);');
  });

  it('passes source lines through the Channel object methods', () => {
    const { code, diagnostics } = compileModule(
      `const jobs = Channel.make(1, 0)
await Channel.send(jobs, 7)
const value = await Channel.receive(jobs)
`,
      { trace: true },
    );

    expect(diagnostics).toEqual([]);
    expect(code).toContain('const jobs = $$channels.make(1, 0, "", 1);');
    expect(code).toContain('await $$traceAwait($$channels.send(jobs, 7, 2), 2);');
    expect(code).toContain('await $$traceAwait($$channels.receive(jobs, false, null, 3), 3)');
  });

  it('leaves the code as it was without the option', () => {
    const { code, worker } = compileModule(WORKER);

    expect(code).toContain('const $$go = (name, args) => $$goWorker($$startWorker, name, args);');
    expect(code).toContain('const jobs = $$channels.make(1, 0);');
    expect(code).toContain('$$go("worker", [jobs, done]);');
    expect(code).toContain('await $$channels.send(jobs, 7);');
    expect(code).toContain('$$channels.close(jobs);');
    expect(code).toContain('await $$channels.receive(done, false, "")');
    expect(worker).toContain('for await (const n of $$channels.range(jobs)) {');
  });
});

describe('a recorded trace', () => {
  it('has the goroutines, the channels and every move in its order', async () => {
    const trace = await recordTrace(WORKER);

    expect(trace.actors).toEqual([
      { id: 'main', label: 'main' },
      { id: 'worker-1', label: 'worker' },
    ]);
    expect(trace.channels).toEqual([
      { id: 'jobs', label: 'jobs', size: 1 },
      { id: 'done', label: 'done', size: 0 },
    ]);
    expect(trace.events).toEqual([
      { kind: 'go', actor: 'main', task: 'worker-1', line: 9, args: '{…}, {…}' },
      // With nobody to receive it, the value stops in the buffer; the goroutine takes it there.
      {
        kind: 'pass',
        actor: 'main',
        channel: 'jobs',
        from: 'main',
        to: null,
        value: '7',
        line: 10,
      },
      {
        kind: 'pass',
        actor: 'worker-1',
        channel: 'jobs',
        from: null,
        to: 'worker-1',
        value: '7',
        line: 2,
      },
      { kind: 'close', actor: 'main', channel: 'jobs', line: 11 },
      { kind: 'wait', actor: 'main', op: 'receive', channel: 'done', line: 12 },
      // From hand to hand: the one who came to the channel later made the move.
      {
        kind: 'pass',
        actor: 'worker-1',
        channel: 'done',
        from: 'worker-1',
        to: 'main',
        value: 'got 7',
        line: 3,
      },
      { kind: 'return', actor: 'worker-1', to: 'main', value: 'undefined', line: 9 },
      { kind: 'end', actor: 'worker-1' },
      { kind: 'end', actor: 'main' },
    ]);
  });

  it('records copied arguments and a goroutine result', async () => {
    const trace = await recordTrace(`func square(n number) number {
    return n * n
}

const result = await go square(7)
console.log(result)
`);

    expect(trace.events).toEqual([
      { kind: 'go', actor: 'main', task: 'square-1', line: 5, args: '7' },
      { kind: 'turn', actor: 'main', task: 1, phase: 'wait', line: 5 },
      { kind: 'return', actor: 'square-1', to: 'main', value: '49', line: 5 },
      { kind: 'end', actor: 'square-1' },
      { kind: 'turn', actor: 'main', task: 1, phase: 'resume', line: 5 },
      { kind: 'end', actor: 'main' },
    ]);
  });

  it('records copied arguments and a result across a worker boundary', async () => {
    const trace = await recordTrace(
      `func square(n number) number {
    return n * n
}

const result = await go square(7)
console.log(result)
`,
      { workers: true },
    );

    expect(trace.events).toEqual([
      { kind: 'go', actor: 'main', task: 'square-1', line: 5, args: '7' },
      { kind: 'turn', actor: 'main', task: 1, phase: 'wait', line: 5 },
      { kind: 'return', actor: 'square-1', to: 'main', value: '49', line: 5 },
      { kind: 'end', actor: 'square-1' },
      { kind: 'turn', actor: 'main', task: 1, phase: 'resume', line: 5 },
      { kind: 'end', actor: 'main' },
    ]);
  });

  it('records the candidate lines of a select before the ready case runs', async () => {
    const trace = await recordTrace(`const ready = chan<number>(1)
const later = chan<number>(1)
ready <- 7
select {
case value = <-ready:
    console.log(value)
case value = <-later:
    console.log(value)
}
`);

    expect(trace.events.find((event) => event.kind === 'select')).toEqual({
      kind: 'select',
      actor: 'main',
      line: 4,
      lines: [5, 7],
    });
    expect(trace.events.find((event) => event.kind === 'pass' && event.line === 5)).toMatchObject({
      channel: 'ready',
      from: null,
      to: 'main',
      value: '7',
    });
  });

  it('records topic broadcasts sent by a real worker', async () => {
    const trace = await recordTrace(
      `const progress = topic<number>("trace-topic")

async func show(t topic number) {
    for value in t {
        console.log(value)
    }
}

func work(t topic number) number {
    t <- 7
    return 7
}

show(progress)
await go work(progress)
<-after(10)
close(progress)
`,
      { workers: true },
    );

    expect(trace.events.find((event) => event.kind === 'publish')).toMatchObject({
      kind: 'publish',
      actor: 'work-1',
      channel: 'trace-topic',
      value: '7',
    });
  });

  it('records a goroutine cancellation as a move by its caller', async () => {
    const trace = await recordTrace(
      `async func work() number {
    <-after(1000)
    return 1
}

const task = go work()
<-after(10)
cancel(task)
try {
    await task
} catch {
    console.log("cancelled")
}
`,
      { workers: true },
    );

    expect(trace.events.find((event) => event.kind === 'cancel')).toMatchObject({
      kind: 'cancel',
      actor: 'main',
      task: 'work-1',
      line: 8,
    });
  });

  it('records go-for as several goroutines over copied parts', async () => {
    const trace = await recordTrace(`const values = [1, 2, 3, 4]
go for i, value in values {
    values[i] = value * 2
}
`);

    expect(trace.events.filter((event) => event.kind === 'go')).toHaveLength(4);
    expect(trace.events.filter((event) => event.kind === 'return')).toHaveLength(4);
    expect(trace.actors).toHaveLength(5);
  });

  it('traces chunks as they pass from a stream into its channel', async () => {
    const trace = await recordTrace(`const input = new ReadableStream({
    start(controller any) {
        controller.enqueue("one")
        controller.enqueue("two")
        controller.close()
    },
})
const chunks, failed = chan(input, 1)
for chunk in chunks {
    console.log(chunk)
}
console.log("error:", <-failed)
`);

    const passes = trace.events.filter((event) => event.kind === 'pass');

    expect(passes.filter((event) => event.value === 'one' || event.value === 'two')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'one', line: 8 }),
        expect.objectContaining({ value: 'two', line: 8 }),
      ]),
    );
    expect(passes.some((event) => event.line === 9 && event.value === 'two')).toBe(true);
  });

  it('is the same every time', async () => {
    const [first, second] = await Promise.all([recordTrace(WORKER), recordTrace(WORKER)]);

    expect(second).toEqual(first);
  });

  it('records channel events from real workers, including nested goroutines', async () => {
    const trace = await recordTrace(
      `async func inner(source <-chan number, out chan<- number) {
    out <- <-source
}

async func outer(source <-chan number, out chan<- number) {
    go inner(source, out)
}

const source = chan<number>()
const out = chan<number>()
go outer(source, out)
source <- 7
console.log(<-out)
`,
      { workers: true },
    );

    expect(trace.actors.map((actor) => actor.label)).toEqual(['main', 'outer', 'inner']);
    expect(trace.events.filter((event) => event.kind === 'go')).toHaveLength(2);
    expect(
      trace.events
        .filter((event) => event.kind === 'pass')
        .map((event) => [event.from, event.to, event.value]),
    ).toEqual([
      ['main', 'outer-1/inner-1', '7'],
      ['outer-1/inner-1', 'main', '7'],
    ]);
    expect(trace.events.filter((event) => event.kind === 'end')).toHaveLength(3);
  });

  it('ends in a stalemate when main waits and nothing can happen', async () => {
    const trace = await recordTrace('const ch = chan<number>()\nch <- 1\n');

    expect(trace.events).toEqual([
      { kind: 'wait', actor: 'main', op: 'send', channel: 'ch', line: 2 },
      { kind: 'stalemate' },
    ]);
  });

  it('numbers the goroutines of one function and the channels of one name', async () => {
    const trace = await recordTrace(`async func echo(from <-chan number, to chan<- number) {
    to <- <-from
}

func pipe() chan number {
    const link = chan<number>()
    return link
}

const a = pipe()
const b = pipe()
const c = pipe()
go echo(a, b)
go echo(b, c)
a <- 5
console.log(<-c)
`);

    expect(trace.actors.map((actor) => actor.label)).toEqual(['main', 'echo 1', 'echo 2']);
    expect(trace.channels.map((channel) => channel.id)).toEqual(['link-1', 'link-2', 'link-3']);
    expect(
      trace.events.flatMap((event) =>
        event.kind === 'pass' ? [[event.channel, event.from, event.to, event.value]] : [],
      ),
    ).toEqual([
      ['link-1', 'main', 'echo-1', '5'],
      ['link-2', 'echo-1', 'echo-2', '5'],
      ['link-3', 'echo-2', 'main', '5'],
    ]);
    expect(trace.events.at(-1)).toEqual({ kind: 'end', actor: 'main' });
  });

  it('says what is wrong with a program that does not compile or fails', async () => {
    await expect(recordTrace('const n number = "one"\n', { name: 'scene.rk' })).rejects.toThrow(
      /cannot record a trace of scene\.rk/,
    );
    await expect(recordTrace('throw error("broken")\n', { name: 'scene.rk' })).rejects.toThrow(
      /scene\.rk failed while its trace was recorded:[^]*broken/,
    );
  });
});
