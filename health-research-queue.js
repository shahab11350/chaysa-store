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
      if (!product || product.active === false) return;
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
      const active = product.active !== false;
      const duplicateSku = Boolean(sku && active && counts.get(sku) > 1);
      if (!item) {
        item = {
          id, key, sku, productName: name, category, catalogActive: active,
          duplicateSku, status: !sku ? "needs_sku" : duplicateSku ? "review" : active ? "queued" : "archived",
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
  function updateItem(id, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("درخواست ویرایش معتبر نیست.");
    const state = read();
    const item = state.items.find(row => row.id === id);
    if (!item) throw new Error("پرونده پژوهشی پیدا نشد.");
    if (patch.status !== undefined && !STATUSES.has(patch.status)) throw new Error("وضعیت انتخاب‌شده معتبر نیست.");
    if (patch.status === "archived" && item.catalogActive) throw new Error("محصول فعال را نمی‌توان از چرخه پژوهش بایگانی کرد.");
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
    if (patch.status === "approved" && (!item.sku || item.duplicateSku || item.labelEvidenceStatus !== "checked" ||
        item.compositionStatus !== "checked" || !item.sources.length || !item.reviewerName)) {
      throw new Error("تأیید پرونده نیازمند SKU یکتا، بررسی برچسب و ترکیبات، دست‌کم یک منبع و نام بازبین است.");
    }
    if (patch.status !== undefined) item.status = patch.status;
    item.updatedAt = new Date().toISOString();
    write(state);
    return item;
  }
  return { syncCatalog, updateItem, read };
}

module.exports = { createHealthResearchQueue, normalizeSku, stableId };
