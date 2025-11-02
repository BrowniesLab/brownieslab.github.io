export const errorHandler = (err, req, res, next) => {
  console.error("❌ Error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
};
// errorHandler.js
import fs from "fs";
import path from "path";

/**
 * Middleware xử lý lỗi tập trung cho toàn bộ server.
 * Ghi log lỗi vào logs/error.log và trả JSON thống nhất cho client.
 */
export const errorHandler = (err, req, res, next) => {
  // Thư mục logs
  const logDir = path.resolve("logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

  // Tạo timestamp theo múi giờ Bangkok
  const time = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
  });

  // Chuẩn bị thông tin lỗi
  const logMessage = `[${time}] ${req.method} ${req.originalUrl} → ${err.message}\n`;

  // Ghi log ra console và file
  console.error(logMessage.trim());
  fs.appendFileSync(path.join(logDir, "error.log"), logMessage);

  // Phản hồi JSON cho client
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || "Internal Server Error",
  });
};
