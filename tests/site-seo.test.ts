import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deeper, sectionPage } from '../site/sections.ts';
import {
  headTags,
  LANGUAGES,
  pageOf,
  pagePath,
  SITE,
  sitemap,
  tagsHtml,
  withoutTags,
} from '../site/seo.ts';

// What search engines and social networks read from the documentation site (site/seo.ts), and the
// addresses of the sections of the guide and of the examples (site/sections.ts).

const site = (path: string) => new URL(`../site/${path}`, import.meta.url).pathname;

const PAGES = ['', 'docs', 'examples', 'playground', 'roadmap'];

const ALL = LANGUAGES.flatMap((language) => PAGES.map((page) => ({ language, page })));

/** The attributes of the tags of a page, as `name=value` lines, to compare in one piece. */
const tags = (page: { language: string; page: string }) =>
  headTags(readFileSync(site(`${pagePath(page)}index.html`), 'utf8'), page);

const content = (page: { language: string; page: string }, property: string): string =>
  String(
    tags(page).find((tag) => tag.attrs?.property === property || tag.attrs?.name === property)
      ?.attrs?.content,
  );

describe('site SEO', () => {
  it('finds the page of an index.html by its path', () => {
    expect(pageOf('index.html')).toEqual({ language: 'en', page: '' });
    expect(pageOf('docs/index.html')).toEqual({ language: 'en', page: 'docs' });
    expect(pageOf('ru/index.html')).toEqual({ language: 'ru', page: '' });
    expect(pageOf('ru/playground/index.html')).toEqual({ language: 'ru', page: 'playground' });
    expect(ALL.map((page) => pageOf(`${pagePath(page)}index.html`))).toEqual(ALL);
  });

  it('gives each page its addresses in every language', () => {
    const links = tags({ language: 'ru', page: 'docs' })
      .filter((tag) => tag.tag === 'link')
      .map((tag) => `${tag.attrs!.rel} ${tag.attrs!.hreflang ?? ''} ${tag.attrs!.href}`);

    expect(links).toEqual([
      `canonical  ${SITE}ru/docs/`,
      `alternate en ${SITE}docs/`,
      `alternate ru ${SITE}ru/docs/`,
      `alternate x-default ${SITE}docs/`,
      'apple-touch-icon  ../../apple-touch-icon.png',
    ]);
  });

  it.each(ALL)('makes a card of $language/$page from its title and description', (page) => {
    const html = readFileSync(site(`${pagePath(page)}index.html`), 'utf8');

    expect(html).toContain(`<title>${content(page, 'og:title')}</title>`);
    expect(content(page, 'og:description').length).toBeGreaterThan(50);
    expect(content(page, 'og:url')).toBe(SITE + pagePath(page));
    expect(content(page, 'og:image')).toBe(`${SITE}og-${page.language}.png`);
    expect(content(page, 'twitter:card')).toBe('summary_large_image');
    // Search engines cut titles longer than about 60 characters.
    expect(content(page, 'og:title').length).toBeLessThanOrEqual(60);
  });

  it('describes Rook with JSON-LD on the home pages only', () => {
    const script = (page: { language: string; page: string }) =>
      tags(page).find((tag) => tag.attrs?.type === 'application/ld+json')?.children;

    const data = JSON.parse(script({ language: 'ru', page: '' }) as string) as {
      '@graph': unknown[];
    };

    expect(data['@graph'][0]).toEqual({
      '@type': 'WebSite',
      name: 'Rook',
      url: `${SITE}ru/`,
      inLanguage: 'ru',
    });
    expect(script({ language: 'en', page: 'docs' })).toBeUndefined();
  });

  it('decodes entities, since Vite escapes the attributes it writes', () => {
    const html = '<title>A &amp; B</title><meta name="description" content="&quot;C&quot;" />';
    const card = headTags(html, { language: 'en', page: '' });
    const value = (property: string) =>
      card.find((tag) => tag.attrs?.property === property)?.attrs?.content;

    expect([value('og:title'), value('og:description')]).toEqual(['A & B', '"C"']);
  });

  it('lists every page in the sitemap with its languages', () => {
    const xml = sitemap(PAGES);

    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual(
      PAGES.flatMap((page) => LANGUAGES.map((language) => SITE + pagePath({ language, page }))),
    );
    expect(xml.match(/hreflang=/g)).toHaveLength(PAGES.length * LANGUAGES.length ** 2);
  });

  it('finds the page that draws a section by its address', () => {
    expect(sectionPage('docs/goroutines/')).toBe('docs/');
    expect(sectionPage('ru/examples/orders/')).toBe('ru/examples/');
    expect(sectionPage('docs/')).toBeNull();
    expect(sectionPage('playground/goroutines/')).toBeNull();
    expect(sectionPage('docs/assets/index.js')).toBeNull();
    expect(sectionPage('docs/a/b/')).toBeNull();
  });

  it('moves the relative addresses of a page one folder deeper for a section', () => {
    expect(
      deeper('<script src="../assets/a.js"></script><link href="../a.css"><a href="#x">'),
    ).toBe('<script src="../../assets/a.js"></script><link href="../../a.css"><a href="#x">');
  });

  it('describes a section of the guide as an article in the guide, an example as a program', () => {
    const section = (page: string) => {
      const html = `<title>Goroutines — Rook documentation</title><meta name="description" content="Threads.">`;
      const all = headTags(html, { language: 'en', page });
      const script = all.find((tag) => tag.attrs?.type === 'application/ld+json')?.children;

      return {
        type: all.find((tag) => tag.attrs?.property === 'og:type')?.attrs?.content,
        graph: (JSON.parse(script as string) as { '@graph': Record<string, unknown>[] })['@graph'],
      };
    };
    const docs = section('docs/goroutines');

    expect(docs.type).toBe('article');
    expect(docs.graph[0]).toMatchObject({
      '@type': 'TechArticle',
      headline: 'Goroutines',
      description: 'Threads.',
      url: `${SITE}docs/goroutines/`,
      inLanguage: 'en',
    });
    expect(docs.graph[1]).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { position: 1, name: 'Rook', item: SITE },
        { position: 2, name: 'Documentation', item: `${SITE}docs/` },
        { position: 3, name: 'Goroutines', item: `${SITE}docs/goroutines/` },
      ],
    });
    expect(section('examples/orders').graph[0]).toMatchObject({
      '@type': 'SoftwareSourceCode',
      programmingLanguage: 'Rook',
    });
  });

  it('gives a drawn page its tags anew, as HTML', () => {
    const page = { language: 'ru', page: 'docs/null' };
    const built = readFileSync(site('ru/docs/index.html'), 'utf8').replace(
      '</head>',
      `${tagsHtml(headTags(readFileSync(site('ru/docs/index.html'), 'utf8'), { language: 'ru', page: 'docs' }))}</head>`,
    );
    const html = withoutTags(built).replace('</head>', `${tagsHtml(headTags(built, page))}</head>`);

    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain(`<link rel="canonical" href="${SITE}ru/docs/null/">`);
    expect(html).toContain(`<link rel="alternate" hreflang="en" href="${SITE}docs/null/">`);
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(html.match(/og:title/g)).toHaveLength(1);
  });

  it('lists the sections in the sitemap at their own addresses', () => {
    const xml = sitemap(['docs/goroutines', 'examples/orders']);

    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual([
      `${SITE}docs/goroutines/`,
      `${SITE}ru/docs/goroutines/`,
      `${SITE}examples/orders/`,
      `${SITE}ru/examples/orders/`,
    ]);
  });

  // PNG keeps its width and height at bytes 16–23; og:image:width and height promise 1200×630.
  it.each(['og-en.png', 'og-ru.png', 'apple-touch-icon.png'])('has the picture %s', (file) => {
    const png = readFileSync(site(`public/${file}`));
    const size = [png.readUInt32BE(16), png.readUInt32BE(20)];

    expect(size).toEqual(file.startsWith('og-') ? [1200, 630] : [180, 180]);
  });
});
