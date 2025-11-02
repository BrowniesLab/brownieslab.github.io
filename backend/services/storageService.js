import fs from "fs";
import path from "path";

export const ensureFolder = (folderPath) => {
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
};

export const writeJSON = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

export const readJSON = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath));
};

// backend/services/storageService.js
// CommonJS style (require/module.exports)
// Quản lý tạo folder, lưu video, cập nhật meta.json và finalize session

const fs = require("fs");
const path = require("path");
const sanitizeName = require("../utils/sanitizeName"); // import sanitizeName

// Thư mục gốc để lưu uploads (relative to project root)
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

/**
 * ensureFolder(folderPath)
 * Tạo folder nếu chưa tồn tại.
 */
function ensureFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

/**
 * createSessionFolder(userName)
 * Tạo 1 folder session theo format: DD_MM_YYYY_HH_mm_ten_user
 * Trả về { folderName, folderPath }
 */
function createSessionFolder(userName) {
  const now = new Date();

  const folderName =
    `${String(now.getDate()).padStart(2, "0")}_` +
    `${String(now.getMonth() + 1).padStart(2, "0")}_` +
    `${now.getFullYear()}_` +
    `${String(now.getHours()).padStart(2, "0")}_` +
    `${String(now.getMinutes()).padStart(2, "0")}_` +
    `${sanitizeName(userName)}`;

  // Đảm bảo thư mục gốc exists
  ensureFolder(UPLOADS_ROOT);

  const folderPath = path.join(UPLOADS_ROOT, folderName);
  // Tạo folder session (nếu đã có, recursive:true không lỗi)
  ensureFolder(folderPath);

  // Tạo metadata khởi tạo
  const meta = {
    userName,
    createdAt: new Date().toISOString(),
    timeZone: "Asia/Bangkok",
    questions: [] // sẽ push { index, savedAs, uploadedAt, sizeBytes, mimeType }
  };

  const metaPath = path.join(folderPath, "meta.json");
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  return { folderName, folderPath };
}

/**
 * getMeta(folderPath)
 * Đọc file meta.json (trả object). Nếu ko tồn tại -> null
 */
function getMeta(folderPath) {
  const metaPath = path.join(folderPath, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    // Lỗi đọc/parse -> null
    return null;
  }
}

/**
 * updateMeta(folderPath, updaterFn)
 * Đọc meta.json -> updaterFn(meta) -> ghi lại
 */
function updateMeta(folderPath, updaterFn) {
  const metaPath = path.join(folderPath, "meta.json");
  const meta = getMeta(folderPath) || {};
  updaterFn(meta);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

/**
 * saveQuestionVideo(folderPath, questionIndex, fileBuffer, options)
 * - Lưu buffer vào file Q<index>.webm (hoặc extension theo mime nếu muốn)
 * - Cập nhật meta.json (thêm entry vào questions)
 * - Trả về saved file name
 *
 * options = { originalname, mimetype, size }
 */
function saveQuestionVideo(folderPath, questionIndex, fileBuffer, options = {}) {
  if (!fs.existsSync(folderPath)) {
    throw new Error("Folder does not exist: " + folderPath);
  }

  // Bạn có thể chọn extension tùy mime. Mặc định theo đề: .webm
  const ext = ".webm";
  const fileName = `Q${questionIndex}${ext}`;
  const filePath = path.join(folderPath, fileName);

  // Ghi file (synchronous cho đơn giản; có thể đổi sang async nếu muốn)
  fs.writeFileSync(filePath, fileBuffer);

  // Cập nhật metadata => push vào questions
  const nowIso = new Date().toISOString();
  const entry = {
    index: questionIndex,
    savedAs: fileName,
    uploadedAt: nowIso,
    sizeBytes: options.size || (fileBuffer ? fileBuffer.length : undefined),
    mimeType: options.mimetype || undefined,
    originalName: options.originalname || undefined
  };

  updateMeta(folderPath, (meta) => {
    if (!Array.isArray(meta.questions)) meta.questions = [];
    meta.questions.push(entry);
    // cập nhật lastUploadedAt để tiện
    meta.lastUploadedAt = nowIso;
  });

  return fileName;
}

/**
 * finalizeSession(folderPath, totalQuestions)
 * - Ghi finishedAt, totalQuestions vào meta.json
 */
function finalizeSession(folderPath, totalQuestions = null) {
  if (!fs.existsSync(folderPath)) {
    throw new Error("Folder does not exist: " + folderPath);
  }

  updateMeta(folderPath, (meta) => {
    meta.finishedAt = new Date().toISOString();
    if (Number.isInteger(totalQuestions)) meta.totalQuestions = totalQuestions;
  });

  return true;
}

module.exports = {
  UPLOADS_ROOT,
  ensureFolder,
  createSessionFolder,
  getMeta,
  updateMeta,
  saveQuestionVideo,
  finalizeSession,
};
