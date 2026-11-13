import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/build.ts';

// The scene of the documentation site (site/src/stage/) plays a trace of a program. What it draws
// at a moment comes from pure functions of the trace, which are compiled and run here: the canvas
// is not needed to check who runs, who waits and what the buffers hold.

interface Snapshot {
  statuses: string[];
  lines: (number | null)[];
  buffers: string[][];
  closed: boolean[];
}

interface Frame {
  index: number;
  progress: number;
  current: { kind: string } | null;
  before: Snapshot;
  after: Snapshot;
}

interface Trace {
  events: { kind: string }[];
}

interface Script {
  forStart: number;
  forEnd: number;
  goStart: number;
  goEnd: number;
  total: number;
}

interface Moment {
  mainX: number;
  half: number;
  waits: number;
  parts: { colour: number; done: number; x: number; to: number }[];
}

interface Stage {
  scriptOf(oneThread: number, goFor: number): Script;
  stepAt(script: Script, s: number): number;
  momentAt(script: Script, s: number, rooks: number): Moment;
  filesOf(rooks: number): number;
  tilesOf(moment: Moment): number;
  writerOf(moment: Moment, tile: number): number;
  pilotTrace(buffer: number): Trace;
  MAX_BUFFER: number;
  snapshots(trace: Trace): Snapshot[];
  frameAt(trace: Trace, states: Snapshot[], t: number): Frame;
  isStalemate(trace: Trace): boolean;
  files(trace: Trace): string[];
  moveOf(trace: Trace, event: { kind: string }): object | null;
}

let stage: Stage;

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'rook-stage-'));
  const source = new URL('../site/src/stage', import.meta.url).pathname;
  const result = build([source], { outDir });

  expect(result.errors.flatMap((error) => error.diagnostics)).toEqual([]);

  for (const { output, code, maps = [] } of result.outputs) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, code);
    // The modules name their source maps, and Vitest reads them when it loads a module.
    for (const map of maps) writeFileSync(map.output, map.code);
  }

  const load = (name: string) =>
    import(result.outputs.find((each) => each.output.endsWith(name))!.output) as Promise<
      Partial<Stage>
    >;

  stage = {
    ...(await load('pilot.js')),
    ...(await load('state.js')),
    ...(await load('array.js')),
  } as Stage;
});

describe('the scene of the site', () => {
  it('plays the pilot with a buffer of 2 to the end', () => {
    const trace = stage.pilotTrace(2);
    const states = stage.snapshots(trace);
    const last = states.at(-1)!;

    expect(states).toHaveLength(trace.events.length + 1);
    expect(states[0]!.statuses).toEqual(['run', 'none', 'none']);
    expect(last.statuses).toEqual(['done', 'done', 'done']);
    expect(last.buffers).toEqual([[], []]);
    expect(last.closed).toEqual([true, false]);
    expect(stage.isStalemate(trace)).toBe(false);
  });

  it('keeps what was sent with no receiver in the buffer, the oldest first', () => {
    const trace = stage.pilotTrace(2);
    const states = stage.snapshots(trace);
    const closing = trace.events.findIndex((event) => event.kind === 'close');

    // Both goroutines hold a value and wait for a receiver of `results`, so 3 and 4 stay in `jobs`.
    expect(states[closing]!.buffers).toEqual([['3', '4'], []]);
    expect(states[closing]!.statuses).toEqual(['run', 'wait', 'wait']);
    expect(states[closing + 1]!.closed).toEqual([true, false]);
    // The line of the code where each goroutine stands.
    expect(states[closing + 1]!.lines).toEqual([20, 7, 7]);
  });

  it('ends in a stalemate when the buffer is too small', () => {
    for (const buffer of [0, 1]) {
      const trace = stage.pilotTrace(buffer);
      const last = stage.snapshots(trace).at(-1)!;

      expect(stage.isStalemate(trace)).toBe(true);
      expect(last.statuses).toEqual(['wait', 'wait', 'wait']);
    }

    for (let buffer = 2; buffer <= stage.MAX_BUFFER; buffer++) {
      expect(stage.isStalemate(stage.pilotTrace(buffer))).toBe(false);
    }
  });

  it('gives the move being played and the states around it', () => {
    const trace = stage.pilotTrace(2);
    const states = stage.snapshots(trace);
    const frame = stage.frameAt(trace, states, 4.25);

    expect(frame.index).toBe(4);
    expect(frame.progress).toBeCloseTo(0.25);
    expect(frame.current).toBe(trace.events[4]);
    expect(frame.before).toBe(states[4]);
    expect(frame.after).toBe(states[5]);
    // Before the first move and after the last one nothing is being played.
    expect(stage.frameAt(trace, states, -3).index).toBe(0);
    expect(stage.frameAt(trace, states, 99)).toMatchObject({
      index: trace.events.length,
      progress: 0,
      current: null,
    });
  });

  it('puts the channels between main and the other goroutines, and moves along the ranks', () => {
    const trace = stage.pilotTrace(2);

    expect(stage.files(trace)).toEqual(['main', 'jobs', 'results', 'square-1', 'square-2']);
    // `go square(1)`: from main to the file of the new goroutine, in its colour.
    expect(stage.moveOf(trace, trace.events[0]!)).toEqual({
      from: 0,
      to: 3,
      via: -1,
      value: '',
      colour: 1,
    });
    // A value for a goroutine that already waits goes through `jobs` from hand to hand.
    expect(stage.moveOf(trace, trace.events[4]!)).toEqual({
      from: 0,
      to: 3,
      via: 1,
      value: '1',
      colour: 0,
    });
    // With nobody waiting it stops in the buffer.
    expect(stage.moveOf(trace, trace.events[8]!)).toEqual({
      from: 0,
      to: 1,
      via: -1,
      value: '3',
      colour: 0,
    });
    // Waiting moves nothing.
    expect(stage.moveOf(trace, trace.events[1]!)).toBeNull();
  });

  it('walks the array with one rook, then with a rook on each part at once', () => {
    const script = stage.scriptOf(1000, 125);
    const writers = (s: number, rooks: number) => {
      const moment = stage.momentAt(script, s, rooks);

      return Array.from({ length: stage.tilesOf(moment) }, (_, tile) =>
        stage.writerOf(moment, tile),
      );
    };

    // go for takes as much less time on the screen as it was measured to.
    expect((script.goEnd - script.goStart) / (script.forEnd - script.forStart)).toBeCloseTo(0.125);
    expect(stage.filesOf(4)).toBe(10);
    expect(stage.filesOf(14)).toBe(16);

    expect(new Set(writers(0, 4))).toEqual(new Set([-1]));
    // Half of the loop in one thread: `main` has written the first half of the tiles.
    expect(writers((script.forStart + script.forEnd) / 2, 4)).toEqual([
      ...Array.from({ length: 8 }, () => 0),
      ...Array.from({ length: 8 }, () => -1),
    ]);
    expect(new Set(writers(script.forEnd, 14))).toEqual(new Set([0]));

    // In the middle of go for every part is under way, and `main` waits at the far side.
    const middle = stage.momentAt(script, (script.goStart + script.goEnd) / 2, 8);

    expect(middle.mainX).toBe(middle.half + 0.5);
    expect(middle.waits).toBe(1);
    expect(middle.parts).toHaveLength(8);

    for (const part of middle.parts) {
      expect(part.done).toBeGreaterThan(0.4);
      expect(part.done).toBeLessThan(0.6);
    }

    // At the end each tile was written by the goroutine of its part.
    expect(writers(script.total, 4)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 1, 1, 1, 1]);
    expect(stage.momentAt(script, script.total, 4).waits).toBe(0);
  });

  it('names the step of the scene of go for at a moment', () => {
    const script = stage.scriptOf(1000, 125);

    expect(stage.stepAt(script, 0)).toBe(0);
    expect(stage.stepAt(script, script.forStart)).toBe(1);
    expect(stage.stepAt(script, script.forEnd)).toBe(2);
    expect(stage.stepAt(script, script.goStart)).toBe(4);
    expect(stage.stepAt(script, script.total)).toBe(5);
  });
});
