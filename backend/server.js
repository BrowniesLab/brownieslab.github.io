import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { authMiddleware } from "./middlewares/authMiddleware.js"; // <-- import từ file

dotenv.config();
const app = express();
app.use(express.json());

// Logger middleware
const logDir = path.resolve("logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const logger = (req, res, next) => {
  const time = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
  const logMessage = `[${time}] ${req.method} ${req.originalUrl}\n`;
  fs.appendFileSync(path.join(logDir, "server.log"), logMessage);
  console.log(logMessage.trim());
  next();
};
app.use(logger);

// Multer setup
const upload = multer({ dest: "temp/" });

// --------------------- API ROUTES ---------------------
app.post("/api/verify-token", authMiddleware, (req, res) => {
  res.json({ ok: true });
});

app.post("/api/session/start", authMiddleware, (req, res, next) => {
  try {
    const { userName } = req.body;
    if (!userName) throw new Error("Missing userName");

    const time = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
    const folderName = `${time.replace(/[/:]/g, "_").replace(", ", "_")}_${userName.replace(/\s+/g,'_')}`;
    const folderPath = path.join("uploads", folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    const meta = { userName, uploadedAt: new Date().toISOString(), timeZone: "Asia/Bangkok", questions: [] };
    fs.writeFileSync(path.join(folderPath, "meta.json"), JSON.stringify(meta, null, 2));

    res.json({ ok: true, folder: folderName });
  } catch (err) {
    next(err);
  }
});

app.post("/api/upload-one", authMiddleware, upload.single("video"), (req, res, next) => {
  try {
    const { folder, questionIndex } = req.body;
    if (!folder || !questionIndex || !req.file) throw new Error("Missing required fields");

    const folderPath = path.join("uploads", folder);
    if (!fs.existsSync(folderPath)) throw new Error("Invalid folder");

    const savedAs = `Q${questionIndex}.webm`;
    fs.renameSync(req.file.path, path.join(folderPath, savedAs));

    const metaPath = path.join(folderPath, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath));
    meta.questions.push({ questionIndex: parseInt(questionIndex), savedAs, uploadedAt: new Date().toISOString() });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.json({ ok: true, savedAs });
  } catch (err) {
    next(err);
  }
});

app.post("/api/session/finish", authMiddleware, (req, res, next) => {
  try {
    const { folder, questionsCount } = req.body;
    if (!folder || !questionsCount) throw new Error("Missing required fields");

    const folderPath = path.join("uploads", folder);
    if (!fs.existsSync(folderPath)) throw new Error("Invalid folder");

    const metaPath = path.join(folderPath, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath));
    meta.finishedAt = new Date().toISOString();
    meta.questionsCount = parseInt(questionsCount);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Route mặc định cho /
app.get("/", (req, res) => {
  res.send("✅ Web Interview Recorder backend is running.");
});


// Error handler
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Internal Server Error" });
});

export default app; // EXPORT để dùng trong test

// Nếu muốn chạy trực tiếp node server.js
if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
}


// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));

