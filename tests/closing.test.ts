import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.ts';

// A channel, a topic or a tick that the module makes and never closes is a warning. A variable is
// closed by close(x), or by a function of the module that closes the parameter it is passed to;
// one that goes where the module does not see is not checked.

function warnings(source: string): string[] {
  const result = compile(source);

  expect(result.diagnostics).toEqual([]);

  return result.warnings.map((warning) => warning.message);
}

describe('channels that are never closed', () => {
  it('warns of a channel, a topic and a tick without close', () => {
    expect(
      warnings(`const jobs = chan<number>(10)
const cart = topic<string>("cart")
const ticks = tick(100)
const made = Channel.make(1, "")
jobs <- 1
cart <- "x"`),
    ).toEqual([
      '"jobs" is never closed: close it when nothing more is sent, e.g. close(jobs)',
      expect.stringContaining('"cart" is never closed, and a topic listens until it is closed'),
      '"ticks" is never closed, and a tick runs until it is closed: e.g. close(ticks)',
      expect.stringContaining('"made" is never closed'),
    ]);
  });

  it('is quiet when any line closes it, also in a function or with Channel.close', () => {
    expect(
      warnings(`const jobs = chan<number>(10)
const cart = topic<string>("cart")
const ticks = tick(100)
const other = chan<number>()
async func stop() {
    close(jobs)
}
func later() {
    Topic.close(cart)
}
Channel.close(ticks)
const done = () => close(other)`),
    ).toEqual([]);
  });

  it('follows a channel into the functions of the module that close their parameter', () => {
    expect(
      warnings(`async func produce(out chan<- number) {
    out <- 1
    close(out)
}
async func pass(out chan<- number) {
    await produce(out)
}
async func keep(out chan<- number) {
    out <- 2
}
const a = chan<number>(1)
const b = chan<number>(1)
const c = chan<number>(1)
go produce(a)
pass(b)
keep(c)
go func(out chan<- number) {
    close(out)
}(chan<number>())
const d = chan<number>(1)
go func(out chan<- number) {
    close(out)
}(d)`),
    ).toEqual(['"c" is never closed: close it when nothing more is sent, e.g. close(c)']);
  });

  it('leaves to other code a channel that goes where the module does not see', () => {
    expect(
      warnings(`import { consume } from "./other.js"
const a = chan<number>()
const b = chan<number>()
const c = chan<number>()
const d = chan<number>()
const e = chan<chan number>(1)
const f = chan<number>()
export const g = chan<number>()
func give() chan number {
    return a
}
consume(b)
const box = { channel: c }
const copy = d
async func send() {
    e <- f
}`),
    ).toEqual(['"e" is never closed: close it when nothing more is sent, e.g. close(e)']);
  });

  it('does not check what closes itself or is not made here', () => {
    expect(
      warnings(`const timeout = after(100)
const chunks, failed = chan(new Response("x").body, 2)
let empty chan number
let stub topic number
func f(ch chan number) {}`),
    ).toEqual([]);
  });

  it('keeps names apart: a close of another variable of the same name does not count', () => {
    expect(
      warnings(`const ch = chan<number>()
func f() {
    const ch = chan<number>()
    close(ch)
}`),
    ).toEqual(['"ch" is never closed: close it when nothing more is sent, e.g. close(ch)']);
  });
});
