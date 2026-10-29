import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import {
  headTags,
  LANGUAGES,
  pagePath,
  SITE,
  sitemap,
  tagsHtml,
  withoutTags,
  type Page,
} from '../site/seo.ts';
import { deeper, SECTIONED, sectionPage } from '../site/sections.ts';
import { openTab, type Tab } from './chrome.ts';

// Writes the pages of the built site (site/dist) with their text in them, for search engines and
// for the previews of links, which read the HTML and do not run the scripts. Each page is opened in
// headless Chrome, as a visitor sees it, and what it has drawn is saved to its index.html; when the
// page loads, its scripts draw it again, alive. The guide and the examples get a page for each
// section, docs/goroutines/, with its own title, description and tags (site/seo.ts), and the
// sitemap lists them; docs/ itself leads to its first section. `npm run site:build` runs it after
// Vite. The path to Chrome is taken from $CHROME, else the usual ones are tried.

const dist = new URL('../site/dist/', import.meta.url).pathname;

/** The other pages that are written with their text; the playground is an editor. */
const PLAIN_PAGES = ['', 'roadmap'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Serves the built site; a section that has no page yet gets the page that draws it. */
function serve(): Promise<[Server, string]> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname).slice(1);
    const file = join(dist, path === '' || path.endsWith('/') ? `${path}index.html` : path);
    const section = sectionPage(path);
    let body: string | Buffer | null = null;

    if (existsSync(file) && statSync(file).isFile()) body = readFileSync(file);
    else if (section !== null)
      body = deeper(readFileSync(join(dist, section, 'index.html'), 'utf8'));

    response.writeHead(body === null ? 404 : 200, {
      'content-type':
        body === null || section !== null
          ? TYPES['.html']!
          : (TYPES[extname(file)] ?? 'application/octet-stream'),
    });
    response.end(body ?? 'Not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve([server, `http://127.0.0.1:${(server.address() as AddressInfo).port}/`]);
    });
  });
}

/** Opens a page and waits until it is drawn, with its fonts. */
async function draw(tab: Tab, url: string): Promise<void> {
  await tab.open(url);
  await tab.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let i = 0; i < 100 && !document.querySelector('main'); i++) await wait(50);
    await document.fonts.ready;
    await wait(300);
  })()`);
}

/** The sections of the page, in order: the links to the folders next to the current one. */
const SECTION_IDS = `(() => {
  const folder = (path) => path.slice(0, path.lastIndexOf('/', path.length - 2) + 1);
  const here = folder(location.pathname);
  const ids = [...document.querySelectorAll('a[href]')]
    .map((link) => new URL(link.href))
    .filter((url) => url.origin === location.origin && url.pathname !== here && folder(url.pathname) === here)
    .map((url) => decodeURIComponent(url.pathname.slice(here.length, -1)));
  return [...new Set(ids)];
})()`;

/**
 * Leaves only the section shown, so that each page has its own text, and describes it: by the
 * first paragraph of a section of the guide, by the line of an example in the list.
 */
const ONE_SECTION = `(() => {
  for (const hidden of document.querySelectorAll('article[hidden]')) hidden.remove();
  const source = document.querySelector('article p') ?? document.querySelector('[aria-current="page"] span');
  const text = (source?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  if (text === '') return;
  const cut = text.length <= 160 ? text : text.slice(0, text.lastIndexOf(' ', 157)) + '…';
  document.querySelector('meta[name="description"]').setAttribute('content', cut);
})()`;

/** Writes a page drawn in the tab, with the tags of its address. */
async function save(tab: Tab, page: Page): Promise<void> {
  const drawn = await tab.evaluate<string>('document.documentElement.outerHTML');
  // The scripts gave some elements absolute addresses on this server, as an image from new URL().
  const up = '../'.repeat(pagePath(page).split('/').length - 1) || './';
  const html = `<!doctype html>\n${drawn.replaceAll(origin, up)}\n`;
  const tags = tagsHtml(headTags(html, page));
  const folder = join(dist, pagePath(page));

  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'index.html'),
    withoutTags(html).replace('</head>', `    ${tags}\n  </head>`),
  );
}

/** docs/ leads to its first section, for search engines and for pages without scripts too. */
function lead(page: Page, first: string): void {
  const file = join(dist, pagePath(page), 'index.html');
  const html = withoutTags(readFileSync(file, 'utf8')).replace(
    '</head>',
    [
      `    <link rel="canonical" href="${SITE}${pagePath(page)}${first}/">`,
      `    <noscript><meta http-equiv="refresh" content="0; url=${first}/"></noscript>`,
      '  </head>',
    ].join('\n'),
  );

  writeFileSync(file, html);
}

const [server, origin] = await serve();
const tab = await openTab();
const sections = new Map<string, string[]>();
let written = 0;

try {
  for (const language of LANGUAGES) {
    for (const folder of PLAIN_PAGES) {
      const page = { language, page: folder };

      await draw(tab, origin + pagePath(page));
      await save(tab, page);
      written++;
    }

    for (const folder of SECTIONED) {
      const page = { language, page: folder };

      // The page goes to the address of its first section before it draws.
      await draw(tab, origin + pagePath(page));

      const ids = await tab.evaluate<string[]>(SECTION_IDS);
      const others = sections.get(folder);

      if (ids.length === 0) throw new Error(`${pagePath(page)} has no sections`);
      if (others && others.join() !== ids.join()) {
        throw new Error(
          `${pagePath(page)} has other sections than in ${LANGUAGES[0]}: ${ids.join(', ')}`,
        );
      }

      sections.set(folder, ids);
      for (const id of ids) {
        const section = { language, page: `${folder}/${id}` };

        await draw(tab, origin + pagePath(section));
        await tab.evaluate(ONE_SECTION);
        await save(tab, section);
        written++;
      }

      lead(page, ids[0]!);
    }
  }
} finally {
  await tab.close();
  server.close();
}

const pages = [
  ...PLAIN_PAGES,
  ...SECTIONED.flatMap((folder) => (sections.get(folder) ?? []).map((id) => `${folder}/${id}`)),
  'playground',
];

writeFileSync(join(dist, 'sitemap.xml'), sitemap(pages));
console.log(`prerendered ${written} pages; the sitemap has ${pages.length * LANGUAGES.length}`);
