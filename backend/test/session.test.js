import fs from "fs";
import path from "path";
import assert from "assert";

describe("Session", () => {
  const folder = path.join("backend/uploads", "test_session");
  const metaPath = path.join(folder, "meta.json");

  it("should create folder", () => {
    fs.mkdirSync(folder, { recursive: true });
    assert.strictEqual(fs.existsSync(folder), true);
  });

  it("should create meta.json file", () => {
    const meta = { userName: "tester", token: "123456" };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    assert.strictEqual(fs.existsSync(metaPath), true);
  });
});
