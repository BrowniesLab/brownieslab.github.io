-- Brownies Lab — schema D1 (Cloudflare Worker)
-- Chạy: wrangler d1 execute brownies-lab-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  social_link TEXT NOT NULL DEFAULT '',
  -- 0 = SĐT này còn được phép "đăng ký lại" 1 lần để tự đặt PIN mới (dùng khi migrate dữ liệu
  -- cũ, PIN cũ không dùng được nữa). Set về 1 ngay sau lần đăng ký/đăng ký-lại đầu tiên.
  claim_used INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  total INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  points_credited INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Mới',
  created_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  recipient_message TEXT NOT NULL DEFAULT '',
  fulfillment_type TEXT NOT NULL DEFAULT '',
  pickup_location TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  pickup_date TEXT NOT NULL DEFAULT '',
  pickup_time TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  payment_proof_url TEXT NOT NULL DEFAULT '',
  -- Ảnh minh chứng thanh toán lưu thẳng trong D1 (base64), không phụ thuộc dịch vụ ngoài.
  payment_proof_mime TEXT NOT NULL DEFAULT '',
  payment_proof_data TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  redemption_id TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  points_spent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Yêu cầu mới',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redemptions_phone ON redemptions(phone);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Đếm số lần sai PIN liên tiếp, thay cho CacheService của Apps Script.
CREATE TABLE IF NOT EXISTS login_attempts (
  phone TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

-- 4 món mẫu, giống hàm setup() của Code.gs. Sửa/xoá/thêm lại qua trang admin sau khi deploy.
INSERT OR IGNORE INTO menu (item_id, name, price, description, active) VALUES
  ('FUDGE',    'Brownie Fudge cổ điển', 35000,  'Dark chocolate 70%, mặt bánh nứt giòn, ruột ẩm dẻo.', 1),
  ('SALTCARA', 'Brownie Caramel muối',  42000,  'Sốt caramel nấu tay, rắc muối biển.', 1),
  ('WALNUT',   'Brownie Óc chó',        40000,  'Óc chó rang bơ, vị bùi.', 1),
  ('BOX6',     'Hộp mix 6 miếng',       220000, '2 Fudge, 2 Caramel muối, 2 Óc chó.', 1);
