const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHealthResearchQueue } = require("../health-research-queue");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chaysa-health-queue-"));
  return {
    dir,
    queue: createHealthResearchQueue(dir),
    writeEvidence: fileName => {
      const evidenceDir = path.join(dir, "health-research-evidence");
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, fileName), Buffer.from("%PDF-1.4\\nfixture\\n%%EOF"));
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
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
    assert.throws(() => f.queue.updateItem(item.id, {
      labelEvidenceStatus: "checked",
      compositionStatus: "checked",
      reviewerName: "بازبین مسئول",
      sources: [{ title: "منبع رسمی", url: "https://example.org/source", sourceType: "official" }],
      status: "approved"
    }), /فایل مدرک برچسب و ترکیبات/);
    f.writeEvidence("11111111-1111-4111-8111-111111111111.pdf");
    f.queue.addEvidence(item.id, {
      type: "label", fileId: "11111111-1111-4111-8111-111111111111",
      fileName: "11111111-1111-4111-8111-111111111111.pdf", originalName: "label.pdf",
      mime: "application/pdf", size: 100, sha256: "a".repeat(64)
    });
    f.writeEvidence("22222222-2222-4222-8222-222222222222.pdf");
    f.queue.addEvidence(item.id, {
      type: "composition", fileId: "22222222-2222-4222-8222-222222222222",
      fileName: "22222222-2222-4222-8222-222222222222.pdf", originalName: "composition.pdf",
      mime: "application/pdf", size: 120, sha256: "b".repeat(64)
    });
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
    f.writeEvidence("66666666-6666-4666-8666-666666666666.pdf");
    f.queue.addEvidence(item.id, {
      type: "label", fileId: "66666666-6666-4666-8666-666666666666",
      fileName: "66666666-6666-4666-8666-666666666666.pdf", originalName: "label.pdf",
      mime: "application/pdf", size: 100, sha256: "d".repeat(64)
    });
    f.writeEvidence("77777777-7777-4777-8777-777777777777.pdf");
    f.queue.addEvidence(item.id, {
      type: "composition", fileId: "77777777-7777-4777-8777-777777777777",
      fileName: "77777777-7777-4777-8777-777777777777.pdf", originalName: "composition.pdf",
      mime: "application/pdf", size: 100, sha256: "e".repeat(64)
    });
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

test("PubMed search returns bounded candidate metadata without auto-saving it", async () => {
  const f = fixture();
  try {
    const item = f.queue.syncCatalog([{ sku: "SKU-PUBMED", name: "زنجبیل", category: "دمنوش", active: true }]).items[0];
    const calls = [];
    const fakeFetch = async url => {
      calls.push(String(url));
      if (String(url).includes("esearch.fcgi")) return {
        ok: true,
        json: async () => ({ esearchresult: { idlist: ["12345678", "not-a-pmid"] } })
      };
      return {
        ok: true,
        json: async () => ({ result: { "12345678": {
          title: "Ginger research title",
          fulljournalname: "Journal of Test Research",
          pubdate: "2025 Jan",
          authors: [{ name: "A. Author" }]
        } } })
      };
    };
    const result = await f.queue.searchPubMed(item.id, "Zingiber officinale", fakeFetch);
    assert.equal(result.query, "Zingiber officinale");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].pmid, "12345678");
    assert.equal(result.candidates[0].url, "https://pubmed.ncbi.nlm.nih.gov/12345678/");
    assert.equal(calls.length, 2);
    assert.equal(f.queue.read().items[0].sources.length, 0);
  } finally { f.cleanup(); }
});

test("PubMed search rejects inactive, missing-SKU and duplicate-SKU products", async () => {
  const f = fixture();
  try {
    const state = f.queue.syncCatalog([
      { sku: "DUP-PUBMED", name: "گیاه اول", category: "چای", active: true },
      { sku: "DUP-PUBMED", name: "گیاه دوم", category: "چای", active: true },
      { sku: "", name: "بدون شناسه", category: "چای", active: true }
    ]);
    const duplicate = state.items.find(x => x.duplicateSku);
    const missing = state.items.find(x => !x.sku);
    await assert.rejects(() => f.queue.searchPubMed(duplicate.id, "plant"), /فقط برای محصول فعال/);
    await assert.rejects(() => f.queue.searchPubMed(missing.id, "plant"), /فقط برای محصول فعال/);
  } finally { f.cleanup(); }
});

test("evidence metadata is private to the queue and requires an active unique SKU", () => {
  const f = fixture();
  try {
    const state = f.queue.syncCatalog([
      { sku: "SKU-EVIDENCE", name: "چای سبز", category: "چای", active: true },
      { sku: "SKU-INACTIVE", name: "چای غیرفعال", category: "چای", active: false }
    ]);
    const active = state.items.find(x => x.sku === "SKU-EVIDENCE");
    const inactive = state.items.find(x => x.sku === "SKU-INACTIVE");
    const meta = {
      type: "label", fileId: "33333333-3333-4333-8333-333333333333",
      fileName: "33333333-3333-4333-8333-333333333333.pdf", originalName: "label.pdf",
      mime: "application/pdf", size: 512, sha256: "c".repeat(64)
    };
    const saved = f.queue.addEvidence(active.id, meta);
    assert.equal(saved.evidence.length, 1);
    assert.equal(saved.labelEvidenceStatus, "received");
    assert.equal(f.queue.getEvidence(meta.fileId).evidence.fileName, meta.fileName);
    assert.equal(f.queue.read().items.find(x => x.id === active.id).status, "queued");
    assert.throws(() => f.queue.addEvidence(inactive.id, { ...meta, fileId: "44444444-4444-4444-8444-444444444444", fileName: "44444444-4444-4444-8444-444444444444.pdf" }), /فقط برای محصول فعال/);
    assert.throws(() => f.queue.addEvidence(active.id, { ...meta, fileId: "55555555-5555-4555-8555-555555555555", fileName: "55555555-5555-4555-8555-555555555555.svg", mime: "image/svg+xml" }), /اطلاعات مدرک/);
  } finally { f.cleanup(); }
});
