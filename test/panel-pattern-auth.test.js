"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPatternAuth, normalizePattern, verifySecret } = require("../panel-pattern-auth");
test("pattern validation requires at least five distinct grid points", () => {
  assert.equal(normalizePattern("0-1-2-3"), "");
  assert.equal(normalizePattern("0-1-2-3-3"), "");
  assert.equal(normalizePattern("0-1-2-3-9"), "");
  assert.equal(normalizePattern("0-1-2-4-8"), "0-1-2-4-8");
});
test("owner and Bostani patterns are stored separately as scrypt hashes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chaysa-pattern-"));
  try {
    const auth = createPatternAuth(dir);
    assert.equal(auth.configured("admin"), false);
    assert.equal(auth.setup("admin", "0-1-2-4-8"), true);
    assert.equal(auth.authenticate("admin", "0-1-2-4-8"), true);
    assert.equal(auth.authenticate("admin", "0-1-2-4-7"), false);
    assert.equal(auth.setup("admin", "0-1-2-4-7"), false);
    assert.equal(auth.setup("bostani", "0-2-4-6-8"), true);
    assert.equal(auth.authenticate("bostani", "0-2-4-6-8"), true);
    assert.equal(auth.authenticate("admin", "0-2-4-6-8"), false);
    const stored = fs.readFileSync(path.join(dir, "panel-patterns.json"), "utf8");
    assert.equal(stored.includes("0-1-2-4-8"), false);
    assert.equal(stored.includes("0-2-4-6-8"), false);
    assert.equal(JSON.parse(stored).admin.algorithm, "scrypt");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("legacy bootstrap secret comparison is timing-safe and exact", () => {
  assert.equal(verifySecret("correct", "correct"), true);
  assert.equal(verifySecret("incorrect", "correct"), false);
  assert.equal(verifySecret("", ""), false);
});
