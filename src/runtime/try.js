// `try expr`: an exception in the expression becomes the error of `(T, error)`. `results` is how
// many values the expression gives: 0 for none, and then the error comes alone, 1 for a value, more
// for several. With `withError` the last of them is an error already, as of `(User, error)` or of a
// function that returns only an error, and an exception takes its place.

export function $$catch(f, results = 1, withError = false) {
  let value;

  try {
    value = f();
  } catch (error) {
    return failed(error, results, withError);
  }

  return succeeded(value, results, withError);
}

/** `try` of an expression that waits: a rejected Promise is caught as an exception is. */
export async function $$catchAsync(f, results = 1, withError = false) {
  let value;

  try {
    value = await f();
  } catch (error) {
    return failed(error, results, withError);
  }

  return succeeded(value, results, withError);
}

function succeeded(value, results, withError) {
  if (results === 0) return null;
  if (withError) return value;

  return results === 1 ? [value, null] : [...value, null];
}

/** JS can throw anything; what is not an Error becomes one, so that the error has a message. */
function failed(thrown, results, withError) {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown));

  if (results === 0 || (withError && results === 1)) return error;

  return [...Array(withError ? results - 1 : results).fill(null), error];
}
