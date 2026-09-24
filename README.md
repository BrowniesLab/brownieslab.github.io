# Brownies Lab

Web nội bộ để khách đặt brownie theo đợt và tích điểm, thay cho Google Form.

- **Frontend:** HTML/CSS/JS thuần, host miễn phí trên GitHub Pages.
- **Backend hiện tại:** Cloudflare Worker + D1; xem hướng dẫn deploy tại [`worker/README.md`](worker/README.md).
- **Backend cũ:** `Code.gs` (Google Apps Script + Google Sheet), giữ lại để tham khảo hoặc chuyển dữ liệu.
- **Chi phí:** 0đ. Không dùng SMS OTP, Firebase hay dịch vụ trả phí nào.

```
worker/      backend Cloudflare Worker + schema D1
Code.gs      backend Apps Script cũ, dùng khi chưa chuyển sang Cloudflare
index.html   đăng nhập / đăng ký
order.html   đặt bánh, điểm thưởng, lịch sử đơn
checkout.html nhập thông tin người nhận, giao/nhận và thời gian nhận bánh
payment.html QR thanh toán và tải ảnh chuyển khoản
admin.html   xem / sửa / thêm / xoá trên 4 bảng (tự sinh theo header)
style.css    giao diện dùng chung
app.js       gọi API + lưu phiên đăng nhập (localStorage)
```

---

## Bước 1 — Tạo Google Sheet đúng schema

1. Mở Google Sheet đang dùng (có thể là file chứa sẵn các sheet "Đợt", "Tổng hợp") hoặc tạo file mới.
2. Tạo 4 tab với **đúng tên** và **dòng 1 là header đúng như sau**:

| Tab        | Header (dòng 1, mỗi ô một cột)                                                              |
|------------|---------------------------------------------------------------------------------------------|
| `Users`    | Phone · Name · PinHash · Points · IsAdmin · CreatedAt · SocialLink                           |
| `Menu`     | ItemID · Name · Price · Description · Active                                                 |
| `Orders`   | OrderID · Phone · CustomerName · ItemsJSON · Total · PointsEarned · PointsCredited · Status · CreatedAt · Note · RecipientName · RecipientPhone · RecipientMessage · FulfillmentType · PickupLocation · DeliveryAddress · PickupDate · PickupTime · PaymentMethod · PaymentStatus · PaymentProofUrl |
| `Sessions` | Token · Phone · ExpiresAt                                                                    |

> **Làm nhanh:** không cần tạo tay. Sau Bước 2, chạy hàm `setup()` để script tự tạo 4 tab, header,
> định dạng cột dạng chữ (giữ số 0 đầu SĐT) và 4 món mẫu trong Menu. `setup()` **không đụng** tới các tab khác.

Lưu ý:
- Các cột `Phone`, `Token`, `PinHash`, `OrderID`, `ItemID` phải định dạng **Plain text**
  (Format → Number → Plain text), nếu không Sheets sẽ cắt mất số 0 đầu số điện thoại.
- `Active`, `IsAdmin` dùng ô TRUE/FALSE (có thể chèn checkbox: Insert → Checkbox).
- `Price` là số nguyên, đơn vị đồng (vd. `35000`).
- Có thể đổi thứ tự cột hoặc thêm cột mới: code đọc theo tên header, không đọc theo vị trí.
- Nên đặt múi giờ file: File → Settings → Time zone → `(GMT+07:00) Bangkok/Hanoi/Jakarta`.

## Bước 2 — Dán backend vào Apps Script

1. Trong Google Sheet: **Extensions → Apps Script**.
2. Xoá nội dung `Code.gs` mặc định, dán toàn bộ file [`Code.gs`](Code.gs) của repo này, bấm **Save**.
3. **Đổi salt của PIN** trước khi có người dùng thật (đổi sau khi đã có khách thì PIN cũ sẽ không đăng nhập được nữa):
   Project Settings (bánh răng) → **Script Properties** → Add property
   `PIN_SALT` = một chuỗi ngẫu nhiên dài bất kỳ.
4. Chọn hàm `setup` trên thanh công cụ → **Run** → cấp quyền khi được hỏi
   (Google sẽ cảnh báo "unverified app" vì script của chính bạn: Advanced → Go to … (unsafe) → Allow).

### Chỉnh công thức điểm (không cần sửa code)

Trong **Script Properties**, thêm hoặc sửa các khoá sau (không có thì dùng giá trị mặc định):

| Khoá               | Mặc định | Ý nghĩa                                                   |
|--------------------|----------|-----------------------------------------------------------|
| `POINTS_PER_BOX`   | 1        | Mỗi hộp bánh được bấy nhiêu điểm                           |
| `SIGNUP_BONUS`    | 2        | Điểm tặng ngay khi tạo tài khoản mới                       |
| `FREE_BOX_POINTS`  | 10       | Số điểm cần để đổi một hộp bánh miễn phí                   |
| `PAYMENT_QR_URL`   | *(trống)*| Link công khai tới ảnh QR nhận thanh toán                  |
| `SESSION_DAYS`     | 30       | Số ngày token đăng nhập còn hiệu lực                     |
| `MAX_LOGIN_FAILS`  | 5        | Sai PIN quá số lần này thì tạm khoá SĐT đó                |
| `LOCK_MINUTES`     | 15       | Thời gian khoá tạm                                       |
| `NEW_ORDER_STATUS` | Mới      | Trạng thái gán cho đơn mới                                |

Điểm được ghi ở đơn dưới dạng **chờ cộng** khi tạo đơn, chưa vào tài khoản khách. Admin chỉ bấm **“Xác nhận TT & cộng điểm”** sau khi đã tự kiểm tra thanh toán: đơn trả trước phải có ảnh minh chứng, còn đơn thanh toán khi nhận hàng chỉ bấm sau khi giao/nhận tiền. Mỗi đơn chỉ cộng một lần (`PointsCredited = TRUE`).

Để bật trang thanh toán, thêm `PAYMENT_QR_URL` trong Script Properties với link công khai tới ảnh QR. Khi khách tải ảnh chuyển khoản, script sẽ tự tạo thư mục `Brownies Lab - Payment Proofs` trong Drive và lưu link ảnh vào `Orders.PaymentProofUrl`.

## Bước 3 — Deploy Web App

1. Trong Apps Script: **Deploy → New deployment**.
2. Bánh răng cạnh "Select type" → **Web app**.
3. Cấu hình:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. **Deploy** → copy **Web app URL**, dạng `https://script.google.com/macros/s/AKfy…/exec`.
5. Kiểm tra: mở `URL/exec?action=getMenu` trên trình duyệt, phải thấy `{"ok":true,"data":[…]}`.

> **Mỗi lần sửa `Code.gs`:** Deploy → **Manage deployments** → biểu tượng bút → Version: **New version** → Deploy.
> Làm vậy thì URL giữ nguyên. Nếu chọn "New deployment" thì sẽ ra URL mới và phải cập nhật lại `app.js`.

## Bước 4 — Gắn URL vào frontend

Mở [`app.js`](app.js), sửa dòng đầu:

```js
const API_URL = 'https://script.google.com/macros/s/AKfy…/exec';
```

Frontend gọi API bằng `fetch` với `Content-Type: text/plain`. Đây là "simple request" nên trình duyệt
không gửi preflight `OPTIONS`, vì Apps Script không xử lý được `OPTIONS`/CORS. **Đừng** đổi sang
`application/json`.

## Bước 5 — Đẩy code lên GitHub và bật GitHub Pages

Repo này dùng lại repo GitHub cũ `ComputerNetwork-Web_Interview_Recorder`, đổi tên thành `brownies-lab`:

1. Trên GitHub, mở repo cũ → **Settings → General → Repository name** → đổi thành `brownies-lab` → **Rename**.
2. Trên máy, trỏ remote sang tên mới (GitHub vẫn tự chuyển hướng tên cũ, nhưng nên sửa cho rõ):
   ```bash
   git remote set-url origin https://github.com/NguyenKhanh31/brownies-lab.git
   git push origin main
   git push origin --tags   # đẩy tag lưu code Interview Recorder cũ
   ```
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, thư mục `/ (root)` → **Save**.
4. Khoảng 1–2 phút sau, web chạy tại `https://nguyenkhanh31.github.io/brownies-lab/`.

## Bước 6 — Tạo tài khoản admin

1. Mở web, **Tạo tài khoản** bằng số điện thoại của bạn.
2. Trong Google Sheet, tab `Users`, sửa ô `IsAdmin` của dòng đó thành `TRUE`.
3. Đăng xuất rồi đăng nhập lại. Link **Quản trị** sẽ hiện trên thanh trên cùng (hoặc vào thẳng `/admin.html`).

---

## Trang admin

- 4 tab: Đơn hàng, Khách hàng, Menu, Phiên đăng nhập. Bảng và form sửa được **tự sinh theo header** của sheet,
  thêm cột mới vào Sheet thì admin tự có cột đó.
- Bấm vào một dòng để sửa hoặc xoá. Khi lưu, chỉ các ô đã thay đổi được gửi lên.
- **Đặt lại PIN cho khách:** gõ PIN mới (4–6 số) vào ô `PinHash`, hệ thống tự hash.
- Đúng/sai nhập `TRUE`/`FALSE`, ngày nhập `yyyy-mm-dd hh:mm`.
- Trong tab **Đơn hàng**, mỗi đơn là một thẻ; bấm thẻ để xem chi tiết. Với thanh toán trước, chỉ khi khách đã tải ảnh minh chứng thì nút **Xác nhận TT & cộng điểm** mới hiện. Với COD, chỉ bấm nút đó sau khi đã giao bánh và nhận tiền.
- Trước khi sửa/xoá, server kiểm tra lại ô đầu tiên của dòng. Nếu sheet đã bị đổi (có người xoá/chèn dòng) thì
  thao tác bị từ chối và yêu cầu tải lại, để tránh sửa nhầm dòng.
- Xoá dòng trong tab Phiên đăng nhập sẽ buộc thiết bị đó đăng xuất.

## API

`POST` tới URL `/exec`, body là JSON (gửi dạng text/plain): `{"action": "...", ...}`.
Kết quả luôn là `{"ok": true, "data": …}` hoặc `{"ok": false, "error": "…"}`.

| Action           | Tham số                              | Trả về                                             |
|------------------|--------------------------------------|----------------------------------------------------|
| `register`       | phone, name, pin                     | `{token, name, phone, points, isAdmin, expiresAt}` |
| `login`          | phone, pin                           | như trên                                           |
| `logout`         | token                                | `{loggedOut}`                                      |
| `getMenu`        | (**GET** `?action=getMenu`)          | các món có `Active = TRUE`                         |
| `createOrder`    | token, items `[{itemId, qty}]`, checkout | `{orderId, total, pointsEarned, points}`        |
| `cancelOrder`    | token, orderId                       | Huỷ đơn còn mới/chờ thanh toán và hoàn tác điểm    |
| `paymentInfo`    | token, orderId                       | Thông tin QR, tổng tiền và trạng thái thanh toán    |
| `uploadPaymentProof` | token, orderId, filename, mimeType, base64 | Lưu ảnh chuyển khoản vào Drive               |
| `myOrders`       | token                                | đơn của khách, mới nhất trước                      |
| `myPoints`       | token                                | `{points, name, isAdmin, rule}`                    |
| `adminListSheet` | token, sheet                         | `{headers, rows: [{rowIndex, values}]}`            |
| `adminAddRow`    | token, sheet, data `{Header: value}` | `{rowIndex}`                                       |
| `adminUpdateRow` | token, sheet, rowIndex, data, matchKey? | `{rowIndex}`                                    |
| `adminDeleteRow` | token, sheet, rowIndex, matchKey?    | `{deleted}`                                        |

`rowIndex` là số dòng thật trong Sheet (dòng 2 là dòng dữ liệu đầu tiên). Giá bánh luôn lấy từ tab Menu
phía server, client không gửi giá.

## Về bảo mật

Đây là mức bảo vệ **vừa đủ cho web nội bộ**, không phải hệ thống bảo mật cao:

- PIN không lưu dạng gốc, chỉ lưu SHA-256 của `salt | SĐT | PIN`.
- Sai PIN 5 lần thì SĐT đó bị khoá 15 phút, để chống dò PIN 4 số.
- Ai biết SĐT và PIN của khách thì đặt đơn thay được. Chấp nhận được vì không có thanh toán online.
- Admin nhìn thấy mọi dữ liệu, kể cả token phiên. Chỉ cấp `IsAdmin` cho người tin cậy.
- Quota miễn phí của Apps Script (tài khoản Gmail thường) dư sức cho vài trăm đơn mỗi ngày.

## Tích hợp với sheet "Đợt" / "Tổng hợp"

`Code.gs` có sẵn hàm `onOrderCreated_(order, lines)`, được gọi sau mỗi đơn mới. Hàm này hiện
**chưa làm gì**; sẽ được viết khi đã thống nhất cấu trúc các sheet Đợt/Tổng hợp. Các sheet này hiện
không bị đọc hay sửa.

## Code cũ (Interview Recorder)

Repo này trước đây là project *ComputerNetwork-Web_Interview_Recorder*. Code cũ vẫn còn nguyên trong
lịch sử git:

- tag `interview-recorder-main`, tag `interview-recorder-develop`, và các nhánh `develop`, `feature/*`.
- Xem lại: `git checkout interview-recorder-main`.
