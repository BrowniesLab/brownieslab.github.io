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
const MAX_BOXES_PER_BATCH = 30;

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
      if (RATE_LIMITED_ACTIONS.has(action)) await checkRateLimit(env, request, action, RATE_LIMIT_MAX);
      else if (READ_RATE_LIMITED_ACTIONS.has(action)) await checkRateLimit(env, request, action, READ_RATE_LIMIT_MAX);
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
  pickupAvailability: (b, ctx) => pickupAvailability(b, ctx),
  adminPickupCapacity: (b, ctx) => adminPickupCapacity(b, ctx),
  myPoints:           (b, ctx) => myPoints(b, ctx),
  createRedemption:   (b, ctx) => createRedemption(b, ctx),
  myRedemptions:      (b, ctx) => myRedemptions(b, ctx),
  paymentInfo:        (b, ctx) => paymentInfo(b, ctx),
  uploadPaymentProof: (b, ctx) => uploadPaymentProof(b, ctx),
  adminCreateOrder:   (b, ctx) => adminCreateOrder(b, ctx),
  adminListSheet:     (b, ctx) => adminListSheet(b, ctx),
  adminConfirmPayment:(b, ctx) => adminConfirmPayment(b, ctx),
  adminAddRow:        (b, ctx) => adminAddRow(b, ctx),
  adminUpdateRow:     (b, ctx) => adminUpdateRow(b, ctx),
  adminDeleteRow:     (b, ctx) => adminDeleteRow(b, ctx)
};

// ===================== CHỐNG SPAM =====================
// Các action tốn tài nguyên (ghi D1, có thể bị spam) — giới hạn theo IP để tránh bị
// một nguồn spam làm cạn quota D1/Workers free trong ngày (không tốn phí, nhưng web
// sẽ ngưng hoạt động cho tới 00:00 UTC nếu quota cạn).
const RATE_LIMITED_ACTIONS = new Set([
  'register', 'login', 'createOrder', 'cancelOrder', 'uploadPaymentProof', 'createRedemption'
]);
const RATE_LIMIT_MAX = 30;      // tối đa 30 lần/loại action/IP

// Action chỉ đọc, giờ public (xem menu không cần đăng nhập) — giới hạn rộng hơn nhiều,
// chỉ để chặn crawler/bot dội liên tục, không ảnh hưởng khách xem menu bình thường.
const READ_RATE_LIMITED_ACTIONS = new Set(['getMenu']);
const READ_RATE_LIMIT_MAX = 300;

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // trong 10 phút

async function checkRateLimit(env, request, action, max) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = action + ':' + ip;
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?').bind(bucket).first();
  if (row && now - new Date(row.window_start).getTime() < RATE_LIMIT_WINDOW_MS) {
    if (row.count >= max) {
      throw new Error('Bạn thao tác quá nhanh, vui lòng thử lại sau vài phút.');
    }
    await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').bind(bucket).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO rate_limits (bucket, count, window_start) VALUES (?,1,?) ' +
      'ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start'
    ).bind(bucket, new Date(now).toISOString()).run();
  }
}

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

  // Ghi user và nhật ký quà đăng ký trong cùng một transaction. Nhật ký có
  // phone là khoá chính, bảo đảm không thể cộng quà đăng ký hai lần.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      'INSERT INTO users (phone, name, pin_hash, points, is_admin, created_at, social_link, claim_used) VALUES (?,?,?,?,0,?,?,1)'
    ).bind(phone, name, pinHash, points, createdAt, socialLink),
    ctx.env.DB.prepare(
      'INSERT INTO signup_bonus_credits (phone, points, credited_at, applied) VALUES (?,?,?,1)'
    ).bind(phone, signupBonus, createdAt)
  ]);
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


/** Lịch chốt sổ và các đợt kế tiếp có thể dùng khi đợt gần nhất đã đầy. */
function pickupDateSchedule(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = type => Number(parts.find(part => part.type === type).value);
  const cursor = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), 12));
  const currentDay = cursor.getUTCDay();
  const optionLimit = (currentDay === 2 || currentDay === 3) ? 2 : 1;
  const firstWeekday = currentDay >= 4 ? 1 : 5;
  const dates = [];
  let collecting = false;
  for (let offset = 1; offset < 90 && dates.length < 12; offset++) {
    const d = new Date(cursor);
    d.setUTCDate(d.getUTCDate() + offset);
    const weekday = d.getUTCDay();
    if (!collecting && weekday !== firstWeekday) continue;
    if (!collecting) collecting = true;
    if (weekday === 1 || weekday === 5) dates.push(d);
  }
  return {
    dates: dates.map(d => {
      const weekday = d.getUTCDay() === 1 ? 'Thứ 2' : 'Thứ 6';
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      return weekday + ' (' + day + '/' + month + ')';
    }),
    optionLimit
  };
}

function requestedBoxCount(value) {
  const boxes = Number(value);
  if (!(boxes >= 1 && boxes <= MAX_BOXES_PER_BATCH && Math.floor(boxes) === boxes)) {
    throw new Error('Mỗi đơn chỉ có thể đặt từ 1 đến ' + MAX_BOXES_PER_BATCH + ' hộp.');
  }
  return boxes;
}

async function pickupAvailability(b, ctx) {
  await requireUser(ctx.env, b.token);
  const boxes = requestedBoxCount(b.boxCount);
  const schedule = pickupDateSchedule();
  const placeholders = schedule.dates.map(() => '?').join(',');
  const rows = placeholders
    ? (await ctx.env.DB.prepare(`SELECT pickup_date, boxes_reserved FROM pickup_batches WHERE pickup_date IN (${placeholders})`).bind(...schedule.dates).all()).results
    : [];
  const reserved = new Map(rows.map(row => [row.pickup_date, Number(row.boxes_reserved) || 0]));
  const slots = schedule.dates.map(date => {
    const remaining = Math.max(0, MAX_BOXES_PER_BATCH - (reserved.get(date) || 0));
    return { date, remaining, selectable: remaining >= boxes };
  });
  const dates = [];
  let selectableCount = 0;
  for (const slot of slots) {
    dates.push(slot);
    if (slot.selectable) selectableCount++;
    if (selectableCount >= schedule.optionLimit) break;
  }
  return { maxBoxes: MAX_BOXES_PER_BATCH, dates };
}


/** Số hộp đang được khách đặt web giữ cho một ngày; chỉ admin mới xem được. */
async function adminPickupCapacity(b, ctx) {
  await requireAdmin(ctx.env, b.token);
  const pickupDate = String(b.pickupDate || '').trim();
  if (!pickupDate) throw new Error('Vui lòng nhập ngày nhận bánh.');
  const row = await ctx.env.DB.prepare(
    'SELECT boxes_reserved FROM pickup_batches WHERE pickup_date = ?'
  ).bind(pickupDate).first();
  const reserved = Math.min(MAX_BOXES_PER_BATCH, Math.max(0, Number(row && row.boxes_reserved) || 0));
  return {
    pickupDate,
    reserved,
    remaining: MAX_BOXES_PER_BATCH - reserved,
    maxBoxes: MAX_BOXES_PER_BATCH
  };
}
async function reservePickupBoxes(env, pickupDate, boxes) {
  const res = await env.DB.prepare(
    `INSERT INTO pickup_batches (pickup_date, boxes_reserved) VALUES (?, ?)
     ON CONFLICT(pickup_date) DO UPDATE SET boxes_reserved = pickup_batches.boxes_reserved + excluded.boxes_reserved
     WHERE pickup_batches.boxes_reserved + excluded.boxes_reserved <= ?`
  ).bind(pickupDate, boxes, MAX_BOXES_PER_BATCH).run();
  if (res.meta.changes !== 1) throw new Error('Đợt nhận bánh này vừa đủ 30 hộp. Vui lòng chọn ngày gần nhất kế tiếp.');
}

async function releasePickupBoxes(env, pickupDate, boxes) {
  return env.DB.prepare('UPDATE pickup_batches SET boxes_reserved = MAX(0, boxes_reserved - ?) WHERE pickup_date = ?')
    .bind(boxes, pickupDate).run();
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
  if (!pickupDateSchedule().dates.includes(pickupDate)) throw new Error('Ngày nhận bánh đã qua hoặc không còn mở. Vui lòng tải lại trang để chọn ngày mới.');
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

  const boxCount = requestedBoxCount(lines.reduce((sum, line) => sum + line.qty, 0));
  const earned = pointsFor(ctx.env, lines);
  const orderId = 'BL' + formatCompact(new Date()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const createdAt = new Date().toISOString();
  const paymentStatus = checkout.paymentMethod === 'Thanh toán trước' ? 'Cần gửi minh chứng' : 'Chưa thanh toán';

  let reserved = false;
  try {
    await reservePickupBoxes(ctx.env, checkout.pickupDate, boxCount);
    reserved = true;
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
  } catch (err) {
    if (reserved) await releasePickupBoxes(ctx.env, checkout.pickupDate, boxCount);
    throw err;
  }

  return { orderId, total, pointsEarned: earned, points: Number(user.points) || 0, paymentMethod: checkout.paymentMethod };
}

/**
 * Admin nhập tay đơn bị sót (vd khách nhắn tin đặt ngoài web). Dùng lại y hệt cách tính
 * tiền/điểm của createOrder, chỉ khác là khách chỉ định bằng SĐT bất kỳ thay vì lấy từ
 * session, và không set sẵn Status/PaymentStatus — đơn tạo ra luôn bắt đầu ở "Mới", đi qua
 * đúng luồng Xác nhận thanh toán / Xác nhận đã giao như đơn khách tự đặt.
 */
async function adminCreateOrder(b, ctx) {
  await requireAdmin(ctx.env, b.token);
  const phone = normPhone(b.phone);
  const customerName = String(b.customerName || '').trim();
  if (!customerName) throw new Error('Vui lòng nhập tên khách.');
  if (!Array.isArray(b.items) || !b.items.length) throw new Error('Chưa chọn món nào.');
  const checkout = buildCheckout({ name: customerName }, phone, b.checkout || {});

  const { results: menuRows } = await ctx.env.DB.prepare('SELECT * FROM menu WHERE active = 1').all();
  const menu = {}; menuRows.forEach(m => { menu[m.item_id] = m; });

  const lines = []; let total = 0; const seen = {};
  for (const it of b.items) {
    const id = String((it && it.itemId) || '');
    const qty = Number(it && it.qty);
    const m = menu[id];
    if (!m) throw new Error('Món "' + id + '" không còn bán. Vui lòng tải lại menu.');
    if (!(qty >= 1 && qty <= 99 && Math.floor(qty) === qty)) throw new Error('Số lượng không hợp lệ.');
    if (seen[id]) throw new Error('Món bị lặp trong đơn.');
    seen[id] = true;
    // Admin có thể ghi đè giá (đơn giá cũ, bán trước khi công bố giá hiện tại); mặc định
    // lấy giá Menu hiện tại nếu không truyền price.
    let price = Number(m.price) || 0;
    if (it && it.price !== undefined && it.price !== null && it.price !== '') {
      const customPrice = Number(it.price);
      if (!Number.isFinite(customPrice) || customPrice < 0) throw new Error('Giá món "' + id + '" không hợp lệ.');
      price = customPrice;
    }
    lines.push({ itemId: id, name: m.name, price, qty });
    total += price * qty;
  }

  const earned = pointsFor(ctx.env, lines);
  const orderId = 'BL' + formatCompact(new Date()) + '-A' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const createdAt = new Date().toISOString();
  const paymentStatus = checkout.paymentMethod === 'Thanh toán trước' ? 'Cần gửi minh chứng' : 'Chưa thanh toán';

  // Cố ý KHÔNG gọi reservePickupBoxes: đơn admin nhập tay không trừ vào giới hạn 30
  // hộp/đợt của web — dùng để nhận thêm cho người quen ngoài suất công khai.
  await ctx.env.DB.prepare(
    `INSERT INTO orders (
       order_id, phone, customer_name, items_json, total, points_earned, points_credited, status, created_at, note,
       recipient_name, recipient_phone, recipient_message, fulfillment_type, pickup_location, delivery_address,
       pickup_date, pickup_time, payment_method, payment_status, payment_proof_url
     ) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,'')`
  ).bind(
    orderId, phone, customerName, JSON.stringify(lines), total, earned, cfg(ctx.env, 'NEW_ORDER_STATUS'), createdAt, checkout.note,
    checkout.recipientName, checkout.recipientPhone, checkout.recipientMessage, checkout.fulfillmentType, checkout.pickupLocation, checkout.deliveryAddress,
    checkout.pickupDate, checkout.pickupTime, checkout.paymentMethod, paymentStatus
  ).run();

  return { orderId, total, pointsEarned: earned, paymentMethod: checkout.paymentMethod };
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

  let boxCount = 0;
  try { boxCount = JSON.parse(order.items_json || '[]').reduce((sum, line) => sum + (Number(line.qty) || 0), 0); } catch (e) {}
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("UPDATE orders SET status = 'Đã huỷ', payment_status = 'Đã huỷ' WHERE id = ?").bind(order.id),
    ctx.env.DB.prepare('UPDATE pickup_batches SET boxes_reserved = MAX(0, boxes_reserved - ?) WHERE pickup_date = ?').bind(boxCount, order.pickup_date)
  ]);

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

/** Đổi điểm lấy hộp bánh: không tin điểm, giá hay món từ trình duyệt. */
async function createRedemption(b, ctx) {
  const user = await requireUser(ctx.env, b.token);
  const quantity = Number(b.qty);
  if (!(quantity >= 1 && quantity <= 99 && Math.floor(quantity) === quantity)) throw new Error('Số hộp đổi không hợp lệ.');
  const menu = await getMenu(ctx.env);
  const item = menu.find(m => String(m.itemId) === String(b.itemId || ''));
  if (!item) throw new Error('Vị bánh này hiện không còn bán. Vui lòng tải lại trang.');
  const pointsPerBox = Number(cfg(ctx.env, 'FREE_BOX_POINTS')) || 0;
  if (pointsPerBox <= 0) throw new Error('Cấu hình đổi điểm không hợp lệ.');
  const spent = quantity * pointsPerBox;
  const redemptionId = 'RD' + formatCompact(new Date()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const createdAt = new Date().toISOString();

  // Trừ điểm có điều kiện ngay trong database, nên hai lần bấm đồng thời không thể đổi quá số điểm có.
  const deducted = await ctx.env.DB.prepare(
    'UPDATE users SET points = points - ? WHERE phone = ? AND points >= ?'
  ).bind(spent, user.phone, spent).run();
  if (!deducted.meta || Number(deducted.meta.changes) !== 1) throw new Error('Bạn không đủ điểm để đổi số hộp bánh này.');
  try {
    await ctx.env.DB.prepare(
      'INSERT INTO redemptions (redemption_id, phone, customer_name, item_id, item_name, quantity, points_spent, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(redemptionId, user.phone, user.name || '', item.itemId, item.name || '', quantity, spent, 'Yêu cầu mới', createdAt).run();
  } catch (err) {
    await ctx.env.DB.prepare('UPDATE users SET points = points + ? WHERE phone = ?').bind(spent, user.phone).run();
    throw err;
  }
  return { redemptionId, itemName: item.name || '', quantity, pointsSpent: spent, points: (Number(user.points) || 0) - spent };
}

async function myRedemptions(b, ctx) {
  const user = await requireUser(ctx.env, b.token);
  const { results } = await ctx.env.DB.prepare('SELECT * FROM redemptions WHERE phone = ? ORDER BY id DESC').bind(user.phone).all();
  return results.map(r => ({
    redemptionId: r.redemption_id || '', itemName: r.item_name || '', quantity: Number(r.quantity) || 0,
    pointsSpent: Number(r.points_spent) || 0, status: r.status || '', createdAt: fmtDate(r.created_at)
  }));
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
  Redemptions: {
    table: 'redemptions',
    headers: ['RedemptionID', 'Phone', 'CustomerName', 'ItemID', 'ItemName', 'Quantity', 'PointsSpent', 'Status', 'CreatedAt'],
    columns: ['redemption_id', 'phone', 'customer_name', 'item_id', 'item_name', 'quantity', 'points_spent', 'status', 'created_at'],
    bool: new Set(), num: new Set(['Quantity', 'PointsSpent']), date: new Set(['CreatedAt'])
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
  if (b.sheet === 'Redemptions') throw new Error('Yêu cầu đổi điểm chỉ được tạo bởi khách hàng trên trang đổi điểm.');
  if (b.sheet === 'Orders') throw new Error('Đơn phải được tạo từ trang đặt bánh để giữ đúng sức chứa từng đợt.');
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
    const blocked = ['PointsEarned', 'PointsCredited', 'PaymentMethod', 'PaymentStatus', 'ItemsJSON', 'PickupDate'];
    if (blocked.some(k => Object.prototype.hasOwnProperty.call(b.data || {}, k))) {
      throw new Error('Không thể sửa món, ngày nhận hoặc thanh toán trực tiếp vì sẽ làm lệch sức chứa/điểm.');
    }
    if (Object.prototype.hasOwnProperty.call(b.data || {}, 'Status') && isCancelledStatus(b.data.Status)) {
      throw new Error('Không thể huỷ đơn từ admin. Khách cần huỷ trên trang đơn hàng để hệ thống hoàn số hộp.');
    }
  }
  if (b.sheet === 'Redemptions' && Object.keys(b.data || {}).some(k => k !== 'Status')) {
    throw new Error('Chỉ được cập nhật trạng thái yêu cầu đổi điểm.');
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
  if (b.sheet === 'Redemptions') throw new Error('Không thể xoá yêu cầu đổi điểm để giữ lịch sử trừ điểm.');
  if (b.sheet === 'Orders') throw new Error('Không thể xoá đơn để giữ đúng sức chứa từng đợt.');
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
    // Đơn cũ (import từ dữ liệu trước khi có tính năng upload ảnh) có thể đã được ghi nhận
    // "Đã thanh toán" mà không có ảnh — vẫn cho xác nhận trong trường hợp đó.
    if (!row.payment_proof_url && !/đã thanh toán/i.test(row.payment_status || '')) {
      throw new Error('Khách chưa gửi ảnh minh chứng thanh toán.');
    }
    if (!/chờ xác nhận|đã thanh toán/i.test(row.payment_status || '')) throw new Error('Ảnh thanh toán chưa ở trạng thái chờ xác nhận.');
  } else if (method !== 'Thanh toán khi nhận hàng') {
    throw new Error('Đơn chưa có phương thức thanh toán hợp lệ.');
  }
  if (!isPaidStatus(row.payment_status)) {
    await ctx.env.DB.prepare("UPDATE orders SET payment_status = 'Đã thanh toán' WHERE id = ?").bind(row.id).run();
  }

  // Cộng điểm ngay nếu khách đã có tài khoản. Nếu chưa (chỉ mới đặt qua SĐT, chưa đăng ký),
  // không báo lỗi — điểm vẫn neo theo SĐT (points_earned trên đơn, points_credited=0) và sẽ
  // tự cộng vào tài khoản ngay khi họ đăng ký (xem register()).
  let credited = false, points = null, accountExists = true;
  if (!row.points_credited) {
    const user = await ctx.env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(row.phone).first();
    if (!user) {
      accountExists = false;
    } else {
      points = (Number(user.points) || 0) + (Number(row.points_earned) || 0);
      await ctx.env.DB.prepare('UPDATE users SET points = ? WHERE phone = ?').bind(points, row.phone).run();
      await ctx.env.DB.prepare('UPDATE orders SET points_credited = 1 WHERE id = ?').bind(row.id).run();
      credited = true;
    }
  }
  return { orderId: row.order_id, points, credited, accountExists };
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
