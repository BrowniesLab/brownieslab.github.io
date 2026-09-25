-- Tạo lại sức chứa từ mọi đơn chưa huỷ đang có. Có thể chạy lại an toàn:
-- bảng được tính lại từ Orders, không cộng dồn lần hai.
CREATE TABLE IF NOT EXISTS pickup_batches (
  pickup_date TEXT PRIMARY KEY,
  boxes_reserved INTEGER NOT NULL DEFAULT 0
);

DELETE FROM pickup_batches;

INSERT INTO pickup_batches (pickup_date, boxes_reserved)
SELECT o.pickup_date,
       SUM(CAST(json_extract(item.value, '$.qty') AS INTEGER))
FROM orders AS o
JOIN json_each(o.items_json) AS item
WHERE o.pickup_date <> ''
  AND LOWER(o.status) NOT LIKE '%huỷ%'
  AND LOWER(o.status) NOT LIKE '%hủy%'
  AND LOWER(o.status) NOT LIKE '%cancel%'
GROUP BY o.pickup_date;
