import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, complete } from '../src/browser.ts';
import { build } from '../src/build.ts';

// The documentation site (site/) is a real Rook program: building it checks the compiler on
// real code. Its examples are compiled in the browser by src/browser.ts, so they are checked here
// with the same entry point.

const site = (path: string) => new URL(`../site/${path}`, import.meta.url).pathname;

describe('documentation site', () => {
  it('compiles without errors', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'rook-site-'));
    const result = build([site('src'), site('server.rk')], { outDir });

    expect(result.errors.flatMap((error) => error.diagnostics)).toEqual([]);
    expect(result.outputs.map((output) => output.output.slice(outDir.length + 1)).sort()).toEqual([
      'server.js',
      'src/code-view.js',
      'src/compiled-view.js',
      'src/console-view.js',
      'src/docs/key.js',
      'src/docs/page.js',
      'src/docs/search-button.js',
      'src/docs/search-dialog.js',
      'src/en/cases.js',
      'src/en/docs.js',
      'src/en/examples.js',
      'src/en/guide.js',
      'src/en/guide/adoption.js',
      'src/en/guide/async-iterables.js',
      'src/en/guide/async.js',
      'src/en/guide/channel-objects.js',
      'src/en/guide/channels.js',
      'src/en/guide/classes.js',
      'src/en/guide/components.js',
      'src/en/guide/control.js',
      'src/en/guide/decode.js',
      'src/en/guide/decorators.js',
      'src/en/guide/errors.js',
      'src/en/guide/functions.js',
      'src/en/guide/generics.js',
      'src/en/guide/goroutines.js',
      'src/en/guide/intro.js',
      'src/en/guide/iterators.js',
      'src/en/guide/markup.js',
      'src/en/guide/modules.js',
      'src/en/guide/mounting.js',
      'src/en/guide/null-safety.js',
      'src/en/guide/numbers.js',
      'src/en/guide/queues.js',
      'src/en/guide/reactivity.js',
      'src/en/guide/refs.js',
      'src/en/guide/select.js',
      'src/en/guide/signals.js',
      'src/en/guide/streams.js',
      'src/en/guide/styles.js',
      'src/en/guide/tools.js',
      'src/en/guide/topics.js',
      'src/en/guide/try.js',
      'src/en/guide/variables.js',
      'src/en/guide/web-components.js',
      'src/en/home-strings.js',
      'src/en/home.js',
      'src/en/playground.js',
      'src/en/roadmap-text.js',
      'src/en/roadmap.js',
      'src/en/strings.js',
      'src/example.js',
      'src/examples/case-view.js',
      'src/examples/page.js',
      'src/handwritten-view.js',
      'src/highlight-css.js',
      'src/highlight.js',
      'src/home/call-to-action.js',
      'src/home/code.js',
      'src/home/compare.js',
      'src/home/counter.js',
      'src/home/feature.js',
      'src/home/features.js',
      'src/home/hero.js',
      'src/home/lanes.js',
      'src/home/page.js',
      'src/home/start.js',
      'src/home/step.js',
      'src/i18n.js',
      'src/layout/brand.js',
      'src/layout/footer.js',
      'src/layout/header.js',
      'src/layout/page-link.js',
      'src/layout/reveal.js',
      'src/playground/page.js',
      'src/result-view.js',
      'src/roadmap/page.js',
      'src/ru/cases.js',
      'src/ru/docs.js',
      'src/ru/examples.js',
      'src/ru/guide.js',
      'src/ru/guide/adoption.js',
      'src/ru/guide/async-iterables.js',
      'src/ru/guide/async.js',
      'src/ru/guide/channel-objects.js',
      'src/ru/guide/channels.js',
      'src/ru/guide/classes.js',
      'src/ru/guide/components.js',
      'src/ru/guide/control.js',
      'src/ru/guide/decode.js',
      'src/ru/guide/decorators.js',
      'src/ru/guide/errors.js',
      'src/ru/guide/functions.js',
      'src/ru/guide/generics.js',
      'src/ru/guide/goroutines.js',
      'src/ru/guide/intro.js',
      'src/ru/guide/iterators.js',
      'src/ru/guide/markup.js',
      'src/ru/guide/modules.js',
      'src/ru/guide/mounting.js',
      'src/ru/guide/null-safety.js',
      'src/ru/guide/numbers.js',
      'src/ru/guide/queues.js',
      'src/ru/guide/reactivity.js',
      'src/ru/guide/refs.js',
      'src/ru/guide/select.js',
      'src/ru/guide/signals.js',
      'src/ru/guide/streams.js',
      'src/ru/guide/styles.js',
      'src/ru/guide/tools.js',
      'src/ru/guide/topics.js',
      'src/ru/guide/try.js',
      'src/ru/guide/variables.js',
      'src/ru/guide/web-components.js',
      'src/ru/home-strings.js',
      'src/ru/home.js',
      'src/ru/playground.js',
      'src/ru/roadmap-text.js',
      'src/ru/roadmap.js',
      'src/ru/strings.js',
      'src/sandbox.js',
      'src/sections.js',
      // The RookUI kit, which the pages import.
      'ui/button.js',
      'ui/callout.js',
      'ui/card-grid.js',
      'ui/card.js',
      'ui/code-block.js',
      'ui/copy-button.js',
      'ui/drawer.js',
      'ui/icon-button.js',
      'ui/icon-link.js',
      'ui/icon.js',
      'ui/link-button.js',
      'ui/nav-list.js',
      'ui/prose.js',
      'ui/tabs.js',
      'ui/theme.js',
    ]);
    expect(result.warnings).toEqual([]);
  }, 15_000);

  // English examples are in site/examples, Russian ones in site/examples/ru. The guide of a
  // language is guide.rk with a module for each of its sections, in guide/, which show examples
  // with <Example />; the page of examples lists its cases in cases.rk, each with its example.
  const languages = [
    { language: 'en', examples: 'examples', guide: 'src/en/guide', cases: 'src/en/cases.rk' },
    { language: 'ru', examples: 'examples/ru', guide: 'src/ru/guide', cases: 'src/ru/cases.rk' },
  ];
  const examplesOf = (dir: string) => readdirSync(site(dir)).filter((name) => name.endsWith('.rk'));
  const all = languages.flatMap(({ examples }) =>
    examplesOf(examples).map((name) => `${examples}/${name}`),
  );

  it.each(all)('compiles the example %s in the browser compiler', (path) => {
    const result = compile(readFileSync(site(path), 'utf8'), null, { markup: true });

    expect(result.diagnostics).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.code).not.toBe('');
  });

  it.each(languages)('uses every $language example and only existing ones', (language) => {
    const guide = readdirSync(site(language.guide))
      .map((name) => readFileSync(site(`${language.guide}/${name}`), 'utf8'))
      .join('\n');
    const cases = readFileSync(site(language.cases), 'utf8');
    const used = [
      ...[...guide.matchAll(/<Example name="([^"]+)" \/>/g)],
      ...[...cases.matchAll(/example: "([^"]+)"/g)],
    ].map((match) => `${match[1]}.rk`);

    expect(used.sort()).toEqual(examplesOf(language.examples).sort());
  });

  it('has every example and section in both languages', () => {
    expect(examplesOf('examples/ru').sort()).toEqual(examplesOf('examples').sort());

    const sections = (path: string) =>
      [...readFileSync(site(path), 'utf8').matchAll(/\{ id: "([^"]+)"/g)].map((match) => match[1]);

    expect(sections('src/ru/guide.rk')).toEqual(sections('src/en/guide.rk'));
    expect(sections('src/ru/cases.rk')).toEqual(sections('src/en/cases.rk'));
  });

  // An example may have the same program written in JS by hand, in js/<name>/ of its folder, which
  // its tab "Without Rook" shows.
  it('has the JS written by hand for existing examples, the same files in both languages', () => {
    const handwritten = (dir: string) =>
      readdirSync(site(`${dir}/js`)).map((example) => ({
        example,
        files: readdirSync(site(`${dir}/js/${example}`)).sort(),
      }));
    const english = handwritten('examples');

    expect(english.length).toBeGreaterThan(0);
    for (const { example, files } of english) {
      expect(examplesOf('examples')).toContain(`${example}.rk`);
      expect(files).toContain(`${example}.js`);
    }

    expect(handwritten('examples/ru')).toEqual(english);
  });

  // Each language has a home page, docs/, examples/, playground/ and roadmap/, each drawn by its own
  // entry module.
  it.each(['en', 'ru'])('has the five pages of %s', (language) => {
    const root = language === 'en' ? '' : 'ru/';
    const pages = {
      home: '',
      docs: 'docs/',
      examples: 'examples/',
      playground: 'playground/',
      roadmap: 'roadmap/',
    };

    for (const [page, folder] of Object.entries(pages)) {
      const html = readFileSync(site(`${root}${folder}index.html`), 'utf8');

      expect(html).toContain(`<html lang="${language}">`);
      expect(html).toContain(`<script type="module" src="/src/${language}/${page}.rk"></script>`);
    }
  });

  it.each(['en', 'ru'])('links the footer of %s to sections of its guide', (language) => {
    const ids = (path: string) =>
      [...readFileSync(site(path), 'utf8').matchAll(/\{ id: "([^"]+)", title/g)].map(
        (match) => match[1],
      );
    const footer = ids(`src/${language}/strings.rk`);

    expect(footer.length).toBeGreaterThan(0);
    expect(ids(`src/${language}/guide.rk`)).toEqual(expect.arrayContaining(footer));
  });

  it('reports errors with lines and columns of their start and end', () => {
    expect(compile('let ok = true\nlet n number = "x"').diagnostics).toEqual([
      { message: 'cannot use string as number', line: 2, column: 16, endLine: 2, endColumn: 19 },
    ]);
  });

  // The editor of the playground completes as the language server does.
  it('completes names in the browser compiler', () => {
    const source = 'const fruits = ["guava"]\nfruits.pu';
    const list = complete(source, source.length);

    expect(source.slice(list.start, list.end)).toBe('pu');
    expect(list.items).toContainEqual(expect.objectContaining({ name: 'push', kind: 'method' }));
  });
});
