const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
let child, baseUrl, dataDir, output = "";
async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
before(async () => {
  const port = await reservePort();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "chaysa-bostani-auth-"));
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir,
      BOSTANI_ACCESS_USERNAME: "@bostani26chaysa",
      BOSTANI_ACCESS_PASSWORD: "test-only-bostani-password",
      BOSTANI_ACCESS_TOKEN: "test-only-session-secret",
      TELEGRAM_BOT_TOKEN: "", CHAYSA_OWNER_CHAT_ID: "", CHAYSA_BOSTANI_CHAT_ID: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try { const r = await fetch(baseUrl + "/api/health"); if (r.ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Test server did not start. " + output);
});
after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 2000); });
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});
async function login(username, password) {
  return fetch(baseUrl + "/api/bostani/login", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
}
test("unauthenticated page shows login form and API denies access", async () => {
  const page = await fetch(baseUrl + "/bostani.html");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="loginForm"/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="password"/);
  assert.match(html, /type="password"/);
  assert.equal((await fetch(baseUrl + "/api/bostani/questions")).status, 401);
});
test("wrong username and password are rejected", async () => {
  assert.equal((await login("@someoneelse", "test-only-bostani-password")).status, 401);
  assert.equal((await login("@bostani26chaysa", "incorrect-password")).status, 401);
});
test("valid credentials create secure signed session; logout revokes it", async () => {
  const response = await login("@bostani26chaysa", "test-only-bostani-password");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Max-Age=28800/i);
  const cookie = setCookie.split(";")[0];
  assert.match(cookie, /^chaysa_bostani=\\d+\\./);
  assert.equal((await fetch(baseUrl + "/api/bostani/questions", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(baseUrl + "/api/bostani/logout", { method: "POST", headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(baseUrl + "/api/bostani/questions", { headers: { Cookie: cookie } })).status, 401);
});
test("legacy key is converted to an eight-hour signed session", async () => {
  const response = await fetch(baseUrl + "/bostani.html?key=test-only-session-secret", { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/bostani.html");
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /Max-Age=28800/i);
  const cookie = setCookie.split(";")[0];
  assert.doesNotMatch(cookie, /test-only-session-secret/);
  assert.equal((await fetch(baseUrl + "/api/bostani/questions", { headers: { Cookie: cookie } })).status, 200);
});
