import express from "express";
import multer from "multer";
import { uploadOne } from "../controllers/uploadController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import fs from "fs";
import path from "path";

const router = express.Router();

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.body.folder;
    const dir = path.join(process.cwd(), "uploads", folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `Q${req.body.questionIndex}.webm`);
  }
});
const upload = multer({ storage });

router.post("/upload-one", authMiddleware, upload.single("video"), uploadOne);

export default router;
