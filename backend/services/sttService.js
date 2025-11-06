import fs from "fs";
import { SpeechClient } from "@google-cloud/speech";

const client = new SpeechClient();

export const convertVideoToText = async (filePath) => {
  if (!fs.existsSync(filePath)) throw new Error("File not found: " + filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const audioBytes = fileBuffer.toString("base64");

  const request = {
    audio: { content: audioBytes },
    config: { encoding: "WEBM_OPUS", sampleRateHertz: 48000, languageCode: "en-US" }
  };

  const [response] = await client.recognize(request);
  return response.results.map(r => r.alternatives[0].transcript).join("\n");
};

export const writeTranscript = (folderPath, questionIndex, transcript) => {
  const transcriptPath = path.join(folderPath, "transcript.txt");
  let existing = "";
  if (fs.existsSync(transcriptPath)) existing = fs.readFileSync(transcriptPath, "utf8");
  const newEntry = `--- Question ${questionIndex} ---\n${transcript}\n\n`;
  fs.writeFileSync(transcriptPath, existing + newEntry, "utf8");
};
