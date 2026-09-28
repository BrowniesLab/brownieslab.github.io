# Brownies Lab — backend Cloudflare Worker (thay thế Apps Script)

Backend tương đương `Code.gs`, nhưng dùng D1 (SQL) làm database và lưu ảnh minh chứng
chuyển khoản trong D1, thay cho Google Sheet + Drive. Giữ nguyên toàn bộ tên action và hình dạng dữ liệu
trả về, nên `app.js`/`admin.html`/`payment.html`... **không cần sửa gì**, chỉ đổi `API_URL`.

## ⚠️ Trước khi chuyển hẳn

Đây là **database trống**. `schema.sql` chỉ tạo bảng + 4 món mẫu, **không** copy khách hàng,
điểm thưởng, lịch sử đơn hàng đang có trong Google Sheet. Nếu đã có khách thật đăng ký/đặt đơn,
cần tự export dữ liệu từ Sheet rồi viết câu `INSERT` nạp vào D1 trước khi đổi `API_URL` trên
production — nếu không, khách cũ sẽ mất tài khoản/điểm khi đăng nhập lại. Có thể deploy Worker
song song để test trước (không đổi `API_URL` thật) rồi mới chuyển hẳn.

## Cấu trúc

```
worker/
  schema.sql      Tạo 5 bảng D1 (users, menu, orders, sessions, login_attempts) + món mẫu
  wrangler.toml   Config Worker, binding D1 (DB), các biến điểm thưởng
  src/index.js    Toàn bộ backend
```

## Deploy lần đầu

```bash
cd worker

# 1. Cài wrangler, đăng nhập Cloudflare
npm install -g wrangler
wrangler login

# 2. Tạo D1 database -> copy database_id trả về vào wrangler.toml
wrangler d1 create brownies-lab-db

# 3. Tạo bảng
wrangler d1 execute brownies-lab-db --file=schema.sql

# 4. Đặt secret PIN_SALT (chuỗi ngẫu nhiên dài, đổi trước khi có người dùng thật)
wrangler secret put PIN_SALT
# ví dụ tạo chuỗi ngẫu nhiên: openssl rand -hex 32

# 5. Deploy
wrangler deploy
```

Sau khi deploy, wrangler in ra URL dạng `https://brownies-lab.<subdomain>.workers.dev`.

## Sau khi deploy

Trong `app.js`, đổi:
```js
const API_URL = 'https://brownies-lab.<subdomain>.workers.dev';
```
Kiểm tra: mở `API_URL?action=getMenu` trên trình duyệt, phải thấy `{"ok":true,"data":[...]}`.

Tạo tài khoản admin: đăng ký tài khoản trên web như bình thường, rồi:
```bash
wrangler d1 execute brownies-lab-db --command "UPDATE users SET is_admin = 1 WHERE phone = '0xxxxxxxxx'"
```
(thay cho việc sửa ô `IsAdmin` trên Google Sheet). Đăng xuất/đăng nhập lại để có quyền admin.

## Sau này mỗi lần sửa code

```bash
wrangler deploy
```
URL giữ nguyên, không cần sửa lại `app.js`.

## Đổi công thức điểm / QR thanh toán (không cần sửa code)

Sửa trực tiếp mục `[vars]` trong `wrangler.toml` (POINTS_PER_BOX, SIGNUP_BONUS, FREE_BOX_POINTS,
SESSION_DAYS, MAX_LOGIN_FAILS, LOCK_MINUTES, NEW_ORDER_STATUS, PAYMENT_QR_URL) rồi `wrangler deploy` lại.

## SePay — cổng thanh toán tự động

Khách quét QR chuyển khoản, SePay theo dõi tài khoản MB và gọi webhook về Worker ngay khi có
tiền vào — hệ thống tự đổi `PaymentStatus` thành "Đã thanh toán" và cộng điểm, không cần admin
bấm gì. Nút "Xác nhận TT & cộng điểm" ở `/admin.html` vẫn giữ làm phương án dự phòng nếu webhook
lỗi/trễ, hoặc khách chuyển thiếu tiền.

**Cấu hình:**
- `[vars]` trong `wrangler.toml`: `BANK_ACCOUNT` (số tài khoản MB), `BANK_CODE` (mặc định `MBBank`),
  `PAYMENT_PREFIX` (tiền tố mã đơn, phải khớp đúng tiền tố đã cấu hình trên dashboard SePay).
- Secret: `wrangler secret put SEPAY_API_KEY` — chuỗi bạn **tự đặt** khi tạo webhook trên
  my.sepay.vn (mục Tích hợp → Webhooks → Thêm webhook → bước Bảo mật → chọn "API Key"),
  KHÔNG phải SePay tự sinh ra.

**Tạo webhook trên my.sepay.vn** (my.sepay.vn/webhooks → Thêm webhook):
1. URL: `https://brownies-lab.brownieslab.workers.dev/sepay-webhook`
2. Loại sự kiện: "Tiền vào"
3. Chọn tài khoản MB, cấu hình tiền tố mã đơn (khớp `PAYMENT_PREFIX`)
4. Bảo mật: chọn "API Key", tự đặt 1 chuỗi ngẫu nhiên (`openssl rand -hex 32`), dán vào cả đây
   và vào secret `SEPAY_API_KEY` ở trên

**Cách khớp đơn:** mỗi đơn thanh toán trước có mã riêng `<PAYMENT_PREFIX><id nội bộ>` (vd `DH83`),
nhúng sẵn vào link QR (`https://qr.sepay.vn/img?acc=...&amount=...&des=DH83`) nên khách quét QR là
ngân hàng tự điền đúng số tiền + nội dung, không cần gõ tay.

**Chống trùng:** bảng `sepay_transactions` lưu `id` giao dịch phía SePay làm khoá chính — webhook
gửi lại (SePay tự động thử lại khi lỗi) sẽ bị bỏ qua, không cộng điểm 2 lần.

**Chuyển thiếu tiền:** nếu `transferAmount` nhỏ hơn tổng đơn, đơn được đánh dấu "Chuyển thiếu tiền
— cần xử lý tay" thay vì "Đã thanh toán" — admin xử lý thủ công qua `/admin.html`.

## Khác biệt so với bản Apps Script

| | Apps Script (`Code.gs`) | Worker (`worker/src/index.js`) |
|---|---|---|
| Database | Google Sheet | D1 (SQLite) |
| Ảnh minh chứng thanh toán | Google Drive, base64 trong JSON | Lưu base64 thẳng trong D1 (không đổi `payment.html`), phục vụ lại qua `GET /proof/<orderId>` |
| Khoá sai PIN nhiều lần | `CacheService` | bảng `login_attempts` |
| Phiên đăng nhập | `CacheService`/tab `Sessions` | bảng `sessions` |
| Sửa dữ liệu trực tiếp | Mở Google Sheet, sửa ô | Phải qua trang `/admin.html` hoặc lệnh `wrangler d1 execute` |
| Chi phí | 0đ | 0đ trong hạn miễn phí D1 (dư sức dùng nội bộ) |
