/**
 * Brownies Lab — backend Cloudflare Worker (thay cho Apps Script/Code.gs)
 *
 * Database: D1 (binding "DB", xem schema.sql).
 * Ảnh minh chứng thanh toán: lưu base64 thẳng trong D1 (cột payment_proof_mime/payment_proof_data
 * của bảng orders), phục vụ lại qua GET /proof/<orderId>. Không phụ thuộc R2/Google Drive —
 * Service Account không dùng được (không có dung lượng Drive riêng khi không có Workspace).
 *
 * Giữ đúng tên action và hình dạng {ok,data}/{ok,error} như bản Apps Script,
 * nên app.js chỉ cần đổi API_URL, không cần sửa gì khác.
 */

const TZ = 'Asia/Ho_Chi_Minh';

// ===================== ROUTER =====================
export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);

    if (url.pathname.startsWith('/proof/')) {
      return serveProof(url, env, cors);
    }

    try {
      let action, body = {};
      if (request.method === 'GET') {
        action = url.searchParams.get('action') || 'getMenu';
      } else if (request.method === 'POST') {
        const text = await request.text();
        try { body = text ? JSON.parse(text) : {}; }
        catch (e) { throw new Error('Body không phải JSON hợp lệ'); }
        action = body.action;
      } else {
        return jsonRes({ ok: false, error: 'Method không hợp lệ' }, cors);
      }
      const fn = ACTIONS[action];
      if (!fn) throw new Error('Action không hợp lệ: ' + action);
      const data = await fn(body || {}, { env, request });
      return jsonRes({ ok: true, data }, cors);
    } catch (err) {
      return jsonRes({ ok: false, error: String((err && err.message) || err) }, cors);
    }
  }
};

function jsonRes(obj, cors) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json;charset=utf-8', ...cors }
  });
}

async function serveProof(url, env, cors) {
  const orderId = decodeURIComponent(url.pathname.slice('/proof/'.length));
  const order = orderId ? await env.DB.prepare('SELECT payment_proof_mime, payment_proof_data FROM orders WHERE order_id = ?').bind(orderId).first() : null;
  if (!order || !order.payment_proof_data) return new Response('Không tìm thấy ảnh.', { status: 404, headers: cors });
  const headers = new Headers(cors);
  headers.set('Content-Type', order.payment_proof_mime || 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(base64ToBytes(order.payment_proof_data), { headers });
}

// ===================== ACTIONS =====================
const ACTIONS = {
  ping:               async () => ({ time: new Date().toISOString() }),
  register:           (b, ctx) => register(b, ctx),
  login:              (b, ctx) => login(b, ctx),
  logout:             (b, ctx) => logout(b, ctx),
  getMenu:            (b, ctx) => getMenu(ctx.env),
  createOrder:        (b, ctx) => createOrder(b, ctx),
  cancelOrder:        (b, ctx) => cancelOrder(b, ctx),
  myOrders:           (b, ctx) => myOrders(b, ctx),
  myPoints:           (b, ctx) => myPoints(b, ctx),
  paymentInfo:        (b, ctx) => paymentInfo(b, ctx),
  uploadPaymentProof: (b, ctx) => uploadPaymentProof(b, ctx),
  adminListSheet:     (b, ctx) => adminListSheet(b, ctx),
  adminConfirmPayment:(b, ctx) => adminConfirmPayment(b, ctx),
  adminAddRow:        (b, ctx) => adminAddRow(b, ctx),
  adminUpdateRow:     (b, ctx) => adminUpdateRow(b, ctx),
  adminDeleteRow:     (b, ctx) => adminDeleteRow(b, ctx)
};

// ===================== CẤU HÌNH =====================
const DEFAULTS = {
  POINTS_PER_BOX: 1, SIGNUP_BONUS: 2, FREE_BOX_POINTS: 10,
  SESSION_DAYS: 30, MAX_LOGIN_FAILS: 5, LOCK_MINUTES: 15,
  NEW_ORDER_STATUS: 'Mới', PAYMENT_QR_URL: ''
};
function cfg(env, key) {
  const v = env[key];
  if (v === undefined || v === null || v === '') return DEFAULTS[key];
  return typeof DEFAULTS[key] === 'number' ? Number(v) : v;
}

// ===================== AUTH =====================
async function register(b, ctx) {
  const phone = normPhone(b.phone);
  const name = String(b.name || '').trim();
  const socialLink = normSocialLink(b.socialLink);
  validatePin(b.pin);
  if (!name) throw new Error('Vui lòng nhập tên.');
  if (name.length > 60) throw new Error('Tên quá dài.');

  const existing = await ctx.env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
  if (existing && existing.claim_used) throw new Error('Số điện thoại này đã đăng ký. Hãy đăng nhập.');

  const pinHash = await hashPin(ctx.env, phone, b.pin);

  if (existing) {
    // SĐT đã có sẵn trong dữ liệu cũ (migrate) nhưng chưa từng tự đặt PIN qua hệ thống mới —
    // cho đăng ký lại đúng 1 lần để nhận lại tài khoản: giữ nguyên điểm/quyền admin, chỉ đặt PIN mới.
    await ctx.env.DB.prepare('UPDATE users SET name = ?, pin_hash = ?, social_link = ?, claim_used = 1 WHERE phone = ?')
      .bind(name, pinHash, socialLink, phone).run();
    return createSession(ctx.env, { phone, name, points: existing.points, is_admin: existing.is_admin });
  }

  const createdAt = new Date().toISOString();
  const signupBonus = Math.max(0, Number(cfg(ctx.env, 'SIGNUP_BONUS')) || 0);

  // Cộng dồn điểm từ các đơn cũ (đặt trước khi có tài khoản, vd qua Google Form) trùng SĐT này.
  const { results: legacyOrders } = await ctx.env.DB.prepare(
    'SELECT id, points_earned FROM orders WHERE phone = ? AND points_credited = 0'
  ).bind(phone).all();
  const legacyPoints = legacyOrders.reduce((sum, o) => sum + (Number(o.points_earned) || 0), 0);
  const points = signupBonus + legacyPoints;

  await ctx.env.DB.prepare(
    'INSERT INTO users (phone, name, pin_hash, points, is_admin, created_at, social_link, claim_used) VALUES (?,?,?,?,0,?,?,1)'
  ).bind(phone, name, pinHash, points, createdAt, socialLink).run();
  if (legacyOrders.length) {
    const ids = legacyOrders.map(o => o.id);
    await ctx.env.DB.prepare(`UPDATE orders SET points_credited = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }

  return createSession(ctx.env, { phone, name, points, is_admin: 0 });
}

async function login(b, ctx) {
  const phone = normPhone(b.phone);
  validatePin(b.pin);

  const attempt = await ctx.env.DB.prepare('SELECT * FROM login_attempts WHERE phone = ?').bind(phone).first();
  const now = Date.now();
  if (attempt && attempt.locked_until && new Date(attempt.locked_until).getTime() > now) {
    throw new Error('Sai PIN quá nhiều lần. Thử lại sau ' + cfg(ctx.env, 'LOCK_MINUTES') + ' phút.');
  }

  const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
  const pinHash = await hashPin(ctx.env, phone, b.pin);
  if (!user || user.pin_hash !== pinHash) {
    const fails = (attempt ? attempt.fails : 0) + 1;
    let lockedUntil = attempt ? attempt.locked_until : null;
    if (fails >= cfg(ctx.env, 'MAX_LOGIN_FAILS')) lockedUntil = new Date(now + cfg(ctx.env, 'LOCK_MINUTES') * 60000).toISOString();
    await ctx.env.DB.prepare(
      'INSERT INTO login_attempts (phone, fails, locked_until) VALUES (?,?,?) ' +
      'ON CONFLICT(phone) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until'
    ).bind(phone, fails, lockedUntil).run();
    throw new Error('Số điện thoại hoặc PIN không đúng.');
  }
  await ctx.env.DB.prepare('DELETE FROM login_attempts WHERE phone = ?').bind(phone).run();
  await purgeExpiredSessions(ctx.env);
  return createSession(ctx.env, user);
}

async function logout(b, ctx) {
  if (b.token) await ctx.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(String(b.token)).run();
  return { loggedOut: true };
}

async function createSession(env, user) {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + cfg(env, 'SESSION_DAYS') * 86400000);
  await env.DB.prepare('INSERT INTO sessions (token, phone, expires_at) VALUES (?,?,?)')
    .bind(token, user.phone, expires.toISOString()).run();
  return {
    token, phone: user.phone, name: user.name || '',
    points: Number(user.points) || 0, isAdmin: !!user.is_admin,
    expiresAt: expires.toISOString()
  };
}

async function requireUser(env, token) {
  if (!token) throw new Error('AUTH: Bạn cần đăng nhập.');
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(String(token)).first();
  if (!s) throw new Error('AUTH: Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.');
  if (new Date(s.expires_at).getTime() < Date.now()) throw new Error('AUTH: Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  const u = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(s.phone).first();
  if (!u) throw new Error('AUTH: Tài khoản không còn tồn tại.');
  return u;
}

async function requireAdmin(env, token) {
  const u = await requireUser(env, token);
  if (!u.is_admin) throw new Error('Bạn không có quyền admin.');
  return u;
}

async function purgeExpiredSessions(env) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()).run();
}

async function hashPin(env, phone, pin) {
  const raw = String(env.PIN_SALT || '') + '|' + phone + '|' + String(pin);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function validatePin(pin) {
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw new Error('PIN phải gồm 4 đến 6 chữ số.');
}

/** Chuẩn hoá SĐT Việt Nam: bỏ ký tự thừa, +84/84 -> 0, bù số 0 bị cắt mất. */
function normPhone(p) {
  let s = String(p === undefined || p === null ? '' : p).replace(/[^\d+]/g, '');
  if (s.indexOf('+84') === 0) s = '0' + s.slice(3);
  else if (/^84\d{9}$/.test(s)) s = '0' + s.slice(2);
  else if (/^[1-9]\d{8}$/.test(s)) s = '0' + s;
  if (!/^0\d{9,10}$/.test(s)) throw new Error('Số điện thoại không hợp lệ.');
  return s;
}

function normSocialLink(link) {
  let s = String(link || '').trim();
  if (!s) return '';
  if (s.length > 300) throw new Error('Link Instagram quá dài.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (!/^https?:\/\/(?:www\.)?instagram\.com(?:\/|$)/i.test(s) || !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(s)) {
    throw new Error('Vui lòng nhập link Instagram hợp lệ.');
  }
  return s;
}

// ===================== MENU & ĐƠN HÀNG =====================
async function getMenu(env) {
  const { results } = await env.DB.prepare('SELECT * FROM menu WHERE active = 1 ORDER BY id').all();
  return results.map(m => ({
    itemId: String(m.item_id), name: String(m.name || ''),
    price: Number(m.price) || 0, description: String(m.description || '')
  }));
}

function isCancelledStatus(status) { return /huỷ|hủy|cancel/i.test(String(status || '')); }
function isPaidStatus(status) { return /đã thanh toán|paid/i.test(String(status || '')); }

function canCancelOrder(status, paymentStatus) {
  if (isCancelledStatus(status) || isCancelledStatus(paymentStatus)) return false;
  if (isPaidStatus(paymentStatus)) return false;
  if (/đã giao|hoàn thành|completed|done/i.test(String(status || ''))) return false;
  return true;
}
function canPayOrder(status, paymentStatus, paymentMethod) {
  return String(paymentMethod || '') === 'Thanh toán trước' &&
    !isCancelledStatus(status) && !isCancelledStatus(paymentStatus) &&
    !/đã thanh toán|paid/i.test(String(paymentStatus || ''));
}

function pointsFor(env, lines) {
  const boxes = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  return boxes * cfg(env, 'POINTS_PER_BOX');
}

function buildCheckout(user, phone, c) {
  c = c || {};
  const sameRecipient = c.sameRecipient !== false;
  const recipientName = sameRecipient ? String(user.name || '') : String(c.recipientName || '').trim();
  const recipientPhone = sameRecipient ? phone : normPhone(c.recipientPhone);
  const fulfillmentType = c.fulfillmentType === 'delivery' ? 'Giao tận nơi' : 'Nhận tại NEU';
  const pickupLocation = String(c.pickupLocation || '').trim().slice(0, 300);
  const deliveryAddress = String(c.deliveryAddress || '').trim().slice(0, 500);
  const pickupDate = String(c.pickupDate || '').trim().slice(0, 60);
  const pickupTime = String(c.pickupTime || '').trim().slice(0, 80);
  const paymentMethod = c.paymentMethod === 'prepaid' ? 'Thanh toán trước' : 'Thanh toán khi nhận hàng';
  const note = String(c.note || '').trim().slice(0, 500);
  const recipientMessage = String(c.recipientMessage || '').trim().slice(0, 300);

  if (!recipientName) throw new Error('Vui lòng nhập họ tên người nhận.');
  if (!pickupDate || !pickupTime) throw new Error('Vui lòng chọn ngày và thời gian nhận bánh.');
  if (fulfillmentType === 'Nhận tại NEU' && !pickupLocation) throw new Error('Vui lòng ghi toà nhà, phòng hoặc giảng đường nhận bánh tại NEU.');
  if (fulfillmentType === 'Giao tận nơi' && !deliveryAddress) throw new Error('Vui lòng ghi địa chỉ giao bánh.');

  return { recipientName, recipientPhone, recipientMessage, fulfillmentType, pickupLocation, deliveryAddress, pickupDate, pickupTime, paymentMethod, note };
}

async function createOrder(b, ctx) {
  const user = await requireUser(ctx.env, b.token);
  const phone = user.phone;
  if (!Array.isArray(b.items) || !b.items.length) throw new Error('Giỏ hàng đang trống.');
  const checkout = buildCheckout(user, phone, b.checkout || {});

  const { results: menuRows } = await ctx.env.DB.prepare('SELECT * FROM menu WHERE active = 1').all();
  const menu = {}; menuRows.forEach(m => { menu[m.item_id] = m; });

  const lines = []; let total = 0; const seen = {};
  for (const it of b.items) {
    const id = String((it && it.itemId) || '');
    const qty = Number(it && it.qty);
    const m = menu[id];
    if (!m) throw new Error('Món "' + id + '" không còn bán. Vui lòng tải lại menu.');
    if (!(qty >= 1 && qty <= 99 && Math.floor(qty) === qty)) throw new Error('Số lượng không hợp lệ.');
    if (seen[id]) throw new Error('Món bị lặp trong giỏ hàng.');
    seen[id] = true;
    lines.push({ itemId: id, name: m.name, price: Number(m.price) || 0, qty });
    total += (Number(m.price) || 0) * qty;
  }

  const earned = pointsFor(ctx.env, lines);
  const orderId = 'BL' + formatCompact(new Date()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const createdAt = new Date().toISOString();
  const paymentStatus = checkout.paymentMethod === 'Thanh toán trước' ? 'Cần gửi minh chứng' : 'Thanh toán khi nhận hàng';

  await ctx.env.DB.prepare(
    `INSERT INTO orders (
       order_id, phone, customer_name, items_json, total, points_earned, points_credited, status, created_at, note,
       recipient_name, recipient_phone, recipient_message, fulfillment_type, pickup_location, delivery_address,
       pickup_date, pickup_time, payment_method, payment_status, payment_proof_url
     ) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,'')`
  ).bind(
    orderId, phone, user.name || '', JSON.stringify(lines), total, earned, cfg(ctx.env, 'NEW_ORDER_STATUS'), createdAt, checkout.note,
    checkout.recipientName, checkout.recipientPhone, checkout.recipientMessage, checkout.fulfillmentType, checkout.pickupLocation, checkout.deliveryAddress,
    checkout.pickupDate, checkout.pickupTime, checkout.paymentMethod, paymentStatus
  ).run();

  return { orderId, total, pointsEarned: earned, points: Number(user.points) || 0, paymentMethod: checkout.paymentMethod };
}

async function requireCustomerOrder(env, token, orderId) {
  const user = await requireUser(env, token);
  const order = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(String(orderId || '')).first();
  if (!order || order.phone !== user.phone) throw new Error('Không tìm thấy đơn hàng.');
  return { user, order };
}

async function cancelOrder(b, ctx) {
  const { user, order } = await requireCustomerOrder(ctx.env, b.token, b.orderId);
  if (!canCancelOrder(order.status, order.payment_status)) throw new Error('Đơn này không thể huỷ online. Vui lòng nhắn Brownies Lab để được hỗ trợ.');

  await ctx.env.DB.prepare("UPDATE orders SET status = 'Đã huỷ', payment_status = 'Đã huỷ' WHERE id = ?").bind(order.id).run();

  let newPoints = Number(user.points) || 0;
  if (order.points_credited) {
    newPoints = Math.max(0, newPoints - (Number(order.points_earned) || 0));
    await ctx.env.DB.prepare('UPDATE users SET points = ? WHERE phone = ?').bind(newPoints, user.phone).run();
  }
  return { orderId: order.order_id, points: newPoints };
}

async function myOrders(b, ctx) {
  const user = await requireUser(ctx.env, b.token);
  const { results } = await ctx.env.DB.prepare('SELECT * FROM orders WHERE phone = ? ORDER BY id DESC').bind(user.phone).all();
  return results.map(o => {
    let items = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch (e) { /* bỏ qua */ }
    return {
      orderId: o.order_id, items, total: Number(o.total) || 0,
      pointsEarned: Number(o.points_earned) || 0, pointsCredited: !!o.points_credited,
      status: o.status || '', paymentMethod: o.payment_method || 'Chưa chọn',
      paymentStatus: o.payment_status || 'Chưa thanh toán',
      canCancel: canCancelOrder(o.status, o.payment_status),
      canPay: canPayOrder(o.status, o.payment_status, o.payment_method),
      createdAt: fmtDate(o.created_at), note: o.note || ''
    };
  });
}

async function myPoints(b, ctx) {
  const u = await requireUser(ctx.env, b.token);
  return {
    points: Number(u.points) || 0, name: u.name || '', isAdmin: !!u.is_admin,
    rule: {
      pointsPerBox: cfg(ctx.env, 'POINTS_PER_BOX'),
      signupBonus: cfg(ctx.env, 'SIGNUP_BONUS'),
      freeBoxPoints: cfg(ctx.env, 'FREE_BOX_POINTS')
    }
  };
}

async function paymentInfo(b, ctx) {
  const { order } = await requireCustomerOrder(ctx.env, b.token, b.orderId);
  return {
    orderId: order.order_id, total: Number(order.total) || 0,
    paymentStatus: order.payment_status || 'Chưa thanh toán',
    paymentMethod: order.payment_method || 'Thanh toán trước',
    proofUrl: order.payment_proof_url || '',
    qrUrl: cfg(ctx.env, 'PAYMENT_QR_URL') || ''
  };
}

async function uploadPaymentProof(b, ctx) {
  const { order } = await requireCustomerOrder(ctx.env, b.token, b.orderId);
  if (isCancelledStatus(order.status)) throw new Error('Không thể tải ảnh cho đơn đã huỷ.');
  if (order.payment_method !== 'Thanh toán trước') throw new Error('Đơn này thanh toán khi nhận hàng, không cần gửi minh chứng.');

  const mimeType = String(b.mimeType || '').toLowerCase();
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(mimeType) < 0) throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WEBP.');

  const bytes = base64ToBytes(String(b.base64 || ''));
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Ảnh chuyển khoản phải nhỏ hơn 4 MB.');

  const origin = new URL(ctx.request.url).origin;
  const url = origin + '/proof/' + encodeURIComponent(order.order_id);

  await ctx.env.DB.prepare(
    "UPDATE orders SET payment_proof_url = ?, payment_proof_mime = ?, payment_proof_data = ?, payment_status = 'Chờ xác nhận thanh toán' WHERE id = ?"
  ).bind(url, mimeType, bytesToBase64(bytes), order.id).run();

  return { proofUrl: url, paymentStatus: 'Chờ xác nhận thanh toán' };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ===================== ADMIN (generic theo "sheet") =====================
// Tương đương 4 tab cũ trên Google Sheet. headers/columns phải cùng thứ tự.
const SHEET_DEFS = {
  Users: {
    table: 'users',
    headers:  ['Phone', 'Name', 'PinHash', 'Points', 'IsAdmin', 'CreatedAt', 'SocialLink'],
    columns:  ['phone', 'name', 'pin_hash', 'points', 'is_admin', 'created_at', 'social_link'],
    bool: new Set(['IsAdmin']), num: new Set(['Points']), date: new Set(['CreatedAt'])
  },
  Menu: {
    table: 'menu',
    headers:  ['ItemID', 'Name', 'Price', 'Description', 'Active'],
    columns:  ['item_id', 'name', 'price', 'description', 'active'],
    bool: new Set(['Active']), num: new Set(['Price']), date: new Set()
  },
  Orders: {
    table: 'orders',
    headers: [
      'OrderID', 'Phone', 'CustomerName', 'ItemsJSON', 'Total', 'PointsEarned', 'PointsCredited', 'Status', 'CreatedAt', 'Note',
      'RecipientName', 'RecipientPhone', 'RecipientMessage', 'FulfillmentType', 'PickupLocation',
      'DeliveryAddress', 'PickupDate', 'PickupTime', 'PaymentMethod', 'PaymentStatus', 'PaymentProofUrl'
    ],
    columns: [
      'order_id', 'phone', 'customer_name', 'items_json', 'total', 'points_earned', 'points_credited', 'status', 'created_at', 'note',
      'recipient_name', 'recipient_phone', 'recipient_message', 'fulfillment_type', 'pickup_location',
      'delivery_address', 'pickup_date', 'pickup_time', 'payment_method', 'payment_status', 'payment_proof_url'
    ],
    bool: new Set(['PointsCredited']), num: new Set(['Total', 'PointsEarned']), date: new Set(['CreatedAt'])
  },
  Sessions: {
    table: 'sessions',
    headers:  ['Token', 'Phone', 'ExpiresAt'],
    columns:  ['token', 'phone', 'expires_at'],
    bool: new Set(), num: new Set(), date: new Set(['ExpiresAt'])
  }
};

function sheetDef(name) {
  const def = SHEET_DEFS[name];
  if (!def) throw new Error('Bảng không hợp lệ: ' + name);
  return def;
}

function outputValue(header, raw, def) {
  if (def.bool.has(header)) return !!raw;
  if (def.date.has(header)) return fmtDate(raw);
  if (def.num.has(header)) return Number(raw) || 0;
  return raw === null || raw === undefined ? '' : String(raw);
}

function rowToHeaderObj(def, row) {
  const obj = {};
  def.headers.forEach((h, i) => { obj[h] = row[def.columns[i]]; });
  return obj;
}

async function adminListSheet(b, ctx) {
  await requireAdmin(ctx.env, b.token);
  const def = sheetDef(b.sheet);
  const { results } = await ctx.env.DB.prepare(`SELECT id, ${def.columns.join(', ')} FROM ${def.table} ORDER BY id`).all();
  const rows = results.map(r => ({
    rowIndex: r.id,
    values: def.headers.map((h, i) => outputValue(h, r[def.columns[i]], def))
  }));
  return { sheet: b.sheet, headers: def.headers, rows };
}

/** Đọc dòng theo id (= rowIndex) và kiểm tra matchKey = giá trị cột đầu tiên (khoá tự nhiên), tránh sửa/xoá nhầm khi dữ liệu đã đổi. */
async function checkRow(env, def, rowIndex, matchKey) {
  const row = await env.DB.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).bind(Number(rowIndex)).first();
  if (!row) throw new Error('Dòng không tồn tại.');
  if (matchKey !== undefined && matchKey !== null) {
    if (String(row[def.columns[0]]) !== String(matchKey)) throw new Error('Dữ liệu đã thay đổi kể từ lần tải trước. Hãy tải lại bảng.');
  }
  return row;
}

/** Chỉ giữ key là header thật; Users.PinHash nhập 4–6 số thì tự hash theo Phone. */
async function prepareAdminData(def, data, currentHeaderObj, env, sheetName) {
  const obj = {};
  def.headers.forEach(h => { if (Object.prototype.hasOwnProperty.call(data, h)) obj[h] = data[h]; });
  if (sheetName === 'Users') {
    if (obj.Phone !== undefined) obj.Phone = normPhone(obj.Phone);
    const phone = obj.Phone || (currentHeaderObj && currentHeaderObj.Phone);
    if (obj.PinHash !== undefined && /^\d{4,6}$/.test(String(obj.PinHash))) {
      if (!phone) throw new Error('Cần có Phone để đặt PIN.');
      obj.PinHash = await hashPin(env, phone, obj.PinHash);
    } else if (currentHeaderObj && obj.Phone && obj.Phone !== currentHeaderObj.Phone && obj.PinHash === currentHeaderObj.PinHash) {
      throw new Error('PIN được hash theo SĐT: khi đổi Phone, hãy nhập PIN mới (4–6 số) vào ô PinHash.');
    }
  }
  return obj;
}

function coerceForStorage(header, value, def) {
  if (def.bool.has(header)) return (value === true || /^true$/i.test(String(value))) ? 1 : 0;
  if (def.num.has(header)) { const n = Number(value); return isNaN(n) ? 0 : n; }
  if (def.date.has(header)) { const p = parseAdminDate(value); return p || String(value == null ? '' : value); }
  return value === null || value === undefined ? '' : String(value);
}

async function adminAddRow(b, ctx) {
  await requireAdmin(ctx.env, b.token);
  const def = sheetDef(b.sheet);
  const prepared = await prepareAdminData(def, b.data || {}, null, ctx.env, b.sheet);
  const cols = [], placeholders = [], vals = [];
  def.headers.forEach((h, i) => {
    if (!Object.prototype.hasOwnProperty.call(prepared, h)) return;
    cols.push(def.columns[i]); placeholders.push('?'); vals.push(coerceForStorage(h, prepared[h], def));
  });
  if (!cols.length) throw new Error('Không có dữ liệu để thêm.');
  const res = await ctx.env.DB.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).bind(...vals).run();
  return { rowIndex: res.meta.last_row_id };
}

async function adminUpdateRow(b, ctx) {
  await requireAdmin(ctx.env, b.token);
  const def = sheetDef(b.sheet);
  if (b.sheet === 'Orders') {
    const blocked = ['PointsEarned', 'PointsCredited', 'PaymentMethod', 'PaymentStatus'];
    if (blocked.some(k => Object.prototype.hasOwnProperty.call(b.data || {}, k))) {
      throw new Error('Dùng nút "Xác nhận TT & cộng điểm" để xác nhận thanh toán và cộng điểm.');
    }
  }
  const row = await checkRow(ctx.env, def, b.rowIndex, b.matchKey);
  const currentHeaderObj = rowToHeaderObj(def, row);
  const prepared = await prepareAdminData(def, b.data || {}, currentHeaderObj, ctx.env, b.sheet);

  const sets = [], vals = [];
  def.headers.forEach((h, i) => {
    if (!Object.prototype.hasOwnProperty.call(prepared, h)) return;
    sets.push(def.columns[i] + ' = ?'); vals.push(coerceForStorage(h, prepared[h], def));
  });
  if (sets.length) {
    vals.push(row.id);
    await ctx.env.DB.prepare(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  }
  return { rowIndex: row.id };
}

async function adminDeleteRow(b, ctx) {
  const admin = await requireAdmin(ctx.env, b.token);
  const def = sheetDef(b.sheet);
  const row = await checkRow(ctx.env, def, b.rowIndex, b.matchKey);
  if (b.sheet === 'Users' && String(row.phone) === String(admin.phone)) {
    throw new Error('Không thể tự xoá tài khoản admin đang đăng nhập.');
  }
  await ctx.env.DB.prepare(`DELETE FROM ${def.table} WHERE id = ?`).bind(row.id).run();
  return { deleted: row.id };
}

async function adminConfirmPayment(b, ctx) {
  await requireAdmin(ctx.env, b.token);
  const def = sheetDef('Orders');
  const row = await checkRow(ctx.env, def, b.rowIndex, b.matchKey);
  if (isCancelledStatus(row.status) || isCancelledStatus(row.payment_status)) throw new Error('Không thể xác nhận thanh toán cho đơn đã huỷ.');

  const method = row.payment_method || '';
  if (method === 'Thanh toán trước') {
    if (!row.payment_proof_url) throw new Error('Khách chưa gửi ảnh minh chứng thanh toán.');
    if (!/chờ xác nhận|đã thanh toán/i.test(row.payment_status || '')) throw new Error('Ảnh thanh toán chưa ở trạng thái chờ xác nhận.');
  } else if (method !== 'Thanh toán khi nhận hàng') {
    throw new Error('Đơn chưa có phương thức thanh toán hợp lệ.');
  }
  if (!isPaidStatus(row.payment_status)) {
    await ctx.env.DB.prepare("UPDATE orders SET payment_status = 'Đã thanh toán' WHERE id = ?").bind(row.id).run();
  }

  let credited = false, points = null;
  if (!row.points_credited) {
    const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(row.phone).first();
    if (!user) throw new Error('Không tìm thấy khách hàng để cộng điểm.');
    points = (Number(user.points) || 0) + (Number(row.points_earned) || 0);
    await ctx.env.DB.prepare('UPDATE users SET points = ? WHERE phone = ?').bind(points, row.phone).run();
    await ctx.env.DB.prepare('UPDATE orders SET points_credited = 1 WHERE id = ?').bind(row.id).run();
    credited = true;
  }
  return { orderId: row.order_id, points, credited };
}

// ===================== NGÀY GIỜ =====================
/** yyyy-MM-dd HH:mm theo giờ Việt Nam, để hiển thị trên trang admin. */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d).replace(',', '');
}

/** Admin nhập "yyyy-mm-dd hh:mm" (giờ VN) -> lưu ISO UTC. */
function parseAdminDate(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+07:00`;
  const d = new Date(iso);
  return isNaN(d) ? null : d.toISOString();
}

function formatCompact(d) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}
