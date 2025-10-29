export const authMiddleware = (req, res, next) => {
  const { token } = req.body;
  if (token !== "123456") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
};
