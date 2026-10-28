// The worker, a file of its own: it gets the limit in a message and
// sends its progress back as messages of a kind the page must tell apart

function isPrime(n) {
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) {
    if (n % d === 0) return false;
  }

  return n > 1;
}

self.onmessage = ({ data: { limit } }) => {
  const step = limit / 100;
  let found = 0;

  for (let n = 2; n <= limit; n++) {
    if (isPrime(n)) found++;
    if (n % step === 0) self.postMessage({ type: 'progress', checked: n, found });
  }

  self.postMessage({ type: 'done', found });
};
