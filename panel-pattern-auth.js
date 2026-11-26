"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
function normalizePattern(value) {
  if (Array.isArray(value)) value = value.join("-");
  if (typeof value !== "string") return "";
  const parts = value.split("-");
  if (parts.length < 5 || parts.length > 9 || parts.some(x => !/^[0-8]$/.test(x)) || new Set(parts).size !== parts.length) return "";
  return parts.join("-");
}
function verifySecret(supplied, expected) {
  if (typeof supplied !== "string" || !expected) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createPatternRecord(pattern) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(pattern, salt, 64).toString("hex"), algorithm: "scrypt", updatedAt: new Date().toISOString() };
}
function verifyPattern(pattern, record) {
  if (!pattern || !record || record.algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(record.salt || "") || !/^[a-f0-9]{128}$/.test(record.hash || "")) return false;
  const actual = crypto.scryptSync(pattern, record.salt, 64), expected = Buffer.from(record.hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function createPatternAuth(dataDir) {
  const file = path.join(dataDir, "panel-patterns.json");
  function read() { try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return value && typeof value === "object" ? value : {}; } catch (_) { return {}; } }
  function write(value) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) {}
  }
  return {
    configured(role) { return Boolean(read()[role]); },
    authenticate(role, pattern) { return verifyPattern(normalizePattern(pattern), read()[role]); },
    setup(role, pattern) { const all = read(); if (all[role]) return false; const normalized = normalizePattern(pattern); if (!normalized) return null; all[role] = createPatternRecord(normalized); write(all); return true; }
  };
}
module.exports = { createPatternAuth, normalizePattern, verifySecret };
