import request from "supertest";
import app from "../server.js";

describe("Session APIs", () => {
  const token = "123456";
  let folderName;

  it("should start a session", async () => {
    const res = await request(app)
      .post("/api/session/start")
      .send({ token, userName: "Nguyen Khanh" });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.folder).toBeDefined();
    folderName = res.body.folder;
  });

  it("should finish a session", async () => {
    const res = await request(app)
      .post("/api/session/finish")
      .send({ token, folder: folderName, questionsCount: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
