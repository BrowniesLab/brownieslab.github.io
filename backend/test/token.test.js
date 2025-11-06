import request from "supertest";
import app from "../server.js"; // export app từ server.js

describe("Verify Token API", () => {
  it("should return ok true for valid token", async () => {
    const res = await request(app)
      .post("/api/verify-token")
      .send({ token: "123456" }); // token hợp lệ

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("should return 401 for invalid token", async () => {
    const res = await request(app)
      .post("/api/verify-token")
      .send({ token: "wrongtoken" });

    expect(res.statusCode).toBe(401);
    expect(res.body.ok).toBe(false);
  });
});
