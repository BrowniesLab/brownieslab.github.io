import fs from "fs";
import path from "path";
import { sanitizeName } from "../utils/sanitizeName.js";

export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export const ensureFolder = (folderPath) => {
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
};

export const createSessionFolder = (userName) => {
  const now = new Date();
  const folderName =
    `${String(now.getDate()).padStart(2,"0")}_` +
    `${String(now.getMonth()+1).padStart(2,"0")}_` +
    `${now.getFullYear()}_` +
    `${String(now.getHours()).padStart(2,"0")}_` +
    `${String(now.getMinutes()).padStart(2,"0")}_` +
    sanitizeName(userName);

  ensureFolder(UPLOADS_ROOT);
  const folderPath = path.join(UPLOADS_ROOT, folderName);
  ensureFolder(folderPath);

  const meta = { userName, createdAt: now.toISOString(), timeZone: "Asia/Bangkok", questions: [] };
  fs.writeFileSync(path.join(folderPath, "meta.json"), JSON.stringify(meta, null, 2));
  return { folderName, folderPath };
};

export const getMeta = (folderPath) => {
  const metaPath = path.join(folderPath, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
};

export const updateMeta = (folderPath, updaterFn) => {
  const meta = getMeta(folderPath) || {};
  updaterFn(meta);
  fs.writeFileSync(path.join(folderPath, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
};

export const saveQuestionVideo = (folderPath, questionIndex, fileBuffer, options={}) => {
  const fileName = `Q${questionIndex}.webm`;
  const filePath = path.join(folderPath, fileName);
  fs.writeFileSync(filePath, fileBuffer);
  const entry = {
    index: questionIndex,
    savedAs: fileName,
    uploadedAt: new Date().toISOString(),
    sizeBytes: options.size || fileBuffer.length,
    mimeType: options.mimetype,
    originalName: options.originalname
  };
  updateMeta(folderPath, meta => {
    if (!Array.isArray(meta.questions)) meta.questions = [];
    meta.questions.push(entry);
    meta.lastUploadedAt = entry.uploadedAt;
  });
  return fileName;
};

export const finalizeSession = (folderPath, totalQuestions = null) => {
  updateMeta(folderPath, meta => {
    meta.finishedAt = new Date().toISOString();
    if (Number.isInteger(totalQuestions)) meta.totalQuestions = totalQuestions;
  });
};
