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
let rubikaMockLog;
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
  rubikaMockLog = path.join(dataDir, "rubika-mock.jsonl");
  writeFileSync(mockLog, "", "utf8");
  writeFileSync(rubikaMockLog, "", "utf8");
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: "guide-test-only-password",
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      RUBIKA_BOT_TOKEN: "test-rubika-token",
      RUBIKA_WEBHOOK_URL: "https://preview.example.com/rubika/webhook/test",
      RUBIKA_MOCK_LOG: rubikaMockLog,
      TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
      TELEGRAM_WEBHOOK_URL: "https://preview.example.com/telegram/webhook",
      CHAYSA_OWNER_CHAT_ID: "111111",
      CHAYSA_BOSTANI_CHAT_ID: "222222",
      ORDER_CHAT_IDS: "111111,222222",
      TELEGRAM_MOCK_FAIL_ORDER_CHAT_IDS: "222222",
      CHAYSA_GUIDE_REVIEW_HOST: "preview.example.com",
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
  assert.equal(first.reviewUrl, "https://preview.example.com/guide");

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


test("CHAYSA HEALTH approval link is delivered privately, one-time and archived automatically", async () => {
  const unauthorized = await fetch(baseUrl + "/api/admin/health-approval/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(unauthorized.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^chaysa_admin=/);

  const send = await fetch(baseUrl + "/api/admin/health-approval/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: "{}"
  });
  assert.equal(send.status, 201);
  const sent = await send.json();
  assert.equal(sent.deliveryStatus, "sent");

  const messages = telegramLog().filter(item => item.url.endsWith("/sendMessage"));
  const letterMessage = messages.map(item => JSON.parse(item.body)).find(body =>
    String(body.chat_id) === "222222" &&
    body.text.includes("/health-approval.html#")
  );
  assert.ok(letterMessage, "the private approval link must be sent to Bostani's configured chat");
  const link = letterMessage.text.match(/https:\/\/chaysa\.up\.railway\.app\/health-approval\.html#([A-Za-z0-9_-]+)/);
  assert.ok(link);
  const token = link[1];
  assert.equal(token.length, 43);

  const page = await fetch(baseUrl + "/health-approval.html");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /تأیید می‌شود/);

  const view = await fetch(baseUrl + "/api/health-approval/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  assert.equal(view.status, 200);
  const letter = await view.json();
  assert.match(letter.letter, /بانک اطلاعاتی جامع و پویا/);
  assert.match(letter.letter, /تداخلات احتمالی/);

  const missingName = await fetch(baseUrl + "/api/health-approval/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, decision: "نیاز به اصلاح دارد", note: "لطفاً هشدارهای ایمنی تکمیل شود." })
  });
  assert.equal(missingName.status, 400);

  const invalidName = await fetch(baseUrl + "/api/health-approval/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, reviewerName: "خانم بستانی 123", decision: "نیاز به اصلاح دارد" })
  });
  assert.equal(invalidName.status, 400);

  const decision = await fetch(baseUrl + "/api/health-approval/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, reviewerName: "خانم بستانی", decision: "نیاز به اصلاح دارد", note: "لطفاً هشدارهای ایمنی تکمیل شود." })
  });
  assert.equal(decision.status, 200);
  const result = await decision.json();
  assert.ok(result.archiveRecordId);
  assert.equal(result.reviewerName, "خانم بستانی");
  assert.ok(result.recordedAt);

  const archiveResponse = await fetch(baseUrl + "/api/admin/health-archive", {
    headers: { Cookie: cookie }
  });
  assert.equal(archiveResponse.status, 200);
  const archive = await archiveResponse.json();
  const record = archive.find(item => item.id === result.archiveRecordId);
  assert.ok(record);
  assert.equal(record.decision, "نیاز به اصلاح دارد");
  assert.equal(record.reviewerName, "خانم بستانی");
  assert.equal(record.evidenceType, "online_decision");
  assert.equal(record.evidenceFile, undefined);
  assert.match(record.reviewerIdentityNote, /احراز هویت حقوقی/);

  const notifications = telegramLog().filter(item => {
    if (!item.url.endsWith("/sendMessage")) return false;
    const body = JSON.parse(item.body);
    return body.text.includes("نتیجه بررسی بخش CHAYSA HEALTH در بایگانی ثبت شد");
  }).map(item => String(JSON.parse(item.body).chat_id));
  assert.ok(notifications.includes("111111"));
  assert.ok(notifications.includes("222222"));

  const replay = await fetch(baseUrl + "/api/health-approval/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, reviewerName: "خانم بستانی", decision: "تأیید می‌شود" })
  });
  assert.equal(replay.status, 409);
});


async function postLetterReceiptCallback(callbackData, chatId = "222222", callbackId = "letter-callback-test") {
  return fetch(baseUrl + "/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({
      callback_query: {
        id: callbackId,
        from: { id: Number(chatId), username: "test_user" },
        message: { message_id: 987, chat: { id: Number(chatId), type: "private" } },
        data: callbackData
      }
    })
  });
}

test("archive-only letter is stored with its title and no delivery attempt", async () => {
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const before = telegramLog().length;
  const response = await fetch(baseUrl + "/api/admin/letters/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "عنوان آزمون بایگانی", text: "" })
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.archivedOnly, true);
  const rows = JSON.parse(readFileSync(path.join(dataDir, "letters-archive.json"), "utf8"));
  const row = rows.find(item => item.letterNumber === result.letterNumber);
  assert.ok(row);
  assert.equal(row.title, "عنوان آزمون بایگانی");
  assert.equal(row.deliveryStatus, "not_sent");
  assert.equal(row.body, "");
  assert.equal(telegramLog().length, before);
  const denied = await fetch(baseUrl + "/api/admin/letters/archive", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "غیرمجاز" })
  });
  assert.equal(denied.status, 401);
});

test("general letters use a direct Telegram inline receipt button", async () => {
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const send = await fetch(baseUrl + "/api/admin/letters/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ text: "متن آزمایشی نامه برای آزمون دکمه تلگرام" })
  });
  assert.equal(send.status, 201);
  const sent = await send.json();
  assert.equal(sent.deliveryStatus, "sent");

  const messages = telegramLog().filter(item => item.url.endsWith("/sendMessage"))
    .map(item => JSON.parse(item.body))
    .filter(body => body.text.includes("متن آزمایشی نامه برای آزمون دکمه تلگرام"));
  assert.equal(messages.length, 2);
  for (const message of messages) {
    assert.match(message.text, /آیا نامه را دریافت کرده‌اید؟/);
    assert.doesNotMatch(message.text, /letter-receipt\.html|https:\/\//);
    assert.equal(message.reply_markup.inline_keyboard[0][0].text, "بله، دریافت کردم");
    assert.match(message.reply_markup.inline_keyboard[0][0].callback_data, /^lr:[A-Za-z0-9_-]{43}$/);
  }

  const callbackData = messages[0].reply_markup.inline_keyboard[0][0].callback_data;
  const archivePath = path.join(dataDir, "letters-archive.json");
  let archive = JSON.parse(readFileSync(archivePath, "utf8"));
  let sentRecord = archive.find(item => item.body === "متن آزمایشی نامه برای آزمون دکمه تلگرام");
  assert.ok(sentRecord);
  assert.equal(sentRecord.receiptStatus, "pending");

  const callback = await postLetterReceiptCallback(callbackData);
  assert.equal(callback.status, 200);
  archive = JSON.parse(readFileSync(archivePath, "utf8"));
  sentRecord = archive.find(item => item.body === "متن آزمایشی نامه برای آزمون دکمه تلگرام");
  assert.ok(sentRecord);
  assert.equal(sentRecord.receiptStatus, "received");
  assert.equal(sentRecord.receiptMethod, "telegram_inline_button");
  assert.equal(sentRecord.receivedByTelegramId, "222222");
  assert.ok(sentRecord.receivedAt);

  const callbackCalls = telegramLog().filter(item =>
    item.url.endsWith("/answerCallbackQuery") || item.url.endsWith("/editMessageReplyMarkup")
  );
  assert.ok(callbackCalls.some(item => item.url.endsWith("/answerCallbackQuery")));
  assert.ok(callbackCalls.some(item => item.url.endsWith("/editMessageReplyMarkup")));
  const receivedAt = sentRecord.receivedAt;
  await postLetterReceiptCallback(callbackData, "222222", "letter-callback-replay");
  archive = JSON.parse(readFileSync(archivePath, "utf8"));
  sentRecord = archive.find(item => item.body === "متن آزمایشی نامه برای آزمون دکمه تلگرام");
  assert.equal(sentRecord.receivedAt, receivedAt);

  await postLetterReceiptCallback(callbackData, "333333", "letter-callback-unauthorized");
  archive = JSON.parse(readFileSync(archivePath, "utf8"));
  sentRecord = archive.find(item => item.body === "متن آزمایشی نامه برای آزمون دکمه تلگرام");
  assert.equal(sentRecord.receivedByTelegramId, "222222");
});


test("Order is stored and Telegram delivery status is explicit when one recipient rejects the invoice", async () => {
  const payload = {
    customer: {
      name: "آزمون", family: "خریدار", contact: "09120000000",
      messengerPlatform: "telegram", messengerId: "123456789", province: "تهران", city: "تهران",
      address: "نشانی آزمایشی", postal: "1234567890", notes: "ندارد"
    },
    items: [{ sku: "1401008", qty: 2 }],
    termsAccepted: true,
    termsAcceptedAt: new Date().toISOString()
  };
  const response = await fetch(baseUrl + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.ok(result.orderId);
  assert.equal(result.notificationStatus, "partial");
  assert.equal(result.delivered, 1);
  assert.equal(result.recipientCount, 2);
  assert.equal(result.notificationStatusSaved, true);
  assert.match(result.invoice, /جمع کل:/);

  const saved = JSON.parse(readFileSync(path.join(dataDir, "orders.json"), "utf8"));
  const order = saved.find(item => item.id === result.orderId);
  assert.ok(order);
  assert.equal(order.total, 958000);
  assert.equal(order.notification.status, "partial");
  assert.equal(order.notification.delivered, 1);
  assert.equal(order.notification.recipientCount, 2);
  assert.ok(order.notification.attemptedAt);

  const unauthenticated = await fetch(baseUrl + "/api/admin/orders");
  assert.equal(unauthenticated.status, 401);
  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const adminOrders = await fetch(baseUrl + "/api/admin/orders", {
    headers: { Cookie: cookie }
  });
  assert.equal(adminOrders.status, 200);
  const rows = await adminOrders.json();
  const visible = rows.find(item => item.id === result.orderId);
  assert.equal(visible.notification.status, "partial");
});


test("Order accepts Rubika as the selected customer messaging channel and stores it", async () => {
  const payload = {
    customer: {
      name: "آزمون روبیکا", family: "خریدار", contact: "09120000001",
      messengerPlatform: "rubika", messengerId: "u0QFtn01dd26d72abc5c77b8e116cd79",
      province: "تهران", city: "تهران", address: "نشانی آزمایشی",
      postal: "1234567890", notes: "ندارد"
    },
    items: [{ sku: "1401008", qty: 1 }],
    termsAccepted: true,
    termsAcceptedAt: new Date().toISOString()
  };
  const response = await fetch(baseUrl + "/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  const saved = JSON.parse(readFileSync(path.join(dataDir, "orders.json"), "utf8"));
  const order = saved.find(item => item.id === result.orderId);
  assert.ok(order);
  assert.equal(order.customer.messengerPlatform, "rubika");
  assert.equal(order.customer.messengerId, "u0QFtn01dd26d72abc5c77b8e116cd79");
  assert.equal(result.customerDeliveryStatus, "sent");
  assert.equal(result.customerDeliveryStatusSaved, true);
  assert.equal(order.customerDelivery.status, "sent");
});


test("Rubika webhook reveals the real chat ID on /start", async () => {
  const crypto = require("node:crypto");
  const key = crypto.createHash("sha256").update("CHAYSA-RUBIKA-WEBHOOK-V1:test-rubika-token").digest("hex").slice(0, 40);
  const chatId = "u0QFtn01dd26d72abc5c77b8e116cd79";
  const webhook = await fetch(baseUrl + "/rubika/webhook/" + key, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "NewMessage", chat_id: chatId,
      new_message: { sender_type: "User", sender_id: chatId, text: "/start" } })
  });
  assert.equal(webhook.status, 200);
  const calls = readFileSync(rubikaMockLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  const welcome = calls.find(item => item.url.endsWith("/sendMessage") && JSON.parse(item.body).text.includes("شناسه گفت‌وگوی شما"));
  assert.ok(welcome);
  assert.match(JSON.parse(welcome.body).text, /شناسه گفت‌وگوی شما/);
  assert.match(JSON.parse(welcome.body).text, new RegExp(chatId));
});


test("Rubika webhook handles StartedBot and nested update envelopes", async () => {
  const crypto = require("node:crypto");
  const key = crypto.createHash("sha256").update("CHAYSA-RUBIKA-WEBHOOK-V1:test-rubika-token").digest("hex").slice(0, 40);
  const chatId = "u0QFtn01dd26d72abc5c77b8e116cd79";
  const before = readFileSync(rubikaMockLog, "utf8").split("\n").filter(Boolean).length;

  const started = await fetch(baseUrl + "/rubika/webhook/" + key, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update: { type: "StartedBot", chat_id: chatId } })
  });
  assert.equal(started.status, 200);

  const nestedMessage = await fetch(baseUrl + "/rubika/webhook/" + key, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { update: {
      type: "NewMessage", chat_id: chatId,
      new_message: { sender_type: "User", sender_id: chatId, text: "/start" }
    } } })
  });
  assert.equal(nestedMessage.status, 200);

  const calls = readFileSync(rubikaMockLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  const welcomeCalls = calls.slice(before).filter(item =>
    item.url.endsWith("/sendMessage") && JSON.parse(item.body).text.includes("شناسه گفت‌وگوی شما")
  );
  assert.equal(welcomeCalls.length, 2);
  for (const item of welcomeCalls) assert.match(JSON.parse(item.body).text, new RegExp(chatId));
});

test("Rubika webhook registration uses ReceiveUpdate and accepts the documented Done result", async () => {
  const calls = readFileSync(rubikaMockLog, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  const registration = calls.find(item => item.url.endsWith("/updateBotEndpoints"));
  assert.ok(registration);
  assert.deepEqual(JSON.parse(registration.body).type, "ReceiveUpdate");
  assert.equal(new URL(JSON.parse(registration.body).url).hostname, "preview.example.com");
});

test("Order rejects an unsupported customer messaging channel", async () => {
  const payload = {
    customer: {
      name: "آزمون", family: "خریدار", contact: "09120000002",
      messengerPlatform: "unsupported", messengerId: "test-chat",
      province: "تهران", city: "تهران", address: "نشانی آزمایشی",
      postal: "1234567890", notes: "ندارد"
    },
    items: [{ sku: "1401008", qty: 1 }],
    termsAccepted: true,
    termsAcceptedAt: new Date().toISOString()
  };
  const response = await fetch(baseUrl + "/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /تلگرام یا روبیکا/);
});


test("Rubika webhook registration failure logs safe response metadata without secrets or response text", async () => {
  const port = await reservePort();
  const diagnosticDir = mkdtempSync(path.join(os.tmpdir(), "chaysa-rubika-diagnostic-test-"));
  const diagnosticLog = path.join(diagnosticDir, "rubika-mock.jsonl");
  writeFileSync(diagnosticLog, "", "utf8");
  let diagnosticChild;
  let diagnosticOutput = "";
  try {
    diagnosticChild = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: diagnosticDir,
        ADMIN_PASSWORD: "diagnostic-test-only-password",
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_WEBHOOK_SECRET: "",
        RUBIKA_BOT_TOKEN: "diagnostic-test-token",
        RUBIKA_WEBHOOK_URL: "https://preview.example.com/rubika/webhook/diagnostic-secret-path",
        RUBIKA_MOCK_LOG: diagnosticLog,
        RUBIKA_MOCK_REGISTRATION_MODE: "api-error",
        NODE_OPTIONS: "--require " + path.join(__dirname, "mock-telegram-fetch.js")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    diagnosticChild.stdout.on("data", chunk => { diagnosticOutput += chunk.toString(); });
    diagnosticChild.stderr.on("data", chunk => { diagnosticOutput += chunk.toString(); });

    for (let attempt = 0; attempt < 100; attempt++) {
      if (diagnosticOutput.includes("Rubika webhook registration: failed")) break;
      if (diagnosticChild.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } finally {
    if (diagnosticChild && diagnosticChild.exitCode === null) {
      diagnosticChild.kill("SIGTERM");
      await new Promise(resolve => diagnosticChild.once("exit", resolve));
    }
    rmSync(diagnosticDir, { recursive: true, force: true });
  }

  assert.match(diagnosticOutput, /http=200 api=ERROR data=Rejected code=4321/);
  assert.doesNotMatch(diagnosticOutput, /sensitive response text|diagnostic-test-token|diagnostic-secret-path/);
});


test("Storefront HTML and Iran location JSON require cache revalidation", async () => {
  for (const route of ["/products.html", "/iran-locations.json"]) {
    const response = await fetch(baseUrl + route);
    assert.equal(response.status, 200, route + " should be served");
    const cacheControl = response.headers.get("cache-control") || "";
    assert.match(cacheControl, /no-cache/i, route + " must not be served as a fresh cached copy");
    assert.match(cacheControl, /must-revalidate/i, route + " must be revalidated");
  }
});

let orderTestIp = 1;
function validOrderPayload(platform = "telegram", messengerId = "333333") {
  return {
    customer: {
      name: "آزمون", family: "خریدار", contact: "09120000000",
      messengerPlatform: platform, messengerId,
      province: "تهران", city: "تهران", address: "نشانی آزمایشی",
      postal: "1234567890", notes: "بدون توضیح"
    },
    termsAccepted: true,
    termsAcceptedAt: new Date().toISOString(),
    items: [{ sku: "1401008", qty: 1 }]
  };
}

async function postOrder(payload) {
  const response = await fetch(baseUrl + "/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100." + (orderTestIp++) },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

function orderRows() {
  const file = path.join(dataDir, "orders.json");
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (_) { return []; }
}

test("invalid Telegram chat ID is rejected before any order is persisted or invoice is sent", async () => {
  const beforeOrders = orderRows().length;
  const beforeMessages = telegramLog().filter(item => {
    if (!item.url.endsWith("/sendMessage")) return false;
    return String(JSON.parse(item.body).text || "").startsWith("فاکتور سفارش چایسا");
  }).length;
  const result = await postOrder(validOrderPayload("telegram", "@not-a-numeric-chat"));
  assert.equal(result.status, 400);
  assert.match(result.body.error, /شناسه گفت‌وگوی تلگرام معتبر نیست/);
  assert.equal(orderRows().length, beforeOrders);
  const afterMessages = telegramLog().filter(item => {
    if (!item.url.endsWith("/sendMessage")) return false;
    return String(JSON.parse(item.body).text || "").startsWith("فاکتور سفارش چایسا");
  }).length;
  assert.equal(afterMessages, beforeMessages);
});

test("invalid Rubika chat ID is rejected before any order is persisted or invoice is sent", async () => {
  const beforeOrders = orderRows().length;
  const beforeMessages = telegramLog().filter(item => {
    if (!item.url.endsWith("/sendMessage")) return false;
    return String(JSON.parse(item.body).text || "").startsWith("فاکتور سفارش چایسا");
  }).length;
  const result = await postOrder(validOrderPayload("rubika", "invalid-id"));
  assert.equal(result.status, 400);
  assert.match(result.body.error, /شناسه گفت‌وگوی روبیکا معتبر نیست/);
  assert.equal(orderRows().length, beforeOrders);
  const afterMessages = telegramLog().filter(item => {
    if (!item.url.endsWith("/sendMessage")) return false;
    return String(JSON.parse(item.body).text || "").startsWith("فاکتور سفارش چایسا");
  }).length;
  assert.equal(afterMessages, beforeMessages);
});

test("valid order still persists and sends the invoice through the selected messenger", async () => {
  const beforeOrders = orderRows().length;
  const result = await postOrder(validOrderPayload("rubika", "RubikaChat_123456"));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(orderRows().length, beforeOrders + 1);
  const savedOrder = orderRows().at(-1);
  assert.equal(savedOrder.customer.messengerPlatform, "rubika");
  assert.equal(savedOrder.customerDelivery.status, "sent");
  assert.equal(result.body.customerDeliveryStatus, "sent");
});


test("health research queue is admin-only and follows catalog additions and deactivation", async () => {
  const unauthorized = await fetch(baseUrl + "/api/admin/health-research/queue");
  assert.equal(unauthorized.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const initial = await fetch(baseUrl + "/api/admin/health-research/queue", { headers: { Cookie: cookie } });
  assert.equal(initial.status, 200);
  const initialQueue = await initial.json();
  assert.ok(initialQueue.items.length > 0);

  const catalogResponse = await fetch(baseUrl + "/api/admin/products", { headers: { Cookie: cookie } });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  const testProduct = { sku: "TEST-HEALTH-QUEUE-01", name: "محصول آزمایشی صف پژوهش", category: "چای", price: 1000, active: true };
  const saved = await fetch(baseUrl + "/api/admin/products", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify([...catalog, testProduct])
  });
  assert.equal(saved.status, 200);
  const savedResult = await saved.json();
  assert.equal(savedResult.researchQueue.active, catalog.filter(item => item.active !== false).length + 1);

  const queuedResponse = await fetch(baseUrl + "/api/admin/health-research/queue", { headers: { Cookie: cookie } });
  const queued = await queuedResponse.json();
  const item = queued.items.find(row => row.sku === testProduct.sku);
  assert.ok(item);
  assert.equal(item.status, "queued");

  const updated = await fetch(baseUrl + "/api/admin/health-research/queue/" + encodeURIComponent(item.id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ status: "researching", notes: "آزمون اتصال صف به کاتالوگ" })
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).item.status, "researching");

  const removedFromCatalog = await fetch(baseUrl + "/api/admin/products", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(catalog)
  });
  assert.equal(removedFromCatalog.status, 200);
  const archivedResponse = await fetch(baseUrl + "/api/admin/health-research/queue", { headers: { Cookie: cookie } });
  const archived = await archivedResponse.json();
  const archivedItem = archived.items.find(row => row.sku === testProduct.sku);
  assert.ok(archivedItem);
  assert.equal(archivedItem.catalogActive, false);
  assert.equal(archivedItem.status, "archived");
});


test("PubMed candidate endpoint is admin-only and never saves candidates automatically", async () => {
  const unauthorized = await fetch(baseUrl + "/api/admin/health-research/queue/not-real/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Zingiber officinale" })
  });
  assert.equal(unauthorized.status, 401);

  const login = await fetch(baseUrl + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "guide-test-only-password" })
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const queueResponse = await fetch(baseUrl + "/api/admin/health-research/queue", { headers: { Cookie: cookie } });
  const queue = await queueResponse.json();
  const item = queue.items.find(row => row.catalogActive && row.sku && !row.duplicateSku);
  assert.ok(item);

  const response = await fetch(baseUrl + "/api/admin/health-research/queue/" + encodeURIComponent(item.id) + "/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ query: "Zingiber officinale" })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].pmid, "12345678");
  assert.match(result.notice, /سرنخ جست‌وجوی اولیه/);

  const refreshed = await fetch(baseUrl + "/api/admin/health-research/queue", { headers: { Cookie: cookie } });
  const after = await refreshed.json();
  const unchanged = after.items.find(row => row.id === item.id);
  assert.equal(unchanged.sources.length, 0);
});
