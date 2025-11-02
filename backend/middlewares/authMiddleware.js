export const authMiddleware = (req, res, next) => {
  const { token } = req.body;
  if (token !== "123456") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
};
// server.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// ====================== MIDDLEWARE ======================

// 🔐 authMiddleware
const authMiddleware = (req, res, next) => {
  const token =
    req.body.token ||
    req.headers["authorization"]?.split(" ")[1] ||
    null;

  if (!token || token !== process.env.AUTH_TOKEN) {
    return res
      .status(401)
      .json({ ok: false, error: "Unauthorized: Invalid or missing token" });
  }

  next();
};

// 🪵 logger
const logDir = path.resolve("logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const logger = (req, res, next) => {
  const time = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
  });
  const logMessage = `[${time}] ${req.method} ${req.originalUrl}\n`;
  fs.appendFileSync(path.join(logDir, "server.log"), logMessage);
  console.log(logMessage.trim());
  next();
};
app.use(logger);

// ⚠️ errorHandler
const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || "Internal Server Error",
  });
};

// ====================== HELPER ======================
const sanitizeName = (name) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
const upload = multer({ dest: "temp/" });

// ====================== API ROUTES ======================

// 1️⃣ Verify Token
app.post("/api/verify-token", authMiddleware, (req, res) => {
  res.json({ ok: true });
});

// 2️⃣ Start Session
app.post("/api/session/start", authMiddleware, (req, res, next) => {
  try {
    const { userName } = req.body;
    if (!userName) throw new Error("Missing userName");

    const time = new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok",
    });
    const folderName = `${time
      .replace(/[/:]/g, "_")
      .replace(", ", "_")}_${sanitizeName(userName)}`;

    const folderPath = path.join("uploads", folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    const meta = {
      userName,
      uploadedAt: new Date().toISOString(),
      timeZone: "Asia/Bangkok",
      questions: [],
    };
    fs.writeFileSync(
      path.join(folderPath, "meta.json"),
      JSON.stringify(meta, null, 2)
    );

    res.json({ ok: true, folder: folderName });
  } catch (err) {
    next(err);
  }
});

// 3️⃣ Upload One Question
app.post(
  "/api/upload-one",
  authMiddleware,
  upload.single("video"),
  (req, res, next) => {
    try {
      const { folder, questionIndex } = req.body;
      if (!folder || !questionIndex || !req.file)
        throw new Error("Missing required fields");

      const folderPath = path.join("uploads", folder);
      if (!fs.existsSync(folderPath)) throw new Error("Invalid folder");

      const savedAs = `Q${questionIndex}.webm`;
      const destPath = path.join(folderPath, savedAs);
      fs.renameSync(req.file.path, destPath);

      // Update metadata
      const metaPath = path.join(folderPath, "meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath));
      meta.questions.push({
        questionIndex: parseInt(questionIndex),
        savedAs,
        uploadedAt: new Date().toISOString(),
      });
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      res.json({ ok: true, savedAs });
    } catch (err) {
      next(err);
    }
  }
);

// 4️⃣ Finish Session
app.post("/api/session/finish", authMiddleware, (req, res, next) => {
  try {
    const { folder, questionsCount } = req.body;
    if (!folder || !questionsCount)
      throw new Error("Missing required fields");

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

// ====================== ERROR HANDLER ======================
app.use(errorHandler);

// ====================== START SERVER ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
