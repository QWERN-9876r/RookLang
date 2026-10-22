// What the code of any module may need: `for` over a value of unknown type, `defer`, and wrapped
// errors.

// `for v in x` over an untyped value: a Map gives its values, as a typed one does.
export function $$values(iterable) {
  if (typeof iterable === 'function') return iterable();

  return iterable instanceof Map ? iterable.values() : iterable;
}

// Runs deferred calls in reverse order; every call runs even if an earlier one throws.
export function $$runDeferred(deferred) {
  let failure;

  for (let i = deferred.length - 1; i >= 0; i--) {
    try {
      deferred[i]();
    } catch (error) {
      failure = { error };
    }
  }

  if (failure) throw failure.error;
}

// `error("load user", err)`: an error whose message ends with that of its cause, as `%w` of Go
// gives "load user: not found", and whose `cause` is the error itself, for code that looks at it.
export function $$wrap(message, cause) {
  const reason = cause instanceof Error ? cause.message : String(cause);

  return new Error(`${message}: ${reason}`, { cause });
}
