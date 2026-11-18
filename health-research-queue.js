"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STATUSES = new Set(["needs_sku", "queued", "researching", "review", "approved", "needs_update", "archived"]);
const EVIDENCE = new Set(["missing", "received", "checked"]);

function normalizeSku(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function stableId(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
}
function safeText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function createHealthResearchQueue(dataDir) {
  const file = path.join(dataDir, "health-research-queue.json");
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value && value.schemaVersion === 1 && Array.isArray(value.items)) return value;
    } catch (_) {}
    return { schemaVersion: 1, createdAt: new Date().toISOString(), syncedAt: null, items: [] };
  }
  function write(value) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function syncCatalog(products) {
    if (!Array.isArray(products)) throw new Error("فهرست محصولات معتبر نیست.");
    const state = read();
    const now = new Date().toISOString();
    const counts = new Map();
    products.forEach(product => {
      if (!product || product.active !== true) return;
      const sku = normalizeSku(product.sku);
      if (sku) counts.set(sku, (counts.get(sku) || 0) + 1);
    });
    const seen = new Set();
    for (const product of products) {
      if (!product || typeof product !== "object") continue;
      const sku = normalizeSku(product.sku);
      const name = safeText(product.name, 180);
      const category = safeText(product.category, 80);
      if (!name) continue;
      const key = sku ? "sku:" + sku : "missing:" + stableId(name.toLocaleLowerCase("fa") + "|" + category);
      const id = stableId(key);
      seen.add(id);
      let item = state.items.find(row => row.id === id);
      const active = product.active === true;
      const duplicateSku = Boolean(sku && active && counts.get(sku) > 1);
      if (!item) {
        item = {
          id, key, sku, productName: name, category, catalogActive: active,
          duplicateSku, duplicateProductNames: duplicateSku ? products.filter(row => row && row.active === true && normalizeSku(row.sku) === sku).map(row => safeText(row.name, 180)) : [],
          status: !sku ? "needs_sku" : duplicateSku ? "review" : active ? "queued" : "archived",
          labelEvidenceStatus: "missing", compositionStatus: "missing",
          sources: [], notes: "", reviewerName: "", reviewNote: "",
          createdAt: now, updatedAt: now, lastSeenAt: now
        };
        state.items.push(item);
        continue;
      }
      const identityChanged = item.productName !== name || item.category !== category;
      const wasActive = item.catalogActive !== false;
      item.productName = name;
      item.category = category;
      item.sku = sku;
      item.catalogActive = active;
      item.duplicateSku = duplicateSku;
      item.duplicateProductNames = duplicateSku ? products.filter(row => row && row.active === true && normalizeSku(row.sku) === sku).map(row => safeText(row.name, 180)) : [];
      item.lastSeenAt = now;
      if (!sku) item.status = "needs_sku";
      else if (duplicateSku) item.status = "review";
      else if (!active) item.status = "archived";
      else if (!wasActive || item.status === "archived") item.status = "queued";
      else if (identityChanged && item.status !== "queued") item.status = "needs_update";
      item.updatedAt = now;
    }
    for (const item of state.items) {
      if (!seen.has(item.id) && item.catalogActive !== false) {
        item.catalogActive = false;
        item.status = "archived";
        item.updatedAt = now;
      }
    }
    state.syncedAt = now;
    write(state);
    return state;
  }
  async function searchPubMed(id, query, fetchImpl = global.fetch) {
    const item = read().items.find(row => row.id === id);
    if (!item) throw new Error("پرونده پژوهشی پیدا نشد.");
    if (!item.catalogActive || !item.sku || item.duplicateSku) throw new Error("جست‌وجوی منبع فقط برای محصول فعال با SKU یکتا انجام می‌شود.");
    const term = safeText(query, 180);
    if (!term) throw new Error("عبارت جست‌وجو را وارد کنید.");
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.search = new URLSearchParams({ db: "pubmed", retmode: "json", retmax: "8", term: term + "[Title/Abstract]" }).toString();
    const searchResponse = await fetchImpl(searchUrl.href, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!searchResponse.ok) throw new Error("دریافت نتایج PubMed با خطا روبه‌رو شد.");
    const searchData = await searchResponse.json();
    const ids = (((searchData || {}).esearchresult || {}).idlist || []).filter(value => /^\d+$/.test(String(value))).slice(0, 8);
    if (!ids.length) return { query: term, candidates: [] };
    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.search = new URLSearchParams({ db: "pubmed", retmode: "json", id: ids.join(",") }).toString();
    const summaryResponse = await fetchImpl(summaryUrl.href, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!summaryResponse.ok) throw new Error("دریافت مشخصات مقالات PubMed با خطا روبه‌رو شد.");
    const summaryData = await summaryResponse.json();
    const result = (summaryData || {}).result || {};
    const candidates = ids.map(pmid => {
      const record = result[pmid] || {};
      return {
        pmid,
        title: safeText(record.title, 500),
        journal: safeText(record.fulljournalname || record.source, 240),
        pubDate: safeText(record.pubdate, 80),
        authors: Array.isArray(record.authors) ? record.authors.slice(0, 4).map(author => safeText(author && author.name, 100)).filter(Boolean) : [],
        url: "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/"
      };
    }).filter(candidate => candidate.title);
    return { query: term, candidates };
  }
  function addEvidence(id, evidence) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("مشخصات مدرک معتبر نیست.");
    const state = read();
    const item = state.items.find(row => row.id === id);
    if (!item) throw new Error("پرونده پژوهشی پیدا نشد.");
    if (!item.catalogActive || !item.sku || item.duplicateSku) throw new Error("ثبت مدرک فقط برای محصول فعال با SKU یکتا مجاز است.");
    const type = ["label", "composition", "other"].includes(evidence.type) ? evidence.type : "";
    const fileId = safeText(evidence.fileId, 36);
    const fileName = safeText(evidence.fileName, 100);
    const mime = safeText(evidence.mime, 80);
    const size = Number(evidence.size);
    const sha256 = safeText(evidence.sha256, 64);
    const originalName = safeText(evidence.originalName, 180);
    if (!type || !/^[0-9a-f-]{36}$/i.test(fileId) || !/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/i.test(fileName) ||
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime) ||
        !Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha256) || !originalName)
      throw new Error("اطلاعات مدرک یا فرمت فایل معتبر نیست.");
    item.evidence = Array.isArray(item.evidence) ? item.evidence : [];
    if (item.evidence.length >= 20) throw new Error("تعداد مدارک این پرونده به سقف مجاز رسیده است.");
    item.evidence.push({ id: fileId, type, fileName, originalName, mime, size, sha256, uploadedAt: new Date().toISOString() });
    if (type === "label" && item.labelEvidenceStatus === "missing") item.labelEvidenceStatus = "received";
    if (type === "composition" && item.compositionStatus === "missing") item.compositionStatus = "received";
    if (item.status === "approved") item.status = "needs_update";
    item.updatedAt = new Date().toISOString();
    write(state);
    return item;
  }
  function getEvidence(fileId) {
    if (typeof fileId !== "string" || !/^[0-9a-f-]{36}$/i.test(fileId)) return null;
    for (const item of read().items) {
      const evidence = (item.evidence || []).find(row => row.id === fileId);
      if (evidence) return { itemId: item.id, evidence };
    }
    return null;
  }
  function updateItem(id, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("درخواست ویرایش معتبر نیست.");
    const state = read();
    const item = state.items.find(row => row.id === id);
    if (!item) throw new Error("پرونده پژوهشی پیدا نشد.");
    if (patch.status !== undefined && !STATUSES.has(patch.status)) throw new Error("وضعیت انتخاب‌شده معتبر نیست.");
    if (patch.status === "archived" && item.catalogActive) throw new Error("محصول فعال را نمی‌توان از چرخه پژوهش بایگانی کرد.");
    if (patch.status === "needs_sku" && item.sku) throw new Error("این محصول SKU دارد؛ وضعیت نیازمند شناسه فقط برای محصول بدون SKU است.");
    if (patch.status && !item.sku && !["needs_sku", "archived"].includes(patch.status)) throw new Error("تا زمان ثبت SKU معتبر، پرونده وارد مراحل پژوهش و تأیید نمی‌شود.");
    if (patch.labelEvidenceStatus !== undefined) {
      if (!EVIDENCE.has(patch.labelEvidenceStatus)) throw new Error("وضعیت مدرک برچسب معتبر نیست.");
      item.labelEvidenceStatus = patch.labelEvidenceStatus;
    }
    if (patch.compositionStatus !== undefined) {
      if (!EVIDENCE.has(patch.compositionStatus)) throw new Error("وضعیت مدرک ترکیبات معتبر نیست.");
      item.compositionStatus = patch.compositionStatus;
    }
    if (patch.notes !== undefined) item.notes = safeText(patch.notes, 3000);
    if (patch.reviewerName !== undefined) item.reviewerName = safeText(patch.reviewerName, 120);
    if (patch.reviewNote !== undefined) item.reviewNote = safeText(patch.reviewNote, 2000);
    if (patch.sources !== undefined) {
      if (!Array.isArray(patch.sources) || patch.sources.length > 30) throw new Error("فهرست منابع معتبر نیست.");
      item.sources = patch.sources.map(source => {
        const title = safeText(source && source.title, 240);
        const urlText = typeof (source && source.url) === "string" ? source.url.trim() : "";
        let url;
        try { url = new URL(urlText); } catch (_) { throw new Error("پیوند منبع معتبر نیست."); }
        if (!title || url.protocol !== "https:" || url.username || url.password) throw new Error("عنوان منبع و پیوند HTTPS معتبر الزامی است.");
        return {
          title, url: url.href,
          sourceType: safeText(source.sourceType, 80),
          accessedAt: safeText(source.accessedAt, 40) || new Date().toISOString()
        };
      });
    }
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    if (patch.status === "approved" && (!item.sku || item.duplicateSku || item.labelEvidenceStatus !== "checked" ||
        item.compositionStatus !== "checked" || !evidence.some(row => row.type === "label") ||
        !evidence.some(row => row.type === "composition") || !item.sources.length || !item.reviewerName)) {
      throw new Error("تأیید پرونده نیازمند SKU یکتا، فایل مدرک برچسب و ترکیبات، بررسی هر دو مدرک، دست‌کم یک منبع و نام بازبین است.");
    }
    if (patch.status !== undefined) item.status = patch.status;
    item.updatedAt = new Date().toISOString();
    write(state);
    return item;
  }
  return { syncCatalog, updateItem, addEvidence, getEvidence, searchPubMed, read };
}

module.exports = { createHealthResearchQueue, normalizeSku, stableId };
