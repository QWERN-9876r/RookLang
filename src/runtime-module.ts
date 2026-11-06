// Where compiled code imports the runtime from, in a module of its own: the loader of `rook run`
// needs the name in every worker, without the code generator and the text of the runtime.

export const RUNTIME_MODULE = 'rooklang/runtime';

/** The entry of a server whose markup is HTML (docs/server.md), found the same way. */
export const SERVER_MODULE = 'rooklang/server';
