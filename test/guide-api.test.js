const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

let child;
let baseUrl;
let dataDir;
let mockLog;
let output = "";

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
  dataDir = mkdtempSync(path.join(os.tmpdir(), "chaysa-guide-test-"));
  mockLog = path.join(dataDir, "telegram-mock.jsonl");
  writeFileSync(mockLog, "", "utf8");
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: "guide-test-only-password",
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      TELEGRAM_WEBHOOK_URL: "https://preview.example.com/telegram/webhook",
      CHAYSA_OWNER_CHAT_ID: "111111",
      CHAYSA_BOSTANI_CHAT_ID: "222222",
      TELEGRAM_MOCK_LOG: mockLog,
      NODE_OPTIONS: "--require " + path.join(__dirname, "mock-telegram-fetch.js")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) { ready = true; break; }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Test server did not start. " + output);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      child.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

async function resolveQuestion(body) {
  const response = await fetch(baseUrl + "/api/guide/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function postWebhook(chatId, text, fromId = chatId, secret = "test-webhook-secret") {
  return fetch(baseUrl + "/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": secret
    },
    body: JSON.stringify({
      message: {
        chat: { id: chatId, type: "private", username: "test_user" },
        from: { id: fromId, username: "test_user" },
        text
      }
    })
  });
}

function approvalRows() {
  return JSON.parse(readFileSync(path.join(dataDir, "guide-approvals.json"), "utf8"));
}

function telegramLog() {
  return readFileSync(mockLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
}

test("Telegram approval is owner-initiated, Bostani-only and auditable", async () => {
  const webhookCalls = telegramLog();
  const setWebhook = webhookCalls.find(item => item.url.endsWith("/setWebhook"));
  assert.ok(setWebhook);
  assert.equal(JSON.parse(setWebhook.body).url, "https://preview.example.com/telegram/webhook");

  const ownerRequest = await postWebhook(
    "111111",
    "/guide_approval 1.0.0 abcdef1234567 https://preview.example.com/guide"
  );
  assert.equal(ownerRequest.status, 200);
  let rows = approvalRows();
  assert.equal(rows.length, 1);
  const first = rows[0];
  assert.equal(first.status, "pending");
  assert.equal(first.deliveryStatus, "sent");
  assert.equal(first.version, "1.0.0");
  assert.equal(first.commit, "abcdef1234567");
  assert.equal(first.previewUrl, "https://preview.example.com/guide");

  const requestMessage = telegramLog().find(item =>
    item.url.endsWith("/sendMessage") &&
    JSON.parse(item.body).chat_id === "222222" &&
    JSON.parse(item.body).text.includes(first.id)
  );
  assert.ok(requestMessage);
  const requestPayload = JSON.parse(requestMessage.body);
  assert.deepEqual(
    requestPayload.reply_markup.keyboard[0].map(button => button.text),
    ["تأیید " + first.id, "عدم تأیید " + first.id]
  );

  await postWebhook("222222", "تأیید " + first.id);
  rows = approvalRows();
  assert.equal(rows[0].status, "approved");
  assert.equal(rows[0].reviewerTelegramId, "222222");
  assert.ok(rows[0].reviewedAt);

  await postWebhook("111111", "/guide_approval 1.0.1 7654321 https://preview.example.com/guide");
  rows = approvalRows();
  assert.equal(rows.length, 2);
  const second = rows[1];

  await postWebhook("333333", "تأیید " + second.id);
  rows = approvalRows();
  assert.equal(rows[1].status, "pending");

  await postWebhook("222222", "عدم تأیید " + second.id);
  await postWebhook("222222", "/guide_note " + second.id + " لطفاً بخش احتیاط‌های مصرف بازبینی شود.");
  rows = approvalRows();
  assert.equal(rows[1].status, "rejected");
  assert.equal(rows[1].reviewNote, "لطفاً بخش احتیاط‌های مصرف بازبینی شود.");

  await postWebhook("111111", "/guide_approval 1.0.2 1234567 https://chaysa.up.railway.app/");
  rows = approvalRows();
  assert.equal(rows.length, 2);

  const forbidden = await postWebhook("222222", "تأیید " + first.id, "222222", "wrong-secret");
  assert.equal(forbidden.status, 403);

  const unauthenticated = await fetch(baseUrl + "/api/admin/guide/approvals");
  assert.equal(unauthenticated.status, 401);
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^chaysa_admin=/);
  const audit = await fetch(baseUrl + "/api/admin/guide/approvals", {
    headers: { Cookie: cookie }
  });
  assert.equal(audit.status, 200);
  const auditRows = await audit.json();
  assert.equal(auditRows.length, 2);
  assert.equal(auditRows[0].status, "rejected");
});

test("bootstrap returns categories, question bank and active products", async () => {
  const response = await fetch(baseUrl + "/api/guide/bootstrap");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.categories.some(item => item.id === "safety"));
  assert.ok(body.questionBank.length >= 8);
  assert.ok(body.products.length > 0);
});

test("product questions are allowed only with a known product and relevant topic", async () => {
  const result = await resolveQuestion({
    category: "products",
    productSku: "1401008",
    question: "میزان کافئین این محصول چقدر است؟"
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.allowed, true);
  assert.equal(new URL(result.body.url).hostname, "www.google.com");
});

test("unrelated public searches are rejected", async () => {
  const result = await resolveQuestion({
    category: "custom",
    question: "قیمت دلار امروز چقدر است؟"
  });
  assert.equal(result.body.allowed, false);
  assert.equal(result.body.reason, "outside_scope");
});

test("medicine interaction requires a named medicine", async () => {
  const result = await resolveQuestion({
    category: "safety",
    productSku: "1401008",
    question: "آیا این محصول با دارو تداخل دارد؟",
    medicine: ""
  });
  assert.equal(result.body.allowed, false);
  assert.equal(result.body.reason, "needs_medicine");
});

test("medicine field rejects personal health context and dosage details", async () => {
  for (const medicine of ["من بیماری قلبی دارم", "warfarin 5 mg"]) {
    const result = await resolveQuestion({
      category: "safety",
      productSku: "1401008",
      question: "آیا این محصول با دارو تداخل دارد؟",
      medicine
    });
    assert.equal(result.body.allowed, false);
    assert.equal(result.body.reason, "needs_medicine");
  }
});

test("medicine interaction builds a limited-source search and safety notice", async () => {
  const result = await resolveQuestion({
    category: "safety",
    productSku: "1401008",
    question: "آیا این محصول با دارو تداخل دارد؟",
    medicine: "warfarin"
  });
  assert.equal(result.body.allowed, true);
  assert.equal(result.body.type, "medical_external_search");
  assert.match(result.body.url, /^https:\/\/www\.google\.com\/search\?/);
  assert.match(decodeURIComponent(result.body.url), /nhs\.uk/);
  assert.match(result.body.notice, /تأیید پزشکی/);
  assert.match(result.body.rule, /بی‌خطر بودن/);
});

test("general safety questions do not require a medicine name", async () => {
  const result = await resolveQuestion({
    category: "safety",
    productSku: "1401008",
    question: "عوارض احتمالی این محصول چیست؟"
  });
  assert.equal(result.body.allowed, true);
  assert.equal(result.body.type, "medical_external_search");
});

test("diagnosis and treatment requests are blocked", async () => {
  const result = await resolveQuestion({
    category: "safety",
    productSku: "1401008",
    question: "آیا این محصول برای درمان بیماری مناسب است؟"
  });
  assert.equal(result.body.allowed, false);
  assert.equal(result.body.reason, "unsafe_medical_request");
});

test("store service questions are allowed", async () => {
  const result = await resolveQuestion({
    category: "services",
    question: "چطور سفارش چایسا را ثبت کنم؟"
  });
  assert.equal(result.body.allowed, true);
  assert.equal(result.body.type, "service_external_search");
});
