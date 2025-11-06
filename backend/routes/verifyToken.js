import express from "express";
import { verifyToken } from "../controllers/verifyTokenController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/verify-token", authMiddleware, verifyToken);

export default router;
