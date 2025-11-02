import fs from "fs";
import path from "path";

export const generateTranscript = async (folderPath, fileName) => {
  const transcriptPath = path.join(folderPath, "transcript.txt");
  const content = `--- ${fileName} ---\n(Mock transcript)\n\n`;
  fs.appendFileSync(transcriptPath, content);
  console.log(`📝 Mock transcript created for ${fileName}`);
};
// sttService.js
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import OpenAI from "openai";

/**
 * Dịch vụ Speech-to-Text (STT)
 * - Chuyển video .webm → .wav
 * - Gửi audio lên OpenAI Whisper
 * - Ghi kết quả vào transcript.txt trong folder người dùng
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // lấy từ file .env
});

// 🎧 Chuyển định dạng video (.webm) → audio (.wav)
const convertToWav = (inputPath, outputPath) =>
  new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat("wav")
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });

// 🗣️ Hàm tạo transcript cho mỗi câu hỏi
export const generateTranscript = async (folderPath, fileName, questionIndex) => {
  try {
    const inputFile = path.join(folderPath, fileName);
    const wavFile = path.join(folderPath, `${fileName}.wav`);

    // B1. Convert video sang wav
    await convertToWav(inputFile, wavFile);

    // B2. Gửi file audio lên Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(wavFile),
      model: "whisper-1",
    });

    // B3. Ghi hoặc nối thêm transcript.txt
    const transcriptPath = path.join(folderPath, "transcript.txt");
    const textBlock = `\n=== Question ${questionIndex} ===\n${transcription.text.trim()}\n`;

    fs.appendFileSync(transcriptPath, textBlock);
    fs.unlinkSync(wavFile); // xóa file audio tạm

    console.log(`✅ Transcript for ${fileName} created.`);
  } catch (err) {
    console.error("❌ STT error:", err.message);
  }
};
