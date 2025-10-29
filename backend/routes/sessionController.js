import express from "express";
import { createSession, finishSession } from "../controllers/sessionController.js";
const router = express.Router();

router.post("/start", createSession);
router.post("/finish", finishSession);

export default router;
