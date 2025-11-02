export const log = (message) => {
  const time = new Date().toISOString();
  console.log(`[${time}] ${message}`);
};
// logger.js
import fs from "fs";
import path from "path";

/**
 * Middleware ghi log mỗi request gửi đến server.
 * Lưu log vào logs/access.log và in ra console.
 */
export const logger = (req, res, next) => {
  try {
    // Tạo thư mục logs nếu chưa có
    const logDir = path.resolve("logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    // Lấy timestamp (Asia/Bangkok)
    const time = new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok",
    });

    // Ghi nội dung log
    const logMessage = `[${time}] ${req.method} ${req.originalUrl}\n`;

    // Ghi ra console
    console.log(logMessage.trim());

    // Ghi vào file access.log
    fs.appendFileSync(path.join(logDir, "access.log"), logMessage);

    next(); // chuyển sang middleware hoặc route tiếp theo
  } catch (err) {
    console.error("Logger error:", err.message);
    next(); // không chặn request nếu ghi log lỗi
  }
};
