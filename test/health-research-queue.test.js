const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHealthResearchQueue } = require("../health-research-queue");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chaysa-health-queue-"));
  return { dir, queue: createHealthResearchQueue(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("initial active catalog enters a durable SKU research queue", () => {
  const f = fixture();
  try {
    const state = f.queue.syncCatalog([
      { sku: "SKU-1", name: "چای سبز", category: "چای", active: true },
      { sku: "SKU-2", name: "دمنوش به", category: "دمنوش", active: false }
    ]);
    assert.equal(state.items.length, 2);
    assert.equal(state.items.find(x => x.sku === "SKU-1").status, "queued");
    assert.equal(state.items.find(x => x.sku === "SKU-2").status, "archived");
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir, "health-research-queue.json"), "utf8")).items.length, 2);
  } finally { f.cleanup(); }
});

test("new active SKU is queued and deactivated products are archived without deletion", () => {
  const f = fixture();
  try {
    f.queue.syncCatalog([{ sku: "SKU-1", name: "چای سبز", category: "چای", active: true }]);
    let state = f.queue.syncCatalog([
      { sku: "SKU-1", name: "چای سبز", category: "چای", active: false },
      { sku: "SKU-2", name: "دمنوش به", category: "دمنوش", active: true }
    ]);
    assert.equal(state.items.find(x => x.sku === "SKU-1").status, "archived");
    assert.equal(state.items.find(x => x.sku === "SKU-2").status, "queued");
    assert.equal(state.items.length, 2);
  } finally { f.cleanup(); }
});

test("missing and duplicate SKUs are flagged instead of silently treated as unique", () => {
  const f = fixture();
  try {
    const state = f.queue.syncCatalog([
      { sku: "", name: "محصول بدون شناسه", category: "چای", active: true },
      { sku: "DUP", name: "محصول اول", category: "چای", active: true },
      { sku: "DUP", name: "محصول دوم", category: "چای", active: true }
    ]);
    assert.equal(state.items.find(x => !x.sku).status, "needs_sku");
    assert.equal(state.items.filter(x => x.sku === "DUP").every(x => x.duplicateSku && x.status === "review"), true);
  } finally { f.cleanup(); }
});

test("approval requires verified label and composition, a source and a named reviewer", () => {
  const f = fixture();
  try {
    const item = f.queue.syncCatalog([{ sku: "SKU-1", name: "چای سبز", category: "چای", active: true }]).items[0];
    assert.throws(() => f.queue.updateItem(item.id, { status: "approved" }), /تأیید پرونده نیازمند/);
    const updated = f.queue.updateItem(item.id, {
      labelEvidenceStatus: "checked",
      compositionStatus: "checked",
      reviewerName: "بازبین مسئول",
      sources: [{ title: "منبع رسمی", url: "https://example.org/source", sourceType: "official" }],
      status: "approved"
    });
    assert.equal(updated.status, "approved");
    assert.equal(updated.sources.length, 1);
  } finally { f.cleanup(); }
});

test("unsafe or malformed source URLs are rejected", () => {
  const f = fixture();
  try {
    const item = f.queue.syncCatalog([{ sku: "SKU-1", name: "چای سبز", category: "چای", active: true }]).items[0];
    assert.throws(() => f.queue.updateItem(item.id, {
      sources: [{ title: "bad", url: "javascript:alert(1)" }]
    }), /پیوند HTTPS معتبر/);
  } finally { f.cleanup(); }
});

test("queue cannot advance without a SKU or archive an active product", () => {
  const f = fixture();
  try {
    const state = f.queue.syncCatalog([
      { sku: "", name: "بدون شناسه", category: "چای", active: true },
      { sku: "SKU-2", name: "چای فعال", category: "چای", active: true }
    ]);
    const missing = state.items.find(x => !x.sku);
    const active = state.items.find(x => x.sku === "SKU-2");
    assert.throws(() => f.queue.updateItem(missing.id, { status: "researching" }), /تا زمان ثبت SKU معتبر/);
    assert.throws(() => f.queue.updateItem(active.id, { status: "archived" }), /محصول فعال را نمی‌توان/);
    assert.throws(() => f.queue.updateItem(active.id, { status: "needs_sku" }), /محصول SKU دارد/);
  } finally { f.cleanup(); }
});

test("a changed product identity reopens an approved record for update", () => {
  const f = fixture();
  try {
    const item = f.queue.syncCatalog([{ sku: "SKU-3", name: "چای سفید", category: "چای", active: true }]).items[0];
    f.queue.updateItem(item.id, {
      labelEvidenceStatus: "checked",
      compositionStatus: "checked",
      reviewerName: "بازبین",
      sources: [{ title: "مرجع", url: "https://example.org/ref" }],
      status: "approved"
    });
    const changed = f.queue.syncCatalog([{ sku: "SKU-3", name: "چای سفید و گل", category: "چای", active: true }]);
    assert.equal(changed.items[0].status, "needs_update");
  } finally { f.cleanup(); }
});
