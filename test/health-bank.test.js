const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const research = JSON.parse(fs.readFileSync(path.join(root, "data/health/health-product-research.json"), "utf8"));
const page = fs.readFileSync(path.join(root, "health-advisor.html"), "utf8");
const script = fs.readFileSync(path.join(root, "health-bank.js"), "utf8");
const adminPage = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const queue = fs.readFileSync(path.join(root, "health-research-queue.js"), "utf8");

test("CHAYSA HEALTH research inventory counts and draft status are explicit", () => {
  assert.equal(research.status, "research_draft_not_for_customer_answers");
  assert.equal(research.products.length, 47);
  assert.equal(research.liveInventory.totalRecords, 47);
  assert.equal(research.liveInventory.activeRecords, 46);
  assert.equal(research.liveInventory.inactiveRecords, 1);
  assert.equal(research.botanicalProfiles.length, 12);
  assert.equal(research.sources.length, 29);
  assert.equal(research.bookBibliography.length, 28);
});

test("research snapshot matches the live catalog snapshot and contains no orphan SKU record", () => {
  const skus = research.products.map(item => String(item.sku || ""));
  assert.ok(skus.every(Boolean), "every research product must have a SKU");
  assert.equal(new Set(skus).size, skus.length, "research product SKUs must be unique");
  assert.deepEqual(research.liveInventory.duplicateSkuRecords, []);
  assert.equal(research.liveInventory.byCategory["چای"].total, 24);
  assert.equal(research.liveInventory.byCategory["دمنوش"].total, 14);
  assert.equal(research.liveInventory.byCategory["ادویه"].total, 9);
  assert.ok(research.liveInventory.catalogLimitations.some(item => item.includes("snapshot")));
});

test("every source has a Persian research-scope summary", () => {
  for (const source of research.sources) {
    assert.ok(Array.isArray(source.supportsFa) && source.supportsFa.length, source.id + " must have a Persian summary");
  }
});

test("all botanical source references resolve to the registered source catalogue", () => {
  const ids = new Set(research.sources.map(item => item.id));
  for (const profile of research.botanicalProfiles) {
    assert.ok(Array.isArray(profile.sourceIds), profile.commonName + " must declare source IDs");
    for (const id of profile.sourceIds) assert.ok(ids.has(id), profile.commonName + " references missing source " + id);
  }
});

test("all public research links use HTTPS", () => {
  for (const item of research.sources) assert.equal(new URL(item.url).protocol, "https:");
  for (const item of research.bookBibliography) {
    if (item.catalogueUrl) assert.equal(new URL(item.catalogueUrl).protocol, "https:");
  }
});

test("the four existing CHAYSA HEALTH tiles open their matching research sections", () => {
  for (const id of ["products", "interactions", "safety", "sources"]) {
    assert.match(page, new RegExp('data-health-bank-tab="' + id + '"'));
  }
  assert.doesNotMatch(page, /<button[^>]*disabled[^>]*>Scientific Sources/);
  assert.match(page, /id="chaysaResearchBank"/);
  assert.match(page, /src="\/health-bank\.js"/);
});

test("research browser reads the live catalogue and excludes inactive products", () => {
  assert.match(script, /fetch\("\/api\/products"/);
  assert.match(script, /p\.active !== false/);
  assert.match(script, /p\.active === false/);
  assert.match(script, /data\/health\/health-product-research\.json/);
});

test("research browser renders untrusted data as text and validates outbound links", () => {
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.match(script, /textContent/);
  assert.match(script, /noopener noreferrer/);
  assert.match(script, /function safeUrl/);
});

test("the customer-facing research view does not expose internal research gaps", () => {
  assert.doesNotMatch(script, /researchGaps/);
  assert.match(script, /bookBibliographyDisclaimer/);
  assert.match(script, /disclaimer/);
});

test("customer-facing health content states the information accuracy policy", () => {
  assert.match(research.disclaimer, /تا حد امکان به‌روز/);
  assert.match(research.disclaimer, /صحت نهایی مطالب را تضمین نمی‌کند/);
  assert.match(research.disclaimer, /مسئولیت صحت آن‌ها را بر عهده نمی‌گیرد/);
  assert.match(page, /صحت نهایی مطالب را تضمین نمی‌کند/);
  assert.match(page, /مسئولیت صحت آن‌ها را بر عهده نمی‌گیرد/);
  assert.match(page, /کتابخانه پژوهشی اولیه در دسترس است/);
  assert.match(page, /برای مشاهده اطلاعات پژوهشی اولیه، یکی از بخش‌ها را انتخاب کنید/);
  assert.doesNotMatch(page, /دسترسی‌ها پس از تکمیل و تأیید فعال می‌شوند/);
});

test("admin panel exposes a protected SKU research queue without changing product business rules", () => {
  assert.match(adminPage, /data-view="healthResearchView"/);
  assert.match(adminPage, /function loadHealthResearchQueue/);
  assert.match(adminPage, /api\('health-research\/queue'/);
  assert.match(server, /app\.get\("\/api\/admin\/health-research\/queue", requireAdmin/);
  assert.match(server, /app\.patch\("\/api\/admin\/health-research\/queue\/:id", requireAdmin/);
  assert.match(server, /healthResearchQueue\.syncCatalog\(req\.body\)/);
  assert.match(server, /saveProducts\(req\.body\)/);
});

test("free PubMed discovery is admin-only, rate-limited and explicitly non-publishing", () => {
  assert.match(adminPage, /جست‌وجوی رایگان در PubMed/);
  assert.match(adminPage, /افزودن به فهرست منابع/);
  assert.match(server, /app\.post\("\/api\/admin\/health-research\/queue\/:id\/suggestions", requireAdmin/);
  assert.match(server, /healthResearchQueue\.searchPubMed/);
  assert.match(server, /health-research-suggestions:/);
  assert.match(server, /به‌صورت خودکار به پرونده افزوده یا منتشر نمی‌شوند/);
});

test("research evidence files are private, size-limited, signature-checked and admin-only", () => {
  assert.match(server, /HEALTH_RESEARCH_EVIDENCE_DIR/);
  assert.match(server, /healthResearchEvidenceUpload\.single\("evidence"\)/);
  assert.match(server, /fileSize: 10 \* 1024 \* 1024/);
  assert.match(server, /isSupportedResearchEvidence/);
  assert.match(server, /app\.get\("\/api\/admin\/health-research\/evidence\/:id", requireAdmin/);
  assert.match(server, /Content-Disposition", "attachment/);
  assert.match(server, /healthResearchQueue\.addEvidence/);
  assert.match(queue, /evidence\.some\(row => row\.type === "label" && evidenceFileExists\(row\)\)/);
  assert.match(queue, /evidence\.some\(row => row\.type === "composition" && evidenceFileExists\(row\)\)/);
  assert.match(queue, /evidenceFileExists/);
  assert.match(queue, /محصول غیرفعال یا حذف‌شده وارد مراحل فعال پژوهش نمی‌شود/);
  assert.match(queue, /SKU تکراری تا زمان رفع تعارض/);
  assert.match(adminPage, /addEvidenceUpload\('label'/);
  assert.match(adminPage, /addEvidenceUpload\('composition'/);
});
