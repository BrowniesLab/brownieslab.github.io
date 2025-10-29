import fs from "fs";
import path from "path";

export const generateTranscript = async (folderPath, fileName) => {
  const transcriptPath = path.join(folderPath, "transcript.txt");
  const content = `--- ${fileName} ---\n(Mock transcript)\n\n`;
  fs.appendFileSync(transcriptPath, content);
  console.log(`📝 Mock transcript created for ${fileName}`);
};
