const { test, before, after } = require("node:test");
const crypto = require("node:crypto");
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
        messengerUsername: "@chaysa", messengerId, province: "آزمایش", city: "آزمایش", address: "نشانی آزمایشی",
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
      RUBIKA_MOCK_REGISTRATION_MODE: "invalid-url",
      RUBIKA_MOCK_UPDATES_JSON: JSON.stringify({
        updates: [{ type: "StartedBot", chat_id: "RubikaPollingChat_12345" }],
        next_offset_id: "rubika-offset-1"
      }),
      RUBIKA_POLL_INTERVAL_MS: "50",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      TELEGRAM_WEBHOOK_URL: "https://preview.example.com/telegram/webhook",
      RUBIKA_WEBHOOK_URL: "https://preview.example.com/rubika/webhook/test",
      CHAYSA_OWNER_CHAT_ID: "111111", CHAYSA_BOSTANI_CHAT_ID: "222222",
      ORDER_CHAT_IDS: "111111,222222",
      TELEGRAM_MOCK_LOG: telegramLog, RUBIKA_MOCK_LOG: rubikaLog,
      TELEGRAM_MOCK_FAIL_CUSTOMER_ONCE_CHAT_IDS: "666666",
      RUBIKA_MOCK_FAIL_CUSTOMER_ONCE_CHAT_IDS: "RubikaFailOnce_12345",
      RUBIKA_MOCK_FAIL_CUSTOMER_CHAT_IDS: "RubikaFailAlways_12345",
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

test("Rubika /start sends the title and copy-only numeric chat ID as separate messages on every entry", async () => {
  const chatId = "RubikaPollingChat_12345";
  const deadline = Date.now() + 5000;
  const sentForChat = () => lines(rubikaLog)
    .filter(entry => entry.url.endsWith("/sendMessage"))
    .map(entry => JSON.parse(entry.body || "{}"))
    .filter(payload => payload.chat_id === chatId)
    .map(payload => payload.text);
  while (Date.now() < deadline && sentForChat().length < 2) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(sentForChat(), ["شناسه خرید از چایسا", chatId],
    "Polling StartedBot must send title first and the bare chat ID second");
  assert.ok(lines(rubikaLog).some(entry => entry.url.endsWith("/getUpdates")), "getUpdates was not called");
  assert.equal(readFileSync(path.join(dataDir, "rubika-updates-offset.txt"), "utf8"), "rubika-offset-1");

  const webhookKey = crypto.createHash("sha256")
    .update("CHAYSA-RUBIKA-WEBHOOK-V1:test-rubika-token").digest("hex").slice(0, 40);
  const restarted = await request("/rubika/webhook/" + webhookKey, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update: {
      type: "Message",
      new_message: { chat_id: chatId, sender_type: "User", text: "/start" }
    } })
  });
  assert.equal(restarted.status, 200);
  assert.deepEqual(sentForChat(), [
    "شناسه خرید از چایسا", chatId,
    "شناسه خرید از چایسا", chatId
  ], "A later /start must resend both separate messages without a one-time guard");
});

test("owner and Bostani status changes notify the selected customer channel, suppress duplicates and allow safe retry", async () => {
  const telegramOrder = await createOrder("telegram", "333333", "مشتری تلگرام");
  const orderInvoice = lines(telegramLog).map(entry => JSON.parse(entry.body || "{}")).find(payload =>
    String(payload.text || "").startsWith("فاکتور سفارش چایسا") && String(payload.text).includes(telegramOrder)
  );
  assert.ok(orderInvoice, "the admin invoice should be sent");
  assert.match(orderInvoice.text, /آیدی عمومی پیام‌رسان: @chaysa/);
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

  const rubikaRetryOrder = await createOrder("rubika", "RubikaFailOnce_12345", "مشتری روبیکا آزمایشی");
  const rubikaFailed = await request("/api/admin/orders/" + encodeURIComponent(rubikaRetryOrder) + "/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ status: "ارسال‌شده" })
  });
  const rubikaFailedBody = await rubikaFailed.json();
  assert.equal(rubikaFailed.status, 200);
  assert.equal(rubikaFailedBody.customerNotification.status, "failed");
  assert.match(rubikaFailedBody.customerNotification.error, /status=ERROR/);
  assert.match(rubikaFailedBody.customerNotification.error, /error_code=4003/);
  assert.doesNotMatch(rubikaFailedBody.customerNotification.error, /sensitive Rubika response text/);

  const rubikaRetried = await request("/api/admin/orders/" + encodeURIComponent(rubikaRetryOrder) + "/status-notification/retry", {
    method: "POST", headers: { Cookie: adminCookie }
  });
  const rubikaRetriedBody = await rubikaRetried.json();
  assert.equal(rubikaRetried.status, 200);
  assert.equal(rubikaRetriedBody.ok, true);
  assert.equal(rubikaRetriedBody.customerNotification.status, "sent");
  assert.equal(rubikaRetriedBody.customerNotification.attempts, 2);

  const rubikaPermanentOrder = await createOrder("rubika", "RubikaFailAlways_12345", "مشتری روبیکا ناموفق");
  const rubikaPermanentFailed = await request("/api/admin/orders/" + encodeURIComponent(rubikaPermanentOrder) + "/status", {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ status: "تحویل‌شده" })
  });
  const rubikaPermanentBody = await rubikaPermanentFailed.json();
  assert.equal(rubikaPermanentBody.customerNotification.status, "failed");
  const rubikaPermanentRetry = await request("/api/admin/orders/" + encodeURIComponent(rubikaPermanentOrder) + "/status-notification/retry", {
    method: "POST", headers: { Cookie: adminCookie }
  });
  const rubikaPermanentRetryBody = await rubikaPermanentRetry.json();
  assert.equal(rubikaPermanentRetry.status, 502);
  assert.equal(rubikaPermanentRetryBody.ok, false);
  assert.equal(rubikaPermanentRetryBody.customerNotification.status, "failed");
  assert.doesNotMatch(JSON.stringify(rubikaPermanentRetryBody), /sensitive Rubika response text/);
});

test("Telegram checkout connection link resolves the bot and /start returns the customer numeric chat ID", async () => {
  const botInfo = await request("/api/telegram/customer-bot");
  const botBody = await botInfo.json();
  assert.equal(botInfo.status, 200);
  assert.equal(botBody.username, "ChaysaBotTest");
  assert.equal(botBody.url, "https://t.me/ChaysaBotTest?start=order");

  const started = await request("/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({
      message: { chat: { id: 444444, type: "private", username: "customer_test", first_name: "مشتری" }, text: "/start order" }
    })
  });
  assert.equal(started.status, 200);
  const welcome = lines(telegramLog).map(entry => JSON.parse(entry.body || "{}")).find(payload =>
    payload.chat_id === 444444 && String(payload.text || "").includes("شناسه عددی گفت‌وگوی شما برای ثبت سفارش")
  );
  assert.ok(welcome);
  assert.match(welcome.text, /444444/);
  assert.match(welcome.text, /آیدی عمومی با @/);
});

test("Telegram generic /start still returns a chat ID without a deep-link payload", async () => {
  const started = await request("/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { chat: { id: 555555, type: "private" }, text: "/start" } })
  });
  assert.equal(started.status, 200);
  const welcome = lines(telegramLog).map(entry => JSON.parse(entry.body || "{}")).find(payload =>
    payload.chat_id === 555555 && String(payload.text || "").includes("شناسه عددی گفت‌وگوی شما برای ثبت سفارش")
  );
  assert.ok(welcome);
  assert.match(welcome.text, /555555/);
});
