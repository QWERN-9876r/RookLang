import type { Plugin } from 'vite';
import { LANGUAGES } from './seo.ts';

// The pages whose sections have addresses of their own, docs/goroutines/ and examples/orders/: one
// index.html draws all the sections of a page. The dev server of Vite serves it at those
// addresses; the built site gets an index.html for each section from scripts/prerender.ts.

/** The pages of a language whose sections have addresses of their own. */
export const SECTIONED = ['docs', 'examples'];

const others = LANGUAGES.slice(1).join('|');
const SECTION = new RegExp(`^((?:(?:${others})/)?(?:${SECTIONED.join('|')})/)[^/.]+/$`);

/** The folder of the page that draws a section: `ru/docs/` of `ru/docs/goroutines/`, else null. */
export function sectionPage(path: string): string | null {
  return SECTION.exec(path)?.[1] ?? null;
}

/** The plugin: the dev server answers `docs/goroutines/` with `docs/index.html`. */
export function sections(): Plugin {
  return {
    name: 'rooklang-sections',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [path = '', query] = (request.url ?? '').split('?');
        const page = sectionPage(path.slice(1));

        if (page !== null) request.url = `/${page}index.html${query ? `?${query}` : ''}`;
        next();
      });
    },
  };
}

/**
 * The HTML of the page that draws a section, for the address of the section: one folder deeper,
 * so its relative addresses go one more level up, `../assets/` → `../../assets/`.
 */
export function deeper(html: string): string {
  return html.replace(/(\s(?:src|href)=")\.\.\//g, '$1../../');
}
