const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

let child, baseUrl, dataDir, adminCookie;
const root = path.join(__dirname, "..");

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

async function request(pathname, options = {}) {
  return fetch(baseUrl + pathname, options);
}

before(async () => {
  const port = await reservePort();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chaysa-discontinued-products-"));
  const originalProducts = [
    { sku: "HONEY-1", name: "عسل آزمایشی", category: "عسل", price: 1000, active: true },
    { sku: "COFFEE-1", name: "قهوه آزمایشی", category: "قهوه", price: 2000, active: true },
    { sku: "TEA-1", name: "چای آزمایشی", category: "چای", price: 3000, active: true }
  ];
  fs.writeFileSync(path.join(dataDir, "products.json"), JSON.stringify(originalProducts, null, 2), "utf8");
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: "discontinued-test-password" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await request("/api/health");
      if (response.ok) { ready = true; break; }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Test server did not start. " + output);
  const login = await request("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "discontinued-test-password" })
  });
  assert.equal(login.status, 200);
  adminCookie = String(login.headers.get("set-cookie") || "").split(";")[0];
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 2000); });
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test("startup migration removes honey and coffee from active persistent catalogue and keeps a one-time backup", () => {
  const active = JSON.parse(fs.readFileSync(path.join(dataDir, "products.json"), "utf8"));
  const backupPath = path.join(dataDir, "products.json.pre-discontinued-2026-11-24.bak");
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  assert.deepEqual(active.map(item => item.sku), ["TEA-1"]);
  assert.deepEqual(backup.map(item => item.sku), ["HONEY-1", "COFFEE-1", "TEA-1"]);
});

test("public, admin and guide catalogues expose only continuing products", async () => {
  for (const endpoint of ["/api/products", "/api/admin/products", "/api/guide/bootstrap"]) {
    const response = await request(endpoint, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200, endpoint);
    const body = await response.json();
    const products = endpoint.endsWith("bootstrap") ? body.products : body;
    assert.deepEqual(products.map(item => item.sku), ["TEA-1"], endpoint);
  }
});

test("admin catalogue writes cannot reintroduce discontinued categories", async () => {
  const response = await request("/api/admin/products", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify([
      { sku: "TEA-2", name: "چای جدید", category: "چای", price: 4000, active: true },
      { sku: "HONEY-2", name: "عسل جدید", category: "عسل", price: 5000, active: true },
      { sku: "COFFEE-2", name: "قهوه جدید", category: "قهوه", price: 6000, active: true }
    ])
  });
  assert.equal(response.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "products.json"), "utf8"));
  assert.deepEqual(saved.map(item => item.sku), ["TEA-2"]);
});

test("storefront and admin form no longer offer honey or coffee categories", () => {
  const storefront = fs.readFileSync(path.join(root, "products.html"), "utf8");
  const admin = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.match(storefront, /const categories = \["چای","دمنوش","ادویه","سایر"\]/);
  assert.doesNotMatch(storefront, /const categories = \[[^\]]*(?:عسل|قهوه|coffee|honey)/i);
  assert.doesNotMatch(admin, /<option>\s*(?:عسل|قهوه|coffee|honey)\s*<\/option>/i);
});
