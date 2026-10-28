// JS globals that the checker knows by name only, without types: everything about them is `any`.
// With TypeScript's lib files (in Node) the library types them; the browser compiler of the
// playground has only these names.

export const UNTYPED_GLOBALS: readonly string[] = [
  'Object',
  'Array',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Symbol',
  'Reflect',
  'Proxy',
  'Intl',
  'globalThis',
  'process',
  'Buffer',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  // Streams, and what makes them: chan(stream) and stream(ch) work with them.
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'TextEncoderStream',
  'TextDecoderStream',
  'Blob',
  'Response',
  'Request',
  'Headers',
  'fetch',
  'structuredClone',
  'queueMicrotask',
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'crypto',
  'performance',
];

// Classes that are names of types too, `any` in both: `new AbortController()` and
// `signal AbortSignal`. TypeScript's lib files replace them as they replace the DOM.
export const UNTYPED_CLASSES: readonly string[] = ['AbortController', 'AbortSignal', 'ImageData'];
