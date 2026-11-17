const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

let child, baseUrl, dataDir, telegramLog, rubikaLog, adminCookie;
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
function lines(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
}
async function request(pathname, options = {}) {
  return fetch(baseUrl + pathname, options);
}
async function createOrder(platform, messengerId, name) {
  const response = await request("/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer: {
        name, family: "آزمایشی", contact: "0000000000", messengerPlatform: platform,
        messengerId, province: "آزمایش", city: "آزمایش", address: "نشانی آزمایشی",
        postal: "1234567890", notes: "داده آزمایشی"
      },
      termsAccepted: true, termsAcceptedAt: new Date().toISOString(),
      items: [{ sku: "TEST-TEA", qty: 1 }]
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.orderId;
}
before(async () => {
  const port = await reservePort();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "chaysa-order-notification-test-"));
  telegramLog = path.join(dataDir, "telegram.jsonl");
  rubikaLog = path.join(dataDir, "rubika.jsonl");
  writeFileSync(telegramLog, "", "utf8");
  writeFileSync(rubikaLog, "", "utf8");
  writeFileSync(path.join(dataDir, "products.json"), JSON.stringify([
    { sku: "TEST-TEA", name: "چای آزمایشی", price: 1000, active: true }
  ]), "utf8");
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dataDir,
      ADMIN_PASSWORD: "order-test-admin-password",
      BOSTANI_ACCESS_TOKEN: "order-test-bostani-token",
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      RUBIKA_BOT_TOKEN: "test-rubika-token",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      TELEGRAM_WEBHOOK_URL: "https://preview.example.com/telegram/webhook",
      RUBIKA_WEBHOOK_URL: "https://preview.example.com/rubika/webhook/test",
      CHAYSA_OWNER_CHAT_ID: "111111", CHAYSA_BOSTANI_CHAT_ID: "222222",
      ORDER_CHAT_IDS: "111111,222222",
      TELEGRAM_MOCK_LOG: telegramLog, RUBIKA_MOCK_LOG: rubikaLog,
      TELEGRAM_MOCK_FAIL_CUSTOMER_CHAT_IDS: "666666",
      NODE_OPTIONS: "--require " + path.join(__dirname, "mock-telegram-fetch.js")
    },
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "order-test-admin-password" })
  });
  assert.equal(login.status, 200);
  adminCookie = String(login.headers.get("set-cookie") || "").split(";")[0];
});
after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 2000); });
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("owner and Bostani status changes notify the selected customer channel, suppress duplicates and allow safe retry", async () => {
  const telegramOrder = await createOrder("telegram", "333333", "مشتری تلگرام");
  const ownerUpdate = await request("/api/admin/orders/" + encodeURIComponent(telegramOrder) + "/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ status: "در حال آماده‌سازی" })
  });
  const ownerBody = await ownerUpdate.json();
  assert.equal(ownerUpdate.status, 200);
  assert.equal(ownerBody.customerNotification.status, "sent");
  assert.equal(ownerBody.changed, true);
  const customerTelegramMessages = () => lines(telegramLog).filter(x => {
    const payload = JSON.parse(x.body || "{}");
    return payload.chat_id === "333333" && String(payload.text || "").startsWith("به‌روزرسانی سفارش چایسا");
  });
  assert.equal(customerTelegramMessages().length, 1);
  const sentText = JSON.parse(customerTelegramMessages()[0].body).text;
  assert.match(sentText, /CH-/);
  assert.match(sentText, /در حال آماده‌سازی/);
  assert.doesNotMatch(sentText, /نشانی آزمایشی|1234567890/);

  const duplicate = await request("/api/admin/orders/" + encodeURIComponent(telegramOrder) + "/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ status: "در حال آماده‌سازی" })
  });
  const duplicateBody = await duplicate.json();
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.changed, false);
  assert.equal(customerTelegramMessages().length, 1);

  const retryOrder = await createOrder("telegram", "666666", "مشتری آزمایشی");
  const failed = await request("/api/admin/orders/" + encodeURIComponent(retryOrder) + "/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ status: "ارسال‌شده" })
  });
  const failedBody = await failed.json();
  assert.equal(failedBody.customerNotification.status, "failed");
  const retried = await request("/api/admin/orders/" + encodeURIComponent(retryOrder) + "/status-notification/retry", {
    method: "POST", headers: { Cookie: adminCookie }
  });
  const retriedBody = await retried.json();
  assert.equal(retried.status, 200);
  assert.equal(retriedBody.customerNotification.status, "sent");
  assert.equal(retriedBody.customerNotification.attempts, 2);

  const rubikaOrder = await createOrder("rubika", "RubikaChat_12345", "مشتری روبیکا");
  const bostaniUpdate = await request("/api/bostani/orders/" + encodeURIComponent(rubikaOrder) + "/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: "chaysa_bostani=order-test-bostani-token" },
    body: JSON.stringify({ status: "تحویل‌شده" })
  });
  const bostaniBody = await bostaniUpdate.json();
  assert.equal(bostaniUpdate.status, 200);
  assert.equal(bostaniBody.customerNotification.status, "sent");
  const rubikaCustomerMessage = lines(rubikaLog).find(x => {
    const payload = JSON.parse(x.body || "{}");
    return String(x.url).endsWith("/sendMessage") && payload.chat_id === "RubikaChat_12345" &&
      String(payload.text || "").startsWith("به‌روزرسانی سفارش چایسا");
  });
  assert.ok(rubikaCustomerMessage);
});
