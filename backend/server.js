import express from "express";
import cors from "cors";
import verifyRoutes from "./routes/verifyRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";

const app = express();
app.use(cors());
app.use(express.json());

// Mount routes
app.use("/api", verifyRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/upload-one", uploadRoutes);

// Root test route
app.get("/", (req, res) => res.send("✅ Backend running!"));

// Error handler (last middleware)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
