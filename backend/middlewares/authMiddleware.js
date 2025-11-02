export const authMiddleware = (req, res, next) => {
  const { token } = req.body;
  if (token !== "123456") {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
};
// authMiddleware.js
import dotenv from "dotenv";
dotenv.config();

/**
 * Middleware xác thực token gửi từ client.
 * Token có thể nằm trong:
 *  - req.body.token (với POST request JSON)
 *  - hoặc trong header Authorization: "Bearer <token>"
 */
export const authMiddleware = (req, res, next) => {
  try {
    // Lấy token từ body hoặc header
    const token =
      req.body.token ||
      req.headers["authorization"]?.split(" ")[1] ||
      null;

    // Nếu không có token hoặc token sai → từ chối truy cập
    if (!token || token !== process.env.AUTH_TOKEN) {
      return res
        .status(401)
        .json({ ok: false, error: "Unauthorized: Invalid or missing token" });
    }

    // Token hợp lệ → tiếp tục middleware/route tiếp theo
    next();
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
};

