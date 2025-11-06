import { createSessionFolder, finalizeSession } from "../services/storageService.js";

export const startSession = (req, res, next) => {
  try {
    const { userName } = req.body;
    if (!userName) throw new Error("Missing userName");
    const { folderName } = createSessionFolder(userName);
    res.json({ ok: true, folder: folderName });
  } catch (err) { next(err); }
};

export const finishSession = (req, res, next) => {
  try {
    const { folder, questionsCount } = req.body;
    if (!folder || !questionsCount) throw new Error("Missing required fields");
    const folderPath = `${process.cwd()}/uploads/${folder}`;
    finalizeSession(folderPath, parseInt(questionsCount));
    res.json({ ok: true });
  } catch (err) { next(err); }
};
