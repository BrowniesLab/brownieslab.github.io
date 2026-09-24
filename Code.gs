/**
 * Brownies Lab — backend Google Apps Script (Web App)
 *
 * Dán file này vào Extensions > Apps Script của Google Sheet chứa dữ liệu.
 * Chạy hàm setup() một lần để tạo 4 tab Users / Menu / Orders / Sessions.
 * Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 */

// ===================== CẤU HÌNH =====================
// Có thể ghi đè các giá trị này trong Project Settings > Script Properties
// (cùng tên khoá) mà không phải sửa code.
var DEFAULTS = {
  PIN_SALT: 'BrowniesLab::doi-chuoi-nay-truoc-khi-deploy',
  POINTS_PER_BOX: 1,       // mỗi hộp bánh được bấy nhiêu điểm
  SIGNUP_BONUS: 2,         // tặng ngay khi tạo tài khoản mới
  FREE_BOX_POINTS: 10,     // số điểm đổi một hộp miễn phí
  SESSION_DAYS: 30,        // hạn của token đăng nhập
  MAX_LOGIN_FAILS: 5,      // sai PIN quá số lần này thì khoá tạm
  LOCK_MINUTES: 15,
  NEW_ORDER_STATUS: 'Mới',
  PAYMENT_QR_URL: ''
};

var SHEETS = {
  Users:    ['Phone', 'Name', 'PinHash', 'Points', 'IsAdmin', 'CreatedAt', 'SocialLink'],
  Menu:     ['ItemID', 'Name', 'Price', 'Description', 'Active'],
  Orders:   ['OrderID', 'Phone', 'CustomerName', 'ItemsJSON', 'Total', 'PointsEarned', 'PointsCredited', 'Status', 'CreatedAt', 'Note',
             'RecipientName', 'RecipientPhone', 'RecipientMessage', 'FulfillmentType', 'PickupLocation',
             'DeliveryAddress', 'PickupDate', 'PickupTime', 'PaymentMethod', 'PaymentStatus', 'PaymentProofUrl'],
  Sessions: ['Token', 'Phone', 'ExpiresAt']
};

// Cột luôn lưu dạng chữ (giữ số 0 đầu SĐT, không để Sheets tự đổi thành số/ngày)
var TEXT_COLUMNS = ['Phone', 'PinHash', 'Token', 'OrderID', 'ItemID', 'ItemsJSON', 'Note', 'Name', 'CustomerName', 'Description', 'Status', 'SocialLink',
  'RecipientName', 'RecipientPhone', 'RecipientMessage', 'FulfillmentType', 'PickupLocation', 'DeliveryAddress',
  'PickupDate', 'PickupTime', 'PaymentMethod', 'PaymentStatus', 'PaymentProofUrl'];

function cfg_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === '') return DEFAULTS[key];
  return typeof DEFAULTS[key] === 'number' ? Number(v) : v;
}

// ===================== ENTRY POINTS =====================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'getMenu';
  return handle_(function () {
    if (action === 'getMenu') return getMenu_();
    if (action === 'ping') return { time: new Date().toISOString() };
    throw new Error('Action GET không hợp lệ: ' + action);
  });
}

function doPost(e) {
  return handle_(function () {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (err) { throw new Error('Body không phải JSON hợp lệ'); }
    var fn = ACTIONS[body.action];
    if (!fn) throw new Error('Action không hợp lệ: ' + body.action);
    return fn(body);
  });
}

var ACTIONS = {
  register:       function (b) { return withLock_(function () { return register_(b.phone, b.name, b.pin, b.socialLink); }); },
  login:          function (b) { return login_(b.phone, b.pin); },
  logout:         function (b) { return withLock_(function () { return logout_(b.token); }); },
  getMenu:        function ()  { return getMenu_(); },
  createOrder:    function (b) { return withLock_(function () { return createOrder_(b.token, b.items, b.checkout || {}); }); },
  cancelOrder:    function (b) { return withLock_(function () { return cancelOrder_(b.token, b.orderId); }); },
  myOrders:       function (b) { return myOrders_(b.token); },
  myPoints:       function (b) { return myPoints_(b.token); },
  paymentInfo:    function (b) { return paymentInfo_(b.token, b.orderId); },
  uploadPaymentProof: function (b) { return withLock_(function () { return uploadPaymentProof_(b.token, b.orderId, b.filename, b.mimeType, b.base64); }); },
  adminListSheet: function (b) { return adminListSheet_(b.token, b.sheet); },
  adminConfirmPayment: function (b) { return withLock_(function () { return adminConfirmPayment_(b.token, b.rowIndex, b.matchKey); }); },
  adminAddRow:    function (b) { return withLock_(function () { return adminAddRow_(b.token, b.sheet, b.data); }); },
  adminUpdateRow: function (b) { return withLock_(function () { return adminUpdateRow_(b.token, b.sheet, b.rowIndex, b.data, b.matchKey); }); },
  adminDeleteRow: function (b) { return withLock_(function () { return adminDeleteRow_(b.token, b.sheet, b.rowIndex, b.matchKey); }); }
};

function handle_(fn) {
  var out;
  try { out = { ok: true, data: fn() }; }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Hệ thống đang bận, vui lòng thử lại.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ===================== AUTH =====================
function register_(phone, name, pin, socialLink) {
  phone = normPhone_(phone);
  name = String(name || '').trim();
  socialLink = normSocialLink_(socialLink);
  validatePin_(pin);
  if (!name) throw new Error('Vui lòng nhập tên.');
  if (name.length > 60) throw new Error('Tên quá dài.');

  var users = table_('Users');
  if (findRow_(users, 'Phone', phone, normPhone_)) throw new Error('Số điện thoại này đã đăng ký. Hãy đăng nhập.');

  var signupBonus = Math.max(0, Number(cfg_('SIGNUP_BONUS')) || 0);
  appendObject_(users, {
    Phone: phone, Name: name, PinHash: hashPin_(phone, pin),
    Points: signupBonus, IsAdmin: false, CreatedAt: new Date(), SocialLink: socialLink
  });
  return createSession_({ Phone: phone, Name: name, Points: signupBonus, IsAdmin: false });
}

function login_(phone, pin) {
  phone = normPhone_(phone);
  validatePin_(pin);

  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + phone;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= cfg_('MAX_LOGIN_FAILS')) {
    throw new Error('Sai PIN quá nhiều lần. Thử lại sau ' + cfg_('LOCK_MINUTES') + ' phút.');
  }

  var found = findRow_(table_('Users'), 'Phone', phone, normPhone_);
  if (!found || String(found.obj.PinHash) !== hashPin_(phone, pin)) {
    cache.put(failKey, String(fails + 1), cfg_('LOCK_MINUTES') * 60);
    throw new Error('Số điện thoại hoặc PIN không đúng.');
  }
  cache.remove(failKey);
  return withLock_(function () {
    purgeExpiredSessions_();
    return createSession_(found.obj);
  });
}

function logout_(token) {
  var sessions = table_('Sessions');
  var found = findRow_(sessions, 'Token', String(token || ''));
  if (found) sessions.sheet.deleteRow(found.row);
  return { loggedOut: true };
}

function createSession_(user) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var expires = new Date(Date.now() + cfg_('SESSION_DAYS') * 86400000);
  appendObject_(table_('Sessions'), { Token: token, Phone: normPhone_(user.Phone), ExpiresAt: expires });
  return {
    token: token,
    phone: normPhone_(user.Phone),
    name: String(user.Name || ''),
    points: Number(user.Points) || 0,
    isAdmin: isTrue_(user.IsAdmin),
    expiresAt: expires.toISOString()
  };
}

/** Trả về {row, obj} của user đang đăng nhập, hoặc ném lỗi. */
function requireUser_(token) {
  if (!token) throw new Error('AUTH: Bạn cần đăng nhập.');
  var s = findRow_(table_('Sessions'), 'Token', String(token));
  if (!s) throw new Error('AUTH: Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.');
  var exp = toDate_(s.obj.ExpiresAt);
  if (!exp || exp.getTime() < Date.now()) throw new Error('AUTH: Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  var u = findRow_(table_('Users'), 'Phone', normPhone_(s.obj.Phone), normPhone_);
  if (!u) throw new Error('AUTH: Tài khoản không còn tồn tại.');
  return u;
}

function requireAdmin_(token) {
  var u = requireUser_(token);
  if (!isTrue_(u.obj.IsAdmin)) throw new Error('Bạn không có quyền admin.');
  return u;
}

function purgeExpiredSessions_() {
  var t = table_('Sessions');
  var col = t.headers.indexOf('ExpiresAt');
  if (col < 0 || !t.rows.length) return;
  var now = Date.now();
  var keep = t.rows.filter(function (r) { var d = toDate_(r[col]); return d && d.getTime() > now; });
  if (keep.length === t.rows.length) return;
  t.sheet.getRange(2, 1, t.rows.length, t.headers.length).clearContent();
  if (keep.length) t.sheet.getRange(2, 1, keep.length, t.headers.length).setValues(keep);
}

function hashPin_(phone, pin) {
  var raw = cfg_('PIN_SALT') + '|' + phone + '|' + String(pin);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function validatePin_(pin) {
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw new Error('PIN phải gồm 4 đến 6 chữ số.');
}

/** Chuẩn hoá SĐT Việt Nam: bỏ ký tự thừa, +84/84 -> 0, bù số 0 bị Sheets cắt mất. */
function normPhone_(p) {
  var s = String(p === undefined || p === null ? '' : p).replace(/[^\d+]/g, '');
  if (s.indexOf('+84') === 0) s = '0' + s.slice(3);
  else if (/^84\d{9}$/.test(s)) s = '0' + s.slice(2);
  else if (/^[1-9]\d{8}$/.test(s)) s = '0' + s;
  if (!/^0\d{9,10}$/.test(s)) throw new Error('Số điện thoại không hợp lệ.');
  return s;
}

/** Link Instagram tuỳ chọn, dùng để xác nhận đơn với khách. */
function normSocialLink_(link) {
  var s = String(link || '').trim();
  if (!s) return '';
  if (s.length > 300) throw new Error('Link Instagram quá dài.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (!/^https?:\/\/(?:www\.)?instagram\.com(?:\/|$)/i.test(s) || !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(s)) {
    throw new Error('Vui lòng nhập link Instagram hợp lệ.');
  }
  return s;
}

// ===================== MENU & ĐƠN HÀNG =====================
function getMenu_() {
  return table_('Menu').objects
    .filter(function (m) { return isTrue_(m.obj.Active) && String(m.obj.ItemID).trim() !== ''; })
    .map(function (m) {
      return {
        itemId: String(m.obj.ItemID),
        name: String(m.obj.Name || ''),
        price: Number(m.obj.Price) || 0,
        description: String(m.obj.Description || '')
      };
    });
}

function pointsFor_(lines) {
  var boxes = lines.reduce(function (sum, line) { return sum + Number(line.qty || 0); }, 0);
  return boxes * cfg_('POINTS_PER_BOX');
}

function isCancelledStatus_(status) {
  return /huỷ|hủy|cancel/i.test(String(status || ''));
}

function canCancelOrder_(status, paymentStatus, paymentMethod) {
  if (isCancelledStatus_(status) || isCancelledStatus_(paymentStatus)) return false;
  // Khách được huỷ cho đến khi Brownies Lab xác nhận đã nhận tiền.
  // Áp dụng cho cả COD và trả trước; đơn đã giao/hoàn thành cũng không huỷ online.
  if (isPaidStatus_(paymentStatus)) return false;
  if (/đã giao|hoàn thành|completed|done/i.test(String(status || ''))) return false;
  return true;
}

function canPayOrder_(status, paymentStatus, paymentMethod) {
  return String(paymentMethod || '') === 'Thanh toán trước' &&
    !isCancelledStatus_(status) && !isCancelledStatus_(paymentStatus) &&
    !/đã thanh toán|paid/i.test(String(paymentStatus || ''));
}

function checkoutData_(user, phone, checkout) {
  var c = checkout || {};
  var sameRecipient = c.sameRecipient !== false;
  var recipientName = sameRecipient ? String(user.obj.Name || '') : String(c.recipientName || '').trim();
  var recipientPhone = sameRecipient ? phone : normPhone_(c.recipientPhone);
  var fulfillmentType = c.fulfillmentType === 'delivery' ? 'Giao tận nơi' : 'Nhận tại NEU';
  var pickupLocation = String(c.pickupLocation || '').trim().slice(0, 300);
  var deliveryAddress = String(c.deliveryAddress || '').trim().slice(0, 500);
  var pickupDate = String(c.pickupDate || '').trim().slice(0, 60);
  var pickupTime = String(c.pickupTime || '').trim().slice(0, 80);
  var paymentMethod = c.paymentMethod === 'prepaid' ? 'Thanh toán trước' : 'Thanh toán khi nhận hàng';
  var note = String(c.note || '').trim().slice(0, 500);
  var recipientMessage = String(c.recipientMessage || '').trim().slice(0, 300);

  if (!recipientName) throw new Error('Vui lòng nhập họ tên người nhận.');
  if (!pickupDate || !pickupTime) throw new Error('Vui lòng chọn ngày và thời gian nhận bánh.');
  if (fulfillmentType === 'Nhận tại NEU' && !pickupLocation) {
    throw new Error('Vui lòng ghi toà nhà, phòng hoặc giảng đường nhận bánh tại NEU.');
  }
  if (fulfillmentType === 'Giao tận nơi' && !deliveryAddress) {
    throw new Error('Vui lòng ghi địa chỉ giao bánh.');
  }
  return {
    RecipientName: recipientName, RecipientPhone: recipientPhone, RecipientMessage: recipientMessage,
    FulfillmentType: fulfillmentType, PickupLocation: pickupLocation, DeliveryAddress: deliveryAddress,
    PickupDate: pickupDate, PickupTime: pickupTime, PaymentMethod: paymentMethod, Note: note
  };
}

function createOrder_(token, items, checkout) {
  var user = requireUser_(token);
  var phone = normPhone_(user.obj.Phone);
  if (!Array.isArray(items) || !items.length) throw new Error('Giỏ hàng đang trống.');
  var checkoutData = checkoutData_(user, phone, checkout);

  var menu = {};
  getMenu_().forEach(function (m) { menu[m.itemId] = m; });

  var lines = [], total = 0, seen = {};
  items.forEach(function (it) {
    var id = String(it && it.itemId || '');
    var qty = Number(it && it.qty);
    if (!menu[id]) throw new Error('Món "' + id + '" không còn bán. Vui lòng tải lại menu.');
    if (!(qty >= 1 && qty <= 99 && Math.floor(qty) === qty)) throw new Error('Số lượng không hợp lệ.');
    if (seen[id]) throw new Error('Món bị lặp trong giỏ hàng.');
    seen[id] = true;
    // Giá luôn lấy từ sheet Menu, không tin giá phía client
    lines.push({ itemId: id, name: menu[id].name, price: menu[id].price, qty: qty });
    total += menu[id].price * qty;
  });

  var earned = pointsFor_(lines);
  var orderId = 'BL' + Utilities.formatDate(new Date(), tz_(), 'yyMMdd-HHmmss') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();
  var order = {
    OrderID: orderId,
    Phone: phone,
    CustomerName: String(user.obj.Name || ''),
    ItemsJSON: JSON.stringify(lines),
    Total: total,
    PointsEarned: earned,
    PointsCredited: false,
    Status: cfg_('NEW_ORDER_STATUS'),
    CreatedAt: new Date(),
    Note: checkoutData.Note,
    RecipientName: checkoutData.RecipientName,
    RecipientPhone: checkoutData.RecipientPhone,
    RecipientMessage: checkoutData.RecipientMessage,
    FulfillmentType: checkoutData.FulfillmentType,
    PickupLocation: checkoutData.PickupLocation,
    DeliveryAddress: checkoutData.DeliveryAddress,
    PickupDate: checkoutData.PickupDate,
    PickupTime: checkoutData.PickupTime,
    PaymentMethod: checkoutData.PaymentMethod,
    PaymentStatus: checkoutData.PaymentMethod === 'Thanh toán trước' ? 'Cần gửi minh chứng' : 'Thanh toán khi nhận hàng',
    PaymentProofUrl: ''
  };
  appendObject_(table_('Orders'), order);

  onOrderCreated_(order, lines);

  return { orderId: orderId, total: total, pointsEarned: earned, points: Number(user.obj.Points) || 0, paymentMethod: checkoutData.PaymentMethod };
}

/**
 * Điểm móc để tích hợp với hệ thống sheet "Đợt" / "Tổng hợp" hiện có.
 * Hiện chưa làm gì — sẽ được viết khi đã thống nhất cấu trúc các sheet đó.
 */
function onOrderCreated_(order, lines) {
}

function requireCustomerOrder_(token, orderId) {
  var user = requireUser_(token);
  var t = table_('Orders');
  var found = findRow_(t, 'OrderID', String(orderId || ''));
  if (!found || safePhone_(found.obj.Phone) !== normPhone_(user.obj.Phone)) {
    throw new Error('Không tìm thấy đơn hàng.');
  }
  return { user: user, table: t, found: found };
}

function cancelOrder_(token, orderId) {
  var ref = requireCustomerOrder_(token, orderId);
  var order = ref.found;
  if (!canCancelOrder_(order.obj.Status, order.obj.PaymentStatus, order.obj.PaymentMethod)) {
    throw new Error('Đơn này không thể huỷ online. Vui lòng nhắn Brownies Lab để được hỗ trợ.');
  }
  writeCell_(ref.table.sheet.getRange(order.row, ref.table.headers.indexOf('Status') + 1), 'Status', 'Đã huỷ');
  writeCell_(ref.table.sheet.getRange(order.row, ref.table.headers.indexOf('PaymentStatus') + 1), 'PaymentStatus', 'Đã huỷ');

  var newPoints = Number(ref.user.obj.Points) || 0;
  if (isTrue_(order.obj.PointsCredited)) {
    var users = table_('Users');
    var pointsCol = users.headers.indexOf('Points') + 1;
    newPoints = Math.max(0, newPoints - (Number(order.obj.PointsEarned) || 0));
    users.sheet.getRange(ref.user.row, pointsCol).setValue(newPoints);
  }
  return { orderId: String(order.obj.OrderID), points: newPoints };
}

function isPaidStatus_(status) { return /đã thanh toán|paid/i.test(String(status || '')); }

function creditPointsForOrder_(orders, row, order) {
  if (isTrue_(order.PointsCredited)) return { credited: false, points: null };
  var user = findRow_(table_('Users'), 'Phone', normPhone_(order.Phone), normPhone_);
  if (!user) throw new Error('Không tìm thấy khách hàng để cộng điểm.');
  var users = table_('Users');
  var pointsCol = users.headers.indexOf('Points') + 1;
  var newPoints = (Number(user.obj.Points) || 0) + (Number(order.PointsEarned) || 0);
  users.sheet.getRange(user.row, pointsCol).setValue(newPoints);
  writeCell_(orders.sheet.getRange(row, orders.headers.indexOf('PointsCredited') + 1), 'PointsCredited', true);
  return { credited: true, points: newPoints };
}

function adminConfirmPayment_(token, rowIndex, matchKey) {
  requireAdmin_(token);
  var orders = table_('Orders');
  var row = checkRow_(orders, rowIndex, matchKey);
  var order = rowToObj_(orders.headers, orders.rows[row - 2]);
  if (isCancelledStatus_(order.Status) || isCancelledStatus_(order.PaymentStatus)) throw new Error('Không thể xác nhận thanh toán cho đơn đã huỷ.');
  var method = String(order.PaymentMethod || '');
  if (method === 'Thanh toán trước') {
    if (!String(order.PaymentProofUrl || '')) throw new Error('Khách chưa gửi ảnh minh chứng thanh toán.');
    if (!/chờ xác nhận|đã thanh toán/i.test(String(order.PaymentStatus || ''))) throw new Error('Ảnh thanh toán chưa ở trạng thái chờ xác nhận.');
  } else if (method !== 'Thanh toán khi nhận hàng') {
    throw new Error('Đơn chưa có phương thức thanh toán hợp lệ.');
  }
  if (!isPaidStatus_(order.PaymentStatus)) {
    writeCell_(orders.sheet.getRange(row, orders.headers.indexOf('PaymentStatus') + 1), 'PaymentStatus', 'Đã thanh toán');
  }
  var credited = creditPointsForOrder_(orders, row, order);
  return { orderId: String(order.OrderID), points: credited.points, credited: credited.credited };
}

function paymentInfo_(token, orderId) {
  var ref = requireCustomerOrder_(token, orderId);
  var o = ref.found.obj;
  return {
    orderId: String(o.OrderID), total: Number(o.Total) || 0,
    paymentStatus: String(o.PaymentStatus || 'Chưa thanh toán'),
    paymentMethod: String(o.PaymentMethod || 'Thanh toán trước'),
    proofUrl: String(o.PaymentProofUrl || ''),
    qrUrl: String(cfg_('PAYMENT_QR_URL') || '')
  };
}

function paymentProofFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PAYMENT_PROOF_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var folder = DriveApp.createFolder('Brownies Lab - Payment Proofs');
  props.setProperty('PAYMENT_PROOF_FOLDER_ID', folder.getId());
  return folder;
}

function uploadPaymentProof_(token, orderId, filename, mimeType, base64) {
  var ref = requireCustomerOrder_(token, orderId);
  if (isCancelledStatus_(ref.found.obj.Status)) throw new Error('Không thể tải ảnh cho đơn đã huỷ.');
  if (String(ref.found.obj.PaymentMethod || '') !== 'Thanh toán trước') throw new Error('Đơn này thanh toán khi nhận hàng, không cần gửi minh chứng.');
  var allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.indexOf(String(mimeType || '').toLowerCase()) < 0) throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WEBP.');
  var bytes = Utilities.base64Decode(String(base64 || ''));
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Ảnh chuyển khoản phải nhỏ hơn 4 MB.');

  var safeName = String(filename || 'payment-proof').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  var blob = Utilities.newBlob(bytes, mimeType, String(ref.found.obj.OrderID) + '-' + safeName);
  var file = paymentProofFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = file.getUrl();
  writeCell_(ref.table.sheet.getRange(ref.found.row, ref.table.headers.indexOf('PaymentProofUrl') + 1), 'PaymentProofUrl', url);
  writeCell_(ref.table.sheet.getRange(ref.found.row, ref.table.headers.indexOf('PaymentStatus') + 1), 'PaymentStatus', 'Chờ xác nhận thanh toán');
  return { proofUrl: url, paymentStatus: 'Chờ xác nhận thanh toán' };
}

function myOrders_(token) {
  var user = requireUser_(token);
  var phone = normPhone_(user.obj.Phone);
  return table_('Orders').objects
    .filter(function (o) { return safePhone_(o.obj.Phone) === phone; })
    .map(function (o) {
      var items = [];
      try { items = JSON.parse(o.obj.ItemsJSON || '[]'); } catch (e) {}
      return {
        orderId: String(o.obj.OrderID),
        items: items,
        total: Number(o.obj.Total) || 0,
        pointsEarned: Number(o.obj.PointsEarned) || 0,
        pointsCredited: isTrue_(o.obj.PointsCredited),
        status: String(o.obj.Status || ''),
        paymentMethod: String(o.obj.PaymentMethod || 'Chưa chọn'),
        paymentStatus: String(o.obj.PaymentStatus || 'Chưa thanh toán'),
        canCancel: canCancelOrder_(o.obj.Status, o.obj.PaymentStatus, o.obj.PaymentMethod),
        canPay: canPayOrder_(o.obj.Status, o.obj.PaymentStatus, o.obj.PaymentMethod),
        createdAt: fmtDate_(o.obj.CreatedAt),
        note: String(o.obj.Note || '')
      };
    })
    .reverse(); // đơn mới nhất lên đầu
}

function myPoints_(token) {
  var u = requireUser_(token);
  return {
    points: Number(u.obj.Points) || 0,
    name: String(u.obj.Name || ''),
    isAdmin: isTrue_(u.obj.IsAdmin),
    rule: {
      pointsPerBox: cfg_('POINTS_PER_BOX'),
      signupBonus: cfg_('SIGNUP_BONUS'),
      freeBoxPoints: cfg_('FREE_BOX_POINTS')
    }
  };
}

// ===================== ADMIN (generic theo header) =====================
function adminSheet_(name) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS, name)) throw new Error('Bảng không hợp lệ: ' + name);
  return table_(name);
}

function adminListSheet_(token, sheet) {
  requireAdmin_(token);
  var t = adminSheet_(sheet);
  return {
    sheet: sheet,
    headers: t.headers,
    rows: t.rows.map(function (r, i) {
      return { rowIndex: i + 2, values: r.map(cellOut_) };
    })
  };
}

function adminAddRow_(token, sheet, data) {
  requireAdmin_(token);
  var t = adminSheet_(sheet);
  var obj = prepareAdminData_(t, sheet, data || {}, null);
  var row = appendObject_(t, obj);
  return { rowIndex: row };
}

function adminUpdateRow_(token, sheet, rowIndex, data, matchKey) {
  requireAdmin_(token);
  var t = adminSheet_(sheet);
  if (sheet === 'Orders' && ['PointsEarned', 'PointsCredited', 'PaymentMethod', 'PaymentStatus'].some(function (key) { return Object.prototype.hasOwnProperty.call(data || {}, key); })) {
    throw new Error('Dùng nút “Xác nhận TT & cộng điểm” để xác nhận thanh toán và cộng điểm.');
  }
  var row = checkRow_(t, rowIndex, matchKey);
  var current = rowToObj_(t.headers, t.rows[row - 2]);
  var obj = prepareAdminData_(t, sheet, data || {}, current);
  t.headers.forEach(function (h, i) {
    if (h === '' || !Object.prototype.hasOwnProperty.call(obj, h)) return;
    writeCell_(t.sheet.getRange(row, i + 1), h, obj[h]);
  });
  return { rowIndex: row };
}

function adminDeleteRow_(token, sheet, rowIndex, matchKey) {
  var admin = requireAdmin_(token);
  var t = adminSheet_(sheet);
  var row = checkRow_(t, rowIndex, matchKey);
  if (sheet === 'Users' && safePhone_(t.rows[row - 2][t.headers.indexOf('Phone')]) === normPhone_(admin.obj.Phone)) {
    throw new Error('Không thể tự xoá tài khoản admin đang đăng nhập.');
  }
  t.sheet.deleteRow(row);
  return { deleted: row };
}

/** Kiểm tra rowIndex còn trỏ đúng dòng (tránh sửa/xoá nhầm khi sheet đã thay đổi). */
function checkRow_(t, rowIndex, matchKey) {
  var row = Number(rowIndex);
  if (!(row >= 2 && row <= t.rows.length + 1 && Math.floor(row) === row)) throw new Error('Dòng không tồn tại.');
  if (matchKey !== undefined && matchKey !== null &&
      String(cellOut_(t.rows[row - 2][0])) !== String(matchKey)) {
    throw new Error('Dữ liệu đã thay đổi kể từ lần tải trước. Hãy tải lại bảng.');
  }
  return row;
}

/** Chỉ giữ các key là header thật; Users.PinHash nhập dạng 4–6 số thì tự hash thành PIN mới. */
function prepareAdminData_(t, sheet, data, current) {
  var obj = {};
  t.headers.forEach(function (h) {
    if (h !== '' && Object.prototype.hasOwnProperty.call(data, h)) obj[h] = data[h];
  });
  if (sheet === 'Users') {
    if (obj.Phone !== undefined) obj.Phone = normPhone_(obj.Phone);
    var phone = obj.Phone || (current && safePhone_(current.Phone));
    if (obj.PinHash !== undefined && /^\d{4,6}$/.test(String(obj.PinHash))) {
      if (!phone) throw new Error('Cần có Phone để đặt PIN.');
      obj.PinHash = hashPin_(phone, obj.PinHash);
    } else if (current && obj.Phone && obj.Phone !== safePhone_(current.Phone) && obj.PinHash === current.PinHash) {
      throw new Error('PIN được hash theo SĐT: khi đổi Phone, hãy nhập PIN mới (4–6 số) vào ô PinHash.');
    }
  }
  return obj;
}

// ===================== TIỆN ÍCH SHEET =====================
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }

/** Đọc cả bảng: header lấy từ dòng 1 nên có thể đổi thứ tự / thêm cột mà không sửa code. */
function table_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Không tìm thấy tab "' + name + '". Hãy chạy hàm setup().');
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var lastRow = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  // Bỏ các dòng trống hoàn toàn ở cuối
  while (rows.length && rows[rows.length - 1].every(function (c) { return c === ''; })) rows.pop();
  return {
    sheet: sheet, headers: headers, rows: rows,
    objects: rows.map(function (r, i) { return { row: i + 2, obj: rowToObj_(headers, r) }; })
  };
}

function rowToObj_(headers, r) {
  var o = {};
  headers.forEach(function (h, i) { if (h) o[h] = r[i]; });
  return o;
}

function findRow_(t, col, value, normalizer) {
  for (var i = 0; i < t.objects.length; i++) {
    var v = t.objects[i].obj[col];
    var cmp;
    try { cmp = normalizer ? normalizer(v) : String(v); } catch (e) { continue; }
    if (cmp === value) return t.objects[i];
  }
  return null;
}

function appendObject_(t, obj) {
  var row = t.rows.length + 2;
  var formats = [], values = [];
  t.headers.forEach(function (h) {
    var has = h && Object.prototype.hasOwnProperty.call(obj, h);
    var isText = TEXT_COLUMNS.indexOf(h) >= 0;
    var v = has ? obj[h] : '';
    v = isText ? (v === null || v === undefined ? '' : String(v)) : coerce_(v);
    formats.push(isText ? '@' : v instanceof Date ? 'yyyy-mm-dd hh:mm' : 'General');
    values.push(v);
  });
  // Ghi cả dòng trong 2 lệnh thay vì từng ô cho nhanh
  var range = t.sheet.getRange(row, 1, 1, t.headers.length);
  range.setNumberFormats([formats]).setValues([values]);
  t.rows.push(values);
  return row;
}

function writeCell_(range, header, value) {
  if (TEXT_COLUMNS.indexOf(header) >= 0) {
    range.setNumberFormat('@').setValue(value === null || value === undefined ? '' : String(value));
  } else {
    var v = coerce_(value);
    if (v instanceof Date) range.setNumberFormat('yyyy-mm-dd hh:mm');
    range.setValue(v);
  }
}

/** Giá trị admin gửi lên là chuỗi: đổi TRUE/FALSE, số, ngày ISO về đúng kiểu. */
function coerce_(v) {
  if (typeof v !== 'string') return v;
  var s = v.trim();
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) {
    var d = new Date(s.replace(' ', 'T'));
    if (!isNaN(d)) return d;
  }
  return v;
}

function cellOut_(v) {
  if (v instanceof Date) return fmtDate_(v);
  return v;
}

function fmtDate_(v) {
  var d = toDate_(v);
  return d ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm') : String(v || '');
}

function toDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  var d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

function isTrue_(v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; }
function safePhone_(v) { try { return normPhone_(v); } catch (e) { return ''; } }

// ===================== CÀI ĐẶT BAN ĐẦU =====================
/** Chạy tay một lần trong trình soạn Apps Script. Không đụng tới các tab khác (Đợt, Tổng hợp...). */
function setup() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SHEETS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    var actual = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    actual.forEach(function (h, i) {
      if (TEXT_COLUMNS.indexOf(h) >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
    var missing = headers.filter(function (h) { return actual.indexOf(h) < 0; });
    if (missing.length) {
      var first = actual.length + 1;
      sh.getRange(1, first, 1, missing.length).setValues([missing]).setFontWeight('bold');
      missing.forEach(function (h, i) {
        if (TEXT_COLUMNS.indexOf(h) >= 0) sh.getRange(2, first + i, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
      Logger.log('Đã thêm cột vào tab ' + name + ': ' + missing.join(', '));
    }
  });

  var menu = ss.getSheetByName('Menu');
  if (menu.getLastRow() === 1) {
    var t = table_('Menu');
    [
      { ItemID: 'FUDGE', Name: 'Brownie Fudge cổ điển', Price: 35000, Description: 'Dark chocolate 70%, mặt bánh nứt giòn, ruột ẩm dẻo.', Active: true },
      { ItemID: 'SALTCARA', Name: 'Brownie Caramel muối', Price: 42000, Description: 'Sốt caramel nấu tay, rắc muối biển.', Active: true },
      { ItemID: 'WALNUT', Name: 'Brownie Óc chó', Price: 40000, Description: 'Óc chó rang bơ, vị bùi.', Active: true },
      { ItemID: 'BOX6', Name: 'Hộp mix 6 miếng', Price: 220000, Description: '2 Fudge, 2 Caramel muối, 2 Óc chó.', Active: true }
    ].forEach(function (o) { appendObject_(t, o); });
  }
  Logger.log('Xong. Timezone của Sheet: ' + ss.getSpreadsheetTimeZone());
}
