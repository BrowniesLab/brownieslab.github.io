// middlewares/authMiddleware.js
export const authMiddleware = (req, res, next) => {
  const token = req.body.token || req.headers["authorization"]?.split(" ")[1] || null;
  if (!token || token !== process.env.AUTH_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized: Invalid or missing token" });
  }
  next();
};
