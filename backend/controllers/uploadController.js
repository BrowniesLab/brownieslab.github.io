// backend/controllers/uploadController.js
import fs from "fs";
import path from "path";
import { saveQuestionVideo } from "../services/storageService.js";
import { convertVideoToText, writeTranscript } from "../services/sttService.js";

/**
 * Upload one video question
 * - Lưu video vào folder session
 * - Cập nhật metadata (meta.json)
 * - Thực hiện Speech-to-Text (Google STT) và ghi transcript.txt
 */
export const uploadOne = async (req, res, next) => {
  try {
    const { folder, questionIndex } = req.body;

    if (!folder || !questionIndex || !req.file) {
      throw new Error("Missing required fields: folder, questionIndex, or video file");
    }

    const folderPath = path.join(process.cwd(), "uploads", folder);
    const fileBuffer = fs.readFileSync(req.file.path);

    // 1️⃣ Lưu video và cập nhật metadata
    const savedAs = saveQuestionVideo(folderPath, questionIndex, fileBuffer, {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    // Xóa file tạm
    fs.unlinkSync(req.file.path);

    // 2️⃣ Thực hiện Speech-to-Text (STT)
    try {
      const transcript = await convertVideoToText(path.join(folderPath, savedAs));
      writeTranscript(folderPath, questionIndex, transcript);
    } catch (sttErr) {
      console.error("STT error:", sttErr.message);
      // Không block upload nếu STT thất bại
    }

    res.json({ ok: true, savedAs });
  } catch (err) {
    next(err);
  }
};
