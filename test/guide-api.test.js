const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

let child;
let baseUrl;
let dataDir;
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
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: "guide-test-only-password",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_WEBHOOK_SECRET: "",
      TELEGRAM_WEBHOOK_URL: ""
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
