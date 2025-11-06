import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve("logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export const log = (message) => {
  const time = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
  const logMessage = `[${time}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(path.join(LOG_DIR, "server.log"), logMessage + "\n", "utf8");
};

export const requestLogger = (req, res, next) => {
  const time = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
  const msg = `[${time}] ${req.method} ${req.originalUrl}`;
  console.log(msg);
  fs.appendFileSync(path.join(LOG_DIR, "server.log"), msg + "\n", "utf8");
  next();
};

export const errorLogger = (err) => {
  const time = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
  const logMessage = `[${time}] [ERROR] ${err.message}\n${err.stack || ""}`;
  console.error(logMessage);
  fs.appendFileSync(path.join(LOG_DIR, "server.log"), logMessage + "\n", "utf8");
};
