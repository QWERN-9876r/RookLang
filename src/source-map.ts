import { SourceFile } from './source.ts';

// Source maps: where the code of each statement came from, so that stack traces and debuggers show
// the lines of the `.rk` file. The generator writes a mark at the start of the first line of each
// statement, with the offset of the statement in the source (codegen/simple-statements.ts); the
// marks are taken out of the finished code, and their places become the mappings of a source map,
// version 3 (https://tc39.es/ecma426/). A line without a mark of its own, such as the next line of
// a call written over several, goes with the last mark before it.

export interface SourceMap {
  version: 3;
  file?: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

const MARK = /([0-9a-z]+)/g;

/** The mark of a place in the source, `<offset in base 36>`, which code cannot contain. */
export function sourceMark(offset: number): string {
  return `${offset.toString(36)}`;
}

/** The code without its marks, and the source map of them. */
export function withoutMarks(
  code: string,
  source: string,
  sourceName: string,
): { code: string; map: SourceMap } {
  const file = new SourceFile(sourceName, source);
  const lines: string[] = [];
  const segments: string[] = [];
  // The previous segment, relative to which the next one is written.
  let previous = { line: 0, column: 0 };
  let started = false;

  for (const text of code.split('\n')) {
    const places: { generated: number; line: number; column: number }[] = [];
    let removed = 0;
    const clean = text.replace(MARK, (mark, offset: string, index: number) => {
      const { line, column } = file.position(parseInt(offset, 36));

      places.push({ generated: index - removed, line: line - 1, column: column - 1 });
      removed += mark.length;

      return '';
    });

    if (places.length === 0 && started && clean.trim() !== '') {
      places.push({ generated: 0, ...previous });
    }

    let generated = 0;

    segments.push(
      places
        .map((place) => {
          const segment = vlq([
            place.generated - generated,
            // The index of the source, which is always the one.
            0,
            place.line - previous.line,
            place.column - previous.column,
          ]);

          generated = place.generated;
          previous = { line: place.line, column: place.column };
          started = true;

          return segment;
        })
        .join(','),
    );
    lines.push(clean);
  }

  return {
    code: lines.join('\n'),
    map: {
      version: 3,
      sources: [sourceName],
      sourcesContent: [source],
      names: [],
      mappings: segments.join(';'),
    },
  };
}

/** The comment at the end of a module that tells where its source map is. */
export function sourceMapComment(url: string): string {
  return `//# sourceMappingURL=${url}\n`;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Numbers in base 64 VLQ: five bits a digit, the lowest first, and the sign in the lowest bit. */
function vlq(numbers: readonly number[]): string {
  let text = '';

  for (const number of numbers) {
    let value = number < 0 ? (-number << 1) | 1 : number << 1;

    do {
      let digit = value & 31;

      value >>>= 5;
      if (value > 0) digit |= 32;
      text += BASE64[digit];
    } while (value > 0);
  }

  return text;
}
