import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Headless Chrome for the scripts that need a browser: the pictures for links (og-image.ts) and
// the pages of the built site with their text (prerender.ts). The path to Chrome is taken from
// $CHROME, else the usual ones are tried; prerender.ts drives it through the DevTools protocol.

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function chrome(): string {
  const path = process.env.CHROME ?? CHROMES.find((candidate) => existsSync(candidate));

  if (path === undefined) throw new Error('Chrome is not found; give its path in $CHROME');

  return path;
}

/** A tab of headless Chrome, driven through the DevTools protocol. */
export interface Tab {
  /** Opens the address and waits until the page has loaded. */
  open(url: string): Promise<void>;
  /** The value of `expression`, awaited if it is a Promise; it must be JSON. */
  evaluate<T>(expression: string): Promise<T>;
  /** Closes Chrome and removes its profile. */
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts Chrome with a profile of its own, which goes away with it, and connects to its tab. */
export async function openTab(width = 1400, height = 1000): Promise<Tab> {
  const profile = mkdtempSync(join(tmpdir(), 'rook-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const browser = spawn(
    chrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];

  for (let tries = 0; targets.length === 0; tries++) {
    if (tries === 100) throw new Error('Chrome did not start');
    await sleep(100);
    targets = await fetch(`http://127.0.0.1:${port}/json`)
      .then((response) => response.json() as Promise<typeof targets>)
      .then((all) => all.filter((target) => target.type === 'page'))
      .catch(() => []);
  }

  const socket = new WebSocket(targets[0]!.webSocketDebuggerUrl);
  const pending = new Map<number, (message: Message) => void>();
  const events = new Map<string, () => void>();
  let id = 0;

  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as Message;

    if (message.id !== undefined) pending.get(message.id)?.(message);
    if (message.method !== undefined) events.get(message.method)?.();
  });

  const send = (method: string, params: object = {}) =>
    new Promise<Message>((resolve) => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');

  return {
    async open(url) {
      const loaded = new Promise<void>((resolve) => events.set('Page.loadEventFired', resolve));

      await send('Page.navigate', { url });
      await loaded;
    },
    async evaluate<T>(expression: string) {
      const { result } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });

      if (result?.exceptionDetails) {
        throw new Error(`${expression.slice(0, 80)}: ${JSON.stringify(result.exceptionDetails)}`);
      }

      return result?.result?.value as T;
    },
    async close() {
      const exited = new Promise((resolve) => browser.once('exit', resolve));

      socket.close();
      browser.kill();
      await exited;
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

interface Message {
  id?: number;
  method?: string;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
}
