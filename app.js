/* Brownies Lab — dùng chung cho mọi trang: gọi API + quản lý phiên đăng nhập */

// Dán URL Web App (kết thúc bằng /exec) sau khi deploy Apps Script
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';

const SESSION_KEY = 'brownieslab.session';

const Session = {
  get() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.token) return null;
      if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) { Session.clear(); return null; }
      return s;
    } catch (e) { return null; }
  },
  set(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); },
  update(patch) { const s = Session.get(); if (s) Session.set({ ...s, ...patch }); },
  clear() { localStorage.removeItem(SESSION_KEY); }
};

class ApiError extends Error {
  constructor(message, isAuth) { super(message); this.isAuth = isAuth; }
}

function assertConfigured() {
  if (API_URL.startsWith('PASTE_')) {
    throw new ApiError('Chưa cấu hình API_URL trong app.js (xem README).');
  }
}

async function parseResponse(res) {
  if (!res.ok) throw new ApiError('Máy chủ lỗi (' + res.status + '). Thử lại sau.');
  let json;
  try { json = await res.json(); }
  catch (e) { throw new ApiError('Phản hồi không hợp lệ. Kiểm tra lại quyền truy cập của Web App.'); }
  if (!json.ok) {
    const msg = String(json.error || 'Lỗi không xác định');
    const isAuth = msg.startsWith('AUTH:');
    if (isAuth) Session.clear();
    throw new ApiError(msg.replace(/^AUTH:\s*/, ''), isAuth);
  }
  return json.data;
}

/**
 * Gọi action qua doPost. Content-Type text/plain để là "simple request",
 * trình duyệt không gửi preflight OPTIONS (Apps Script không xử lý được OPTIONS).
 */
async function api(action, payload = {}) {
  assertConfigured();
  const s = Session.get();
  const body = { action, ...payload };
  if (s && body.token === undefined) body.token = s.token;
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
  } catch (e) {
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng.');
  }
  return parseResponse(res);
}

async function apiGet(action) {
  assertConfigured();
  let res;
  try { res = await fetch(API_URL + '?action=' + encodeURIComponent(action)); }
  catch (e) { throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng.'); }
  return parseResponse(res);
}

/** Chuyển về trang đăng nhập nếu chưa có phiên. */
function requireSession({ admin = false } = {}) {
  const s = Session.get();
  if (!s || (admin && !s.isAdmin)) {
    location.replace('index.html');
    return null;
  }
  return s;
}

/** Nếu lỗi là lỗi phiên thì quay về đăng nhập, ngược lại hiện thông báo. */
function handleError(err) {
  if (err && err.isAuth) {
    toast(err.message, 'error');
    setTimeout(() => location.replace('index.html'), 1200);
    return;
  }
  toast(err && err.message ? err.message : String(err), 'error');
}

async function logout() {
  const s = Session.get();
  Session.clear();
  if (s) { try { await api('logout', { token: s.token }); } catch (e) { /* bỏ qua */ } }
  location.replace('index.html');
}

// ---------- tiện ích giao diện ----------
const vnd = new Intl.NumberFormat('vi-VN');
function formatVND(n) { return vnd.format(Number(n) || 0) + 'đ'; }

function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(message, type = 'info') {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = 'toast show toast-' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { box.className = 'toast toast-' + type; }, 3200);
}

/** Khoá nút trong lúc chờ API để tránh bấm 2 lần (ví dụ gửi đơn trùng). */
async function withBusy(button, fn, busyText = 'Đang xử lý…') {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try { return await fn(); }
  finally { button.disabled = false; button.textContent = label; }
}
