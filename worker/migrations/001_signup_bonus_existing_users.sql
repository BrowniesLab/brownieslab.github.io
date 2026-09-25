-- Bù 2 điểm cho toàn bộ tài khoản đã có trước khi tính năng quà đăng ký được thêm.
-- An toàn khi chạy lại: bảng nhật ký chỉ giữ một dòng mỗi SĐT. Ba thao tác ở
-- Wrangler chạy cả file theo một transaction; nếu lỗi, D1 hoàn tác toàn bộ file nên có thể chạy lại an toàn.

CREATE TABLE IF NOT EXISTS signup_bonus_credits (
  phone TEXT PRIMARY KEY,
  points INTEGER NOT NULL,
  credited_at TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 1
);


-- Chỉ chọn tài khoản có số dư bằng chính điểm từ đơn đã cộng, trừ điểm đã đổi.
-- Nếu số dư đã cao hơn 2 điểm (quà đăng ký), SĐT đó không được chọn.
INSERT OR IGNORE INTO signup_bonus_credits (phone, points, credited_at, applied)
SELECT u.phone, 2, CURRENT_TIMESTAMP, 0
FROM users AS u
WHERE u.points = (
  COALESCE((
    SELECT SUM(o.points_earned)
    FROM orders AS o
    WHERE o.phone = u.phone
      AND o.points_credited = 1
      AND LOWER(o.status) NOT LIKE '%huỷ%'
      AND LOWER(o.status) NOT LIKE '%hủy%'
      AND LOWER(o.status) NOT LIKE '%cancel%'
  ), 0)
  - COALESCE((
    SELECT SUM(r.points_spent)
    FROM redemptions AS r
    WHERE r.phone = u.phone
  ), 0)
);

-- applied = 0 chỉ tồn tại trong đúng lần bù điểm đầu tiên của SĐT đó.
UPDATE users
SET points = points + 2
WHERE phone IN (
  SELECT phone FROM signup_bonus_credits WHERE applied = 0
);

UPDATE signup_bonus_credits
SET applied = 1
WHERE applied = 0;

-- Đánh dấu luôn các tài khoản mà số dư đã thể hiện quà đăng ký +2.
-- Các số dư được admin chỉnh tay nhưng không khớp công thức sẽ không bị tự ý sửa.
INSERT OR IGNORE INTO signup_bonus_credits (phone, points, credited_at, applied)
SELECT u.phone, 2, CURRENT_TIMESTAMP, 1
FROM users AS u
WHERE u.points = (
  COALESCE((
    SELECT SUM(o.points_earned)
    FROM orders AS o
    WHERE o.phone = u.phone
      AND o.points_credited = 1
      AND LOWER(o.status) NOT LIKE '%huỷ%'
      AND LOWER(o.status) NOT LIKE '%hủy%'
      AND LOWER(o.status) NOT LIKE '%cancel%'
  ), 0)
  - COALESCE((
    SELECT SUM(r.points_spent)
    FROM redemptions AS r
    WHERE r.phone = u.phone
  ), 0)
  + 2
);

