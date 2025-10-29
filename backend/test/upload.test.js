import fs from "fs";
import path from "path";
import assert from "assert";

describe("Upload", () => {
  const folder = path.join("backend/uploads", "test_session");
  const videoPath = path.join(folder, "Q1.webm");

  it("should write dummy video file", () => {
    fs.writeFileSync(videoPath, "dummy video data");
    assert.strictEqual(fs.existsSync(videoPath), true);
  });
});
