// A program of the page that imports rooklang/server is one of a server: its markup is HTML, as
// "rook": { "markup": "html" } makes it in a package (docs/server.md). The page has no package
// settings, so the examples, the playground and its editor take the markup from the import.

/** The markup to compile a program of the page with. */
export function markupOf(source: string): true | 'html' {
  return /^import .* from "rooklang\/server"$/m.test(source) ? 'html' : true;
}
