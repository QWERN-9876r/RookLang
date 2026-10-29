// Та же проверка на JavaScript: то, что говорят типы, написано заново
// кодом, путь за путём, и его надо вручную держать в согласии с ними;
// чек рисуется заново при каждом изменении

const COURIER = `"courier", "address": "ул. Вязов, 12", "floor": 3`;

const VALID = `{
  "id": 1042,
  "customer": { "name": "Анна", "email": "anna@example.com" },
  "items": [
    { "name": "Манго", "qty": 2, "price": 240 },
    { "name": "Личи", "qty": 1, "price": 750 }
  ],
  "status": "paid",
  "delivery": { "kind": ${COURIER} }
}`;

const SAMPLES = [
  { title: 'Верный', json: VALID },
  { title: 'Цена строкой', json: VALID.replace(`"price": 750`, `"price": "750"`) },
  { title: 'Неизвестный статус', json: VALID.replace(`"paid"`, `"lost"`) },
  { title: 'Самовывоз', json: VALID.replace(COURIER, `"pickup", "shop": "ул. Ленина, 1"`) },
  { title: 'Неизвестная доставка', json: VALID.replace(`"courier"`, `"drone"`) },
  { title: 'Без email', json: VALID.replace(`, "email": "anna@example.com"`, '') },
  { title: 'Обрезан', json: VALID.slice(0, 140) },
];

// То, что проверяет decode<Order>, — для одного этого типа
class DecodeError extends Error {}

function field(value, path, key, type) {
  if (!(key in value)) throw new DecodeError(`${path}${key}: missing`);

  const found = value[key];

  if (typeof found !== type) {
    throw new DecodeError(`${path}${key}: expected ${type}, got ${JSON.stringify(found)}`);
  }

  return found;
}

function object(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DecodeError(`${path || 'value'}: expected an object, got ${JSON.stringify(value)}`);
  }
}

function parseOrder(json) {
  let order;

  try {
    order = JSON.parse(json);
  } catch (error) {
    throw new DecodeError(`invalid JSON: ${error.message}`);
  }

  object(order, '');
  field(order, '', 'id', 'number');
  if (!('customer' in order)) throw new DecodeError('customer: missing');
  object(order.customer, 'customer');
  field(order.customer, 'customer.', 'name', 'string');
  field(order.customer, 'customer.', 'email', 'string');
  if (!Array.isArray(order.items)) throw new DecodeError('items: expected an array');
  order.items.forEach((item, i) => {
    object(item, `items[${i}]`);
    field(item, `items[${i}].`, 'name', 'string');
    field(item, `items[${i}].`, 'qty', 'number');
    field(item, `items[${i}].`, 'price', 'number');
  });

  const status = field(order, '', 'status', 'string');

  if (!['new', 'paid', 'sent'].includes(status)) {
    throw new DecodeError(`status: expected "new" | "paid" | "sent", got "${status}"`);
  }

  if (!('delivery' in order)) throw new DecodeError('delivery: missing');
  object(order.delivery, 'delivery');

  const kind = field(order.delivery, 'delivery.', 'kind', 'string');

  if (kind === 'pickup') {
    field(order.delivery, 'delivery.', 'shop', 'string');
  } else if (kind === 'courier') {
    field(order.delivery, 'delivery.', 'address', 'string');
    if (order.delivery.floor != null && typeof order.delivery.floor !== 'number') {
      throw new DecodeError(
        `delivery.floor: expected number, got ${JSON.stringify(order.delivery.floor)}`,
      );
    }
  } else {
    throw new DecodeError(`delivery.kind: expected "pickup" | "courier", got "${kind}"`);
  }

  if (order.note != null && typeof order.note !== 'string') {
    throw new DecodeError(`note: expected string, got ${JSON.stringify(order.note)}`);
  }

  return order;
}

const style = document.createElement('style');

style.textContent = `
  .orders { display: grid; gap: 12px; max-width: 480px; }
  .samples { display: flex; flex-wrap: wrap; gap: 6px; }
  .samples button {
    padding: 4px 10px; border: 1px solid #ffffff2e; border-radius: 999px;
    background: #ffffff0a; color: inherit; font: inherit; font-size: 0.85em; cursor: pointer;
  }
  .orders textarea {
    height: 230px; padding: 10px 12px; border: 1px solid #ffffff2e; border-radius: 10px;
    background: #ffffff0a; color: inherit; font: 0.8em/1.5 ui-monospace, monospace; resize: vertical;
  }
  .problem {
    margin: 0; padding: 10px 12px; border-left: 3px solid #ff7a7a; border-radius: 6px;
    background: #ff7a7a1a; color: #ffb3b3; font: 0.85em/1.5 ui-monospace, monospace;
  }
  .receipt {
    display: grid; gap: 6px; padding: 12px 14px; border-left: 3px solid #6fcf8f;
    border-radius: 6px; background: #6fcf8f14;
  }
  .receipt .head, .receipt .line { display: flex; justify-content: space-between; }
  .receipt .status { color: #6fcf8f; }
  .receipt .who { margin: 0 0 4px; color: #ffffff80; font-size: 0.85em; }
  .receipt .total { padding-top: 6px; border-top: 1px solid #ffffff1a; font-weight: 600; }
`;

function element(tag, className, ...children) {
  const node = document.createElement(tag);

  node.className = className;
  node.append(...children);

  return node;
}

const area = element('textarea', '');
const samples = element('div', 'samples');
const root = element('div', 'orders', samples, area);

area.spellcheck = false;
area.value = VALID;
for (const sample of SAMPLES) {
  const button = element('button', '', sample.title);

  button.addEventListener('click', () => {
    area.value = sample.json;
    render();
  });
  samples.append(button);
}

document.body.append(style, root);

let shown = null;

// Which fields a delivery has depends on its kind: nothing checks that they are read in step
function deliveryText(delivery) {
  if (delivery.kind === 'pickup') return `Самовывоз: ${delivery.shop}`;

  const floor = delivery.floor != null ? `, этаж ${delivery.floor}` : '';

  return `Курьером: ${delivery.address}${floor}`;
}

function receipt(order) {
  const total = order.items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const line = (left, right, className = 'line') =>
    element('div', className, element('span', '', left), element('span', '', right));
  const box = element(
    'div',
    'receipt',
    element(
      'div',
      'head',
      element('b', '', `Заказ №${order.id}`),
      element('span', 'status', order.status),
    ),
    element('p', 'who', `${order.customer.name} · ${order.customer.email}`),
    element('p', 'who', deliveryText(order.delivery)),
    ...order.items.map((item) => line(`${item.qty} × ${item.name}`, `${item.qty * item.price} ₽`)),
    line('Итого', `${total} ₽`, 'line total'),
  );

  if (order.note != null) box.append(element('p', 'who', order.note));

  return box;
}

// То, за чем разметка компонента следит сама
function render() {
  let next;

  try {
    next = receipt(parseOrder(area.value));
  } catch (error) {
    if (!(error instanceof DecodeError)) throw error;
    next = element('p', 'problem', `decode Order: ${error.message}`);
  }

  shown?.remove();
  shown = next;
  root.append(shown);
}

area.addEventListener('input', render);
render();
