import request from "supertest";
import fs from "fs";
import path from "path";
import app from "../server.js"; // đảm bảo server.js export app, không gọi app.listen trực tiếp

describe("Upload API", () => {
  const token = "123456";
  let folderName;

  // Tạo session trước khi test upload
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/session/start")
      .send({ token, userName: "Nguyen Khanh" });

    folderName = res.body.folder;
    expect(res.statusCode).toBe(200);
    expect(folderName).toBeDefined();
  });

  it("should upload a question video", async () => {
    const videoPath = path.join(__dirname, "dummy_video.webm");

    // Tạo file video giả lập nếu chưa tồn tại
    if (!fs.existsSync(videoPath)) {
      fs.writeFileSync(videoPath, Buffer.from("fake video content"));
    }

    const res = await request(app)
      .post("/api/upload-one")
      .field("token", token)
      .field("folder", folderName)
      .field("questionIndex", 1)
      .attach("video", videoPath);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.savedAs).toBe("Q1.webm");

    // Kiểm tra file đã được lưu trong folder uploads
    const uploadedFilePath = path.join(
      process.cwd(),
      "uploads",
      folderName,
      res.body.savedAs
    );
    expect(fs.existsSync(uploadedFilePath)).toBe(true);
  });

  // Clean up folder after test
  afterAll(() => {
    const folderPath = path.join(process.cwd(), "uploads", folderName);
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }
  });
});
