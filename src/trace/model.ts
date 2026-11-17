// A trace: what a program did with its goroutines and channels, move by move, as a recording
// gives it (record.ts). The scenes of the documentation site play traces, and
// site/src/stage/trace.rk has the same types for them.

/** A goroutine; the first one of a trace is the program itself, `main`. */
export interface Actor {
  id: string;
  label: string;
}

/** A channel and the room in its buffer; 0 is a channel without a buffer. */
export interface Channel {
  id: string;
  label: string;
  size: number;
}

/** `line` is the line of the operation in the source, from 1. */
export type TraceEvent =
  /** `go f(x)`: `actor` starts `task`, with optional short text for the copied arguments. */
  | { kind: 'go'; actor: string; task: string; line: number; args?: string }
  /** A goroutine returns its result to the actor that started it. */
  | { kind: 'return'; actor: string; to: string; value: string; line: number }
  /** The lines of a `select` that may go on. */
  | { kind: 'select'; actor: string; line: number; lines: number[] }
  /** An async task waits or resumes on the same thread. */
  | { kind: 'turn'; actor: string; task: number; phase: 'wait' | 'resume'; line: number }
  /** A topic broadcasts a value to its subscribers. */
  | { kind: 'publish'; actor: string; channel: string; value: string; line: number }
  /** `cancel(task)`: the caller stops a goroutine. */
  | { kind: 'cancel'; actor: string; task: string; line: number }
  /** An operation that cannot go on yet. */
  | { kind: 'wait'; actor: string; op: 'send' | 'receive'; channel: string; line: number }
  /**
   * A value goes through a channel, and `actor` made the move: from hand to hand, into the buffer
   * (`to` is null) or out of it (`from` is null).
   */
  | {
      kind: 'pass';
      actor: string;
      channel: string;
      from: string | null;
      to: string | null;
      value: string;
      line: number;
    }
  | { kind: 'close'; actor: string; channel: string; line: number }
  /** The goroutine has finished. */
  | { kind: 'end'; actor: string }
  /** `main` waits and nothing can happen any more: the program hangs. */
  | { kind: 'stalemate' };

export interface Trace {
  actors: Actor[];
  channels: Channel[];
  events: TraceEvent[];
}
