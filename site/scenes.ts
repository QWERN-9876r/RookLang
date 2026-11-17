import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import type { Trace } from '../src/trace/model.ts';
import { recordTrace, type RecordOptions } from '../src/trace/record.ts';

// The programs that the scenes of the site play, site/scenes/<name>.rk, and their traces. A scene
// plays what the runtime did: when the site is built, each program is run with tracing
// (src/trace/record.ts), and `virtual:scenes` gives the page its code and its traces, so a scene
// plays at once, without the compiler.
//
// One number of a program may be live: the reader changes it on the page. Its line ends with
// `// live: 0..4`, the values it may take; the number in the file is the one the scene starts
// with, and there is a trace for each value.

/** A line with the live number: what is before the number, the number, what is after it, the range. */
const LIVE = /^(\D*?)(\d+)(.*?)\s*\/\/ live: (\d+)\.\.(\d+)$/;

/** What stands for the live number in the lines of a scene. */
export const PLACE = '§';

/** The program of a scene. */
export interface Scene {
  /** The lines of its code; in one of them `§` is the place of the live number, if it has one. */
  lines: string[];
  /** The number the scene starts with, and the values the reader may give it. */
  initial: number;
  values: number[];
}

/** A scene with the trace of its program for each value of the live number, in their order. */
export interface RecordedScene extends Scene {
  traces: Trace[];
}

export function readScene(source: string): Scene {
  const scene: Scene = { lines: [], initial: 0, values: [0] };

  for (const line of source.trimEnd().split('\n')) {
    const live = LIVE.exec(line);

    if (!live || scene.lines.some((each) => each.includes(PLACE))) {
      scene.lines.push(line);
      continue;
    }

    const [, before = '', number, after = '', from, to] = live;

    scene.lines.push(`${before}${PLACE}${after}`);
    scene.initial = Number(number);
    scene.values = Array.from(
      { length: Number(to) - Number(from) + 1 },
      (_, i) => Number(from) + i,
    );
  }

  return scene;
}

/** The code of a scene with `value` as its live number. */
export function sceneSource(scene: Scene, value: number): string {
  return `${scene.lines.join('\n').replace(PLACE, String(value))}\n`;
}

/** Runs the program of a scene with each value of its live number. */
export async function recordScene(
  source: string,
  name: string,
  options: Pick<RecordOptions, 'workers'> = {},
): Promise<RecordedScene> {
  const scene = readScene(source);
  const traces = await Promise.all(
    scene.values.map((value) => recordTrace(sceneSource(scene, value), { name, ...options })),
  );

  return { ...scene, traces };
}

/** The plugin: `virtual:scenes` exports SCENES, the recorded scenes of `site`/scenes by name. */
export function scenes(site: string): Plugin {
  const id = 'virtual:scenes';
  const dir = join(site, 'scenes');

  return {
    name: 'rooklang-scenes',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(loaded) {
      if (loaded !== `\0${id}`) return null;

      const files = readdirSync(dir)
        .filter((file) => file.endsWith('.rk'))
        .sort();
      const recorded = await Promise.all(
        files.map((file) => {
          this.addWatchFile(join(dir, file));

          return recordScene(readFileSync(join(dir, file), 'utf8'), file, {
            workers: file === 'signals.rk' || file === 'topics.rk',
          });
        }),
      );
      const all = Object.fromEntries(
        files.map((file, i) => [file.slice(0, -'.rk'.length), recorded[i]]),
      );

      return `export const SCENES = ${JSON.stringify(all)};\n`;
    },
  };
}
