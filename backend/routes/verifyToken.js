import express from "express";
const router = express.Router();

// Dummy verify-token endpoint
router.post("/verify-token", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ ok: false, error: "Missing token" });
  if (token === "123456") return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: "Invalid token" });
});

export default router;
