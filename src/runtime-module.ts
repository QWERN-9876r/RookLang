// Where compiled code imports the runtime from, in a module of its own: the loader of `rook run`
// needs the name in every worker, without the code generator and the text of the runtime.

export const RUNTIME_MODULE = 'rooklang/runtime';
