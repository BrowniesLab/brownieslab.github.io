const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const context = {};
runInNewContext(readFileSync(require.resolve('../admin-analytics.js'), 'utf8'), context);
const { summarizeSales, summarizeSessions, salesCSV } = context.AdminAnalytics;
const plain = value => JSON.parse(JSON.stringify(value));
function table(objects) {
  const headers = [...new Set(objects.flatMap(Object.keys))];
  return { headers, rows: objects.map((object, i) => ({ rowIndex: i + 1, values: headers.map(h => object[h]) })) };
}
const line = (itemId = 'CLASSIC', qty = 1, price = 45000, name = itemId) => ({ itemId, name, qty, price });
const order = (lines = [line()], extra = {}) => ({
  OrderID: 'BL-web', Status: 'Đã giao', PaymentStatus: 'Đã thanh toán',
  CreatedAt: '2026-10-26 10:00', ItemsJSON: JSON.stringify(lines),
  Total: lines.reduce((sum, l) => sum + l.qty * l.price, 0), ...extra
});

test('uses historical order prices, counts boxes rather than orders, splits manual/web and reconciles totals', () => {
  const summary = summarizeSales(table([
    order([line('CLASSIC', 2, 40000), line('MATCHA', 1, 55000)]),
    order([line('FUDGE', 1, 45000, 'Classic'), line('MIX', 3, 50000)], { OrderID: 'BL-date-AABC' })
  ]));
  assert.equal(summary.orders, 2);
  assert.equal(summary.boxes, 7);
  assert.equal(summary.customer, 3);
  assert.equal(summary.manual, 4);
  assert.equal(summary.revenue, 330000);
  assert.equal(summary.orderTotal, 330000);
  assert.equal(summary.difference, 0);
  assert.deepEqual(plain(summary.items).map(p => [p.name, p.boxes, p.revenue]), [
    ['Classic', 3, 125000], ['Matcha', 1, 55000], ['Mix', 3, 150000]
  ]);
  assert.equal(summary.items.reduce((sum, p) => sum + p.revenue, 0), summary.revenue);
});

test('excludes unpaid, unconfirmed, cancelled and refund-like statuses without matching "unpaid" as "paid"', () => {
  const summary = summarizeSales(table([
    ...['Chưa thanh toán', 'Chờ xác nhận', 'unpaid', 'not paid', 'refunded'].map(PaymentStatus => order(undefined, { PaymentStatus })),
    order(undefined, { Status: 'Đã huỷ' }), order(undefined, { PaymentStatus: 'Đã hủy' }),
    order(undefined, { Status: 'Cancelled' }), order(undefined, { PaymentStatus: 'PAID' })
  ]));
  assert.equal(summary.orders, 1);
  assert.equal(summary.excludedOrders, 8);
  assert.equal(summary.revenue, 45000);
});

test('Mix remains Mix even when its name mentions Matcha; custom products are kept', () => {
  const summary = summarizeSales(table([order([
    line('MIX', 1, 50000, 'Mix Classic + Matcha'), line('SALTCARA', 2, 42000, 'Caramel muối')
  ])]));
  assert.deepEqual(plain(summary.items).map(p => p.name), ['Mix', 'Caramel muối']);
  assert.equal(summary.revenue, 134000);
});

test('does not assign shipping/discount differences to flavors', () => {
  const summary = summarizeSales(table([order([line()], { Total: 50000 })]));
  assert.equal(summary.revenue, 45000);
  assert.equal(summary.orderTotal, 50000);
  assert.equal(summary.difference, 5000);
});

test('skips malformed or incomplete orders without silently inventing quantities/prices', () => {
  const summary = summarizeSales(table([
    order(undefined, { ItemsJSON: '{' }), order(undefined, { ItemsJSON: '{}' }),
    order(undefined, { ItemsJSON: '[]' }), order([{ itemId: 'CLASSIC', qty: 1 }], { Total: 45000 }),
    order([line('CLASSIC', -1)]), order([line('CLASSIC', 1.5)]),
    order([line('CLASSIC', 1, -2)]), order(undefined, { Total: '' }),
    order([line('CLASSIC', 1, 0)])
  ]));
  assert.equal(summary.invalidOrders, 8);
  assert.equal(summary.orders, 1);
  assert.equal(summary.boxes, 1);
  assert.equal(summary.revenue, 0);
});

test('date filter is inclusive and uses Vietnam dates for both UTC and admin-formatted data', () => {
  const summary = summarizeSales(table([
    order(undefined, { CreatedAt: '2026-10-25T16:59:59.000Z' }),
    order(undefined, { CreatedAt: '2026-10-25T17:00:00.000Z' }),
    order(undefined, { CreatedAt: '2026-10-26 23:59' }),
    order(undefined, { CreatedAt: '2026-10-27 00:00' }),
    order(undefined, { CreatedAt: '' })
  ]), { from: '2026-10-26', to: '2026-10-26' });
  assert.equal(summary.orders, 2);
  assert.equal(summary.undatedOrders, 1);
  assert.equal(summary.revenue, 90000);
});

test('all-time stats include undated historical orders and do not hide past delivery dates', () => {
  const summary = summarizeSales(table([order(undefined, { CreatedAt: '', PickupDate: 'Thứ 6 (25/09)' })]));
  assert.equal(summary.orders, 1);
  assert.equal(summary.revenue, 45000);
});

test('rejects a reversed date range', () => {
  assert.throws(() => summarizeSales(table([]), { from: '2026-11-01', to: '2026-10-01' }), /Ngày bắt đầu/);
});

test('sessions are counted by expiry, active accounts are distinct, and timestamps use Vietnam timezone', () => {
  const sessions = summarizeSessions(table([
    { Phone: '0901111111', ExpiresAt: '2026-10-26 12:01' },
    { Phone: '0901111111', ExpiresAt: '2026-10-26T05:02:00Z' },
    { Phone: '0902222222', ExpiresAt: '2026-10-26 12:03' },
    { Phone: '0903333333', ExpiresAt: '2026-10-26 12:00' },
    { Phone: '0904444444', ExpiresAt: '' }
  ]), Date.parse('2026-10-26T05:00:00Z'));
  assert.deepEqual(plain(sessions), { active: 3, accounts: 2, expired: 1, invalid: 1 });
});

test('empty datasets yield zeros', () => {
  const summary = summarizeSales(table([]));
  assert.equal(summary.boxes, 0); assert.equal(summary.revenue, 0); assert.equal(summary.items.length, 0);
  assert.equal(summarizeSessions(table([])).active, 0);
});

test('CSV exports flavor totals with UTF-8 BOM and protects formula-like names', () => {
  const summary = summarizeSales(table([order([line('CUSTOM', 2, 40000, '=HYPERLINK("bad")')])]));
  const csv = salesCSV(summary);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.endsWith('"Tổng","2","0","2","80000"'));
});
