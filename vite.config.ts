import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { sections } from './site/sections.ts';
import { seo } from './site/seo.ts';
import { rook } from './src/vite.ts';

// The documentation site (site/): its pages are Rook modules compiled by the plugin from
// src/vite.ts. `npm run site:dev` serves it with Vite, `npm run site:build` builds it to site/dist.
// Each language has five pages, each a folder with its index.html: the home page, docs/, examples/,
// playground/ and roadmap/; the English ones are at the root, the Russian ones in ru/. The sections
// of docs/ and examples/ have addresses of their own, docs/goroutines/ (site/sections.ts), and
// scripts/prerender.ts writes each page of the built site with its text in it. examples/ also holds
// the code of the examples that the guide and the page of examples show. Files of site/public (the
// pictures for links, drawn by `npm run site:images`) are copied to the site as they are.

const site = new URL('./site/', import.meta.url).pathname;

/** The pages of each language, as folders from its root. */
const PAGES = ['', 'docs', 'examples', 'playground', 'roadmap'];

/** Folders of the examples of each language. */
const EXAMPLES: Record<string, string> = {
  en: join(site, 'examples'),
  ru: join(site, 'examples', 'ru'),
};

/**
 * `virtual:examples/en` and `virtual:examples/ru`: the code of the examples of a language by name.
 * It is part of the bundle, so the examples have their code, and their height, when the page is
 * first drawn. Loaded later, they would grow after the browser had scrolled to a link like
 * `#state`, and the text would jump.
 *
 * `HANDWRITTEN` has the same programs written in JavaScript by hand, for the examples that compare
 * the two: the files of js/<name>/, `<name>.js` first.
 */
function examples(): Plugin {
  const prefix = 'virtual:examples/';

  return {
    name: 'rooklang-examples',
    resolveId: (source) =>
      source.startsWith(prefix) && source.slice(prefix.length) in EXAMPLES ? `\0${source}` : null,
    load(id) {
      if (!id.startsWith(`\0${prefix}`)) return null;

      const dir = EXAMPLES[id.slice(prefix.length + 1)]!;
      const read = (path: string) => {
        this.addWatchFile(path);

        return readFileSync(path, 'utf8').trimEnd();
      };
      const code: Record<string, string> = {};
      const handwritten: Record<string, { name: string; code: string }[]> = {};

      for (const file of readdirSync(dir).sort()) {
        if (file.endsWith('.rk')) code[file.slice(0, -'.rk'.length)] = read(join(dir, file));
      }

      for (const example of readdirSync(join(dir, 'js'))) {
        const files = readdirSync(join(dir, 'js', example)).sort((a, b) =>
          a === `${example}.js` ? -1 : b === `${example}.js` ? 1 : a.localeCompare(b),
        );

        handwritten[example] = files.map((name) => ({
          name,
          code: read(join(dir, 'js', example, name)),
        }));
      }

      return [
        `export const EXAMPLES = ${JSON.stringify(code)};`,
        `export const HANDWRITTEN = ${JSON.stringify(handwritten)};`,
        '',
      ].join('\n');
    },
  };
}

export default defineConfig({
  root: site,
  // Relative paths to the assets: GitHub Pages serves the site from /<repository>/, and
  // site/server.rk from the root.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The editor of VS Code in the playground is one chunk of some 3.5 MB, loaded only when the
    // playground comes into view.
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      input: ['', 'ru'].flatMap((language) =>
        PAGES.map((page) => join(site, language, page, 'index.html')),
      ),
    },
  },
  plugins: [rook(), examples(), seo(site, PAGES), sections()],
});
