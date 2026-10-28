// Воркер — отдельный файл: он получает предел в сообщении и шлёт
// прогресс обратно сообщениями, которые страница различает по типу

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
