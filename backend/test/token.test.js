import assert from "assert";

describe("Verify Token", () => {
  it("should pass with valid token", () => {
    const token = "123456";
    assert.strictEqual(token === "123456", true);
  });
  it("should fail with invalid token", () => {
    const token = "wrong";
    assert.strictEqual(token === "123456", false);
  });
});
