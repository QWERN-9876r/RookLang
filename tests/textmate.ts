import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';

// The grammar of the VS Code extension in editors/vscode, run by the same engine that VS Code uses,
// for tests/vscode-grammar.test.ts.

export const root = new URL('..', import.meta.url).pathname;

// The grammars of markup and styles are separate files that the main one includes, as in VS Code.
const grammarPaths: Record<string, string> = {
  'source.rook': join(root, 'editors/vscode/syntaxes/rook.tmLanguage.json'),
  'source.rook.markup': join(root, 'editors/vscode/syntaxes/rook-markup.tmLanguage.json'),
  'source.rook.css': join(root, 'editors/vscode/syntaxes/rook-css.tmLanguage.json'),
};

let grammar: textmate.IGrammar;

/** Loads the grammar, before the tests: `beforeAll(loadGrammar)`. */
export async function loadGrammar(): Promise<void> {
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'),
  );

  await oniguruma.loadWASM(wasm.buffer);

  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: (scopeName) => {
      const path = grammarPaths[scopeName];

      return Promise.resolve(
        path ? textmate.parseRawGrammar(readFileSync(path, 'utf8'), path) : null,
      );
    },
  });
  const loaded = await registry.loadGrammar('source.rook');

  if (!loaded) throw new Error('the grammar did not load');
  grammar = loaded;
}

export interface Token {
  text: string;
  scopes: string[];
}

/** Tokens of each line, and the rule stack after the last line. */
export function tokenize(source: string): { tokens: Token[]; stack: textmate.StateStack } {
  const tokens: Token[] = [];
  let stack = textmate.INITIAL;

  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, stack);

    for (const token of result.tokens) {
      tokens.push({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes });
    }

    stack = result.ruleStack;
  }

  return { tokens, stack };
}

/** The innermost scope of each token with this text, in order. */
export function scopesOf(source: string, text: string): string[] {
  return tokenize(source)
    .tokens.filter((token) => token.text === text)
    .map((token) => token.scopes.at(-1)!.replace(/\.rook$/, ''));
}

export function scopeOf(source: string, text: string): string {
  const [scope] = scopesOf(source, text);

  if (scope === undefined) throw new Error(`no token "${text}" in ${source}`);

  return scope;
}
