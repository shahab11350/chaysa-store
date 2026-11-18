const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createHealthResearchQueue } = require("./health-research-queue");

const app = express();
const ROOT = __dirname;
const DATA = process.env.DATA_DIR || "/data";
const MEDIA = path.join(DATA, "media");
const PRODUCTS_FILE = path.join(DATA, "products.json");
fs.mkdirSync(MEDIA, { recursive: true });
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const windows = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const old = windows.get(key);
  if (!old || old.until < now) { windows.set(key, { count: 1, until: now + windowMs }); return false; }
  old.count++;
  return old.count > max;
}
function json(res, status, data) { return res.status(status).set("Cache-Control", "no-store").json(data); }
function readProducts() {
  try { const v = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8")); return Array.isArray(v) ? v : []; }
  catch (_) {
    try { const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "products-seed.json"), "utf8")); return Array.isArray(seed) ? seed : []; }
    catch (_) { return []; }
  }
}
function saveProducts(items) {
  const tmp = PRODUCTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), "utf8");
  fs.renameSync(tmp, PRODUCTS_FILE);
}
const healthResearchQueue = createHealthResearchQueue(DATA);
try { healthResearchQueue.syncCatalog(readProducts()); }
catch (error) { console.error("CHAYSA health research queue initialization failed:", error.message); }
const secret = process.env.ADMIN_PASSWORD || "";
function sign(value) { return crypto.createHmac("sha256", secret).update(value).digest("hex"); }
function isAdmin(req) {
  if (!secret) return false;
  const raw = req.headers.cookie || "";
  const token = (raw.match(/(?:^|;\s*)chaysa_admin=([^;]+)/) || [])[1];
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return json(res, 401, { error: "ابتدا وارد پنل مدیریت شوید." });
  const origin = req.get("origin");
  if (origin && origin !== req.protocol + "://" + req.get("host")) return json(res, 403, { error: "درخواست نامعتبر است." });
  next();
}
const bostaniSecret = process.env.BOSTANI_ACCESS_PASSWORD || "";
function signBostani(value) { return crypto.createHmac("sha256", bostaniSecret).update(value).digest("hex"); }
function isBostani(req) {
  const access = process.env.BOSTANI_ACCESS_TOKEN || "";
  if (!access) return false;
  const raw = req.headers.cookie || "";
  const supplied = (raw.match(/(?:^|;\s*)chaysa_bostani=([^;]+)/) || [])[1];
  if (!supplied) return false;
  const expected = Buffer.from(access), actual = Buffer.from(decodeURIComponent(supplied));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function requireBostani(req,res,next) {
  if(!isBostani(req)) return json(res,401,{error:"برای ورود به صفحهٔ اختصاصی خانم بستانی، رمز دسترسی را وارد کنید."});
  const origin=req.get("origin");
  if(origin && origin!==req.protocol+"://"+req.get("host")) return json(res,403,{error:"درخواست نامعتبر است."});
  next();
}
app.get("/api/health", (_req, res) => json(res, 200, { ok: true, service: "chaysa-backup" }));

const ANALYTICS_FILE = path.join(DATA, "analytics.json");
function readAnalytics() {
  try {
    const value = JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf8"));
    if (value && value.site && value.apk) return value;
  } catch (_) {}
  return { site: { views: 0, visitors: [], daily: {} }, apk: { installs: {} } };
}
function saveAnalytics(value) {
  const tmp = ANALYTICS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, ANALYTICS_FILE);
}
function tehranDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
app.post("/api/analytics/apk-open", (req, res) => {
  const key = "apk-open:" + (req.ip || "unknown");
  if (limited(key, 60, 60 * 1000)) return json(res, 429, { error: "درخواست‌های زیادی ثبت شده است." });
  const installationId = typeof req.body.installationId === "string" ? req.body.installationId.trim() : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(installationId)) return json(res, 400, { error: "شناسه نصب معتبر نیست." });
  const data = readAnalytics();
  const id = crypto.createHash("sha256").update(installationId).digest("hex");
  const now = new Date().toISOString();
  const existing = data.apk.installs[id];
  data.apk.installs[id] = { firstOpenedAt: existing ? existing.firstOpenedAt : now, lastSeenAt: now };
  try { saveAnalytics(data); } catch (_) { return json(res, 500, { error: "ثبت آمار نصب انجام نشد." }); }
  return json(res, 200, { ok: true, firstOpen: !existing });
});
app.get("/api/admin/analytics", requireAdmin, (_req, res) => {
  const data = readAnalytics();
  const days = Object.entries(data.site.daily || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30).map(([date, value]) => ({
    date, views: value.views || 0, visitors: (value.visitors || []).length
  }));
  const installs = Object.values(data.apk.installs || {});
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const active30 = installs.filter(x => Date.parse(x.lastSeenAt) >= cutoff).length;
  return json(res, 200, {
    site: {
      totalViews: data.site.views || 0,
      uniqueVisitors: (data.site.visitors || []).length,
      todayViews: (data.site.daily[tehranDay()] || {}).views || 0,
      daily: days
    },
    apk: {
      firstOpens: installs.length,
      active30Days: active30,
      note: "نصب بر اساس اولین اجرای اپ ثبت می‌شود؛ برای شروع ثبت، اپ باید به API آمار متصل شود."
    }
  });
});


function guideHealthBankNotice() {
  const file = path.join(ROOT, "data", "health", "health-product-research.json");
  try {
    const bank = JSON.parse(fs.readFileSync(file, "utf8"));
    if (bank.status === "research_draft_not_for_customer_answers") {
      return "وضعیت بانک علمی چایسا: نسخه موجود هنوز در مرحله پیش‌نویس و اعتبارسنجی است؛ بنابراین برای این پرسش پاسخ تأییدشده‌ای از بانک ارائه نمی‌شود.";
    }
    return "وضعیت بانک علمی چایسا برای پاسخ‌گویی به این پرسش تأیید نشده است؛ این جست‌وجو پاسخ پزشکی یا توصیه درمانی چایسا محسوب نمی‌شود.";
  } catch (_) {
    return "بانک علمی چایسا در دسترس نیست؛ بنابراین پاسخ تأییدشده‌ای از بانک ارائه نمی‌شود.";
  }
}

const GUIDE_BANK_FILE = path.join(ROOT, "guide-bank.json");
function readGuideBank() {
  try { return JSON.parse(fs.readFileSync(GUIDE_BANK_FILE, "utf8")); }
  catch (_) { return { schemaVersion: 1, categories: [], questionBank: [], topicRules: {}, healthPolicy: {} }; }
}
function guideNormalize(value) {
  return String(value || "").toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ").trim();
}
function guideSafeMedicine(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 60 || /[@]|https?:|www\.|\+|\b\d{4,}\b/i.test(raw)) return "";
  if ((raw.match(/\d/g) || []).length >= 7 || /آدرس|نشانی|تلفن|موبایل|شماره تماس|کد ملی|خیابان|کوچه|پلاک/i.test(raw)) return "";
  if (!/^[\p{L}\p{N}\s-]+$/u.test(raw)) return "";
  const normalized = guideNormalize(raw);
  const blockedWords = new Set(["من", "دارم", "بیماری", "علائم", "نشانه", "دچار", "سابقه", "پرونده", "نسخه", "باردار", "حامله", "شیرده", "پزشک", "دوز", "همسرم", "مادرم", "پدرم", "فرزندم", "کودکم"]);
  if (normalized.split(" ").some(word => blockedWords.has(word))) return "";
  if (normalized.split(" ").length > 3 || /(?:^|\s)\d+(?:\.\d+)?(?:\s|$)/.test(normalized)) return "";
  return raw.replace(/\s+/g, " ");
}
function guideFindProduct(products, sku, question) {
  if (sku) {
    const found = products.find(p => String(p.sku) === String(sku) && p.active !== false);
    if (found) return found;
  }
  const normalized = guideNormalize(question);
  return products.filter(p => p.active !== false && p.name)
    .sort((a,b) => String(b.name).length - String(a.name).length)
    .find(p => normalized.includes(guideNormalize(p.name))) || null;
}
function guideContainsAny(text, terms) {
  return (terms || []).some(term => text.includes(guideNormalize(term)));
}
app.get("/api/guide/bootstrap", (_req, res) => {
  const bank = readGuideBank();
  const products = readProducts().filter(p => p && p.active !== false).map(p => ({
    sku: String(p.sku || ""), name: String(p.name || ""), category: String(p.category || "")
  })).filter(p => p.sku && p.name);
  return json(res, 200, {
    schemaVersion: bank.schemaVersion || 1,
    categories: bank.categories || [],
    questionBank: bank.questionBank || [],
    keywords: bank.keywords || [],
    products,
    healthNotice: bank.healthPolicy && bank.healthPolicy.notice || "",
    healthRule: bank.healthPolicy && bank.healthPolicy.rule || ""
  });
});
function readTranslatedHealthSources() {
  try {
    const file = path.join(ROOT, "data", "health", "translated-sources.json");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && Array.isArray(value.sources) ? value.sources : [];
  } catch (_) { return []; }
}
function guideSourceTokens(value) {
  return guideNormalize(value).split(/\s+/).filter(word => word.length > 2 &&
    !["برای","درباره","این","آن","است","شود","چگونه","چیست","آیا","مقدار","مصرف","محصول","چایسا","دارم","دارد","می‌شود","میشه","کنم","کنید"].includes(word));
}
function guideFindInternalSources(question, product) {
  const sources = readTranslatedHealthSources();
  const healthFile = path.join(ROOT, "data", "health", "health-product-research.json");
  let productTerms = [product && product.name || ""];
  try {
    const data = JSON.parse(fs.readFileSync(healthFile, "utf8"));
    const records = Array.isArray(data.products) ? data.products : (Array.isArray(data.items) ? data.items : []);
    const record = records.find(item => String(item.sku) === String(product && product.sku));
    if (record) productTerms = productTerms.concat(record.nameMentionedIngredients || []);
  } catch (_) {}
  const pTerms = [...new Set(productTerms.flatMap(guideSourceTokens))];
  const qTerms = [...new Set(guideSourceTokens(question))];
  const scored = sources.map(source => {
    const body = guideNormalize(source.content);
    const botanicalHits = pTerms.filter(term => body.includes(term));
    const questionHits = qTerms.filter(term => body.includes(term));
    const paragraphs = source.content.split(/\n\s*\n/).map(x => x.trim())
      .filter(x => x.length > 45 && !/^##|^\*\*شناسه/.test(x));
    const ranked = paragraphs.map(text => {
      const normalized = guideNormalize(text);
      const hits = qTerms.filter(term => normalized.includes(term)).length;
      const plant = pTerms.filter(term => normalized.includes(term)).length;
      return {text,score:hits*2+plant};
    }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0,3);
    return {source, botanicalHits, questionHits, ranked,
      score: botanicalHits.length*5 + questionHits.length*2 + ranked.reduce((n,x)=>n+x.score,0)};
  }).filter(x => x.score > 0);
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,4).map(x=>({
    id:x.source.id,title:x.source.title,originalTitle:x.source.originalTitle,
    publisher:x.source.publisher,url:x.source.url,
    relevance:x.botanicalHits.length ? "مرتبط با نام گیاه یا مادهٔ ذکرشده در نام محصول؛ ترکیب واقعی محصول تأیید نشده است." : "منبع عمومی مرتبط با موضوع پرسش",
    excerpts:x.ranked.length ? x.ranked.map(p=>p.text) : [x.source.content.slice(0,850)]
  }));
}
app.post("/api/guide/resolve", (req, res) => {
  const key = "guide-resolve:" + (req.ip || "unknown");
  if (limited(key, 12, 60 * 1000)) return json(res, 429, { ok: false, error: "درخواست‌های زیادی ثبت شده است؛ کمی بعد دوباره تلاش کنید." });
  const body = req.body || {};
  const category = typeof body.category === "string" ? body.category : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const productSku = typeof body.productSku === "string" ? body.productSku.trim() : "";
  const medicine = guideSafeMedicine(body.medicine);
  if (!["products", "safety", "services", "custom"].includes(category))
    return json(res, 400, { ok: false, error: "دسته راهنما معتبر نیست." });
  if (!question || question.length > 400)
    return json(res, 400, { ok: false, error: "متن پرسش را کوتاه و روشن وارد کنید." });
  const normalized = guideNormalize(question);
  const bank = readGuideBank();
  const rules = bank.topicRules || {};
  if (guideContainsAny(normalized, rules.deniedTerms))
    return json(res, 200, { ok: false, allowed: false, reason: "outside_scope", message: "این راهنما فقط برای پاسخ‌گویی به پرسش‌های مرتبط با محصولات و خدمات چایسا طراحی شده است." });
  if (guideContainsAny(normalized, rules.unsafeIntentTerms))
    return json(res, 200, { ok: false, allowed: false, reason: "unsafe_medical_request", message: "چایسا تشخیص، درمان یا تجویز انجام نمی‌دهد. برای تصمیم درمانی با پزشک یا داروساز مشورت کنید." });
  const products = readProducts().filter(p => p && p.active !== false);
  const product = guideFindProduct(products, productSku, question);
  const serviceQuestion = guideContainsAny(normalized, rules.serviceTerms);
  const productQuestion = Boolean(product) || guideContainsAny(normalized, rules.productTopics);
  if (category === "services" && !serviceQuestion)
    return json(res, 200, { ok: false, allowed: false, reason: "needs_service_context", message: "لطفاً پرسش را به خرید، سفارش، پرداخت، ارسال یا پیگیری خدمات چایسا مرتبط کنید." });
  if (category === "products" && (!product || !productQuestion))
    return json(res, 200, { ok: false, allowed: false, reason: "needs_product", message: "برای ادامه، محصول موردنظر را از فهرست انتخاب کنید و پرسش را درباره همان محصول بنویسید." });
  if (category === "safety" && !product)
    return json(res, 200, { ok: false, allowed: false, reason: "needs_product", message: "ابتدا محصول چایسا را انتخاب کنید." });
  if (category === "safety" && guideContainsAny(normalized, ["تداخل","دارو","همزمان","هم زمان"]) && !medicine)
    return json(res, 200, { ok: false, allowed: false, reason: "needs_medicine", message: "برای مرتب‌سازی منابع، نام دارو را جداگانه وارد کنید؛ این بخش تداخل را تشخیص یا تأیید نمی‌کند." });
  if (category === "products" || category === "safety" || (category === "custom" && product)) {
    const translatedSources = readTranslatedHealthSources();
    if (!translatedSources.length)
      return json(res, 503, { ok:false, allowed:false, message:"بانک منابع داخلی موقتاً در دسترس نیست." });
    const matches = guideFindInternalSources(question + " " + medicine, product);
    return json(res, 200, {
      ok:true, allowed:true, type:"internal_knowledge",
      productName:product ? product.name : "",
      sources:matches,
      message:matches.length ? "مطالب مرتبط از بانک داخلی چایسا پیدا شد." : "برای این پرسش، مطلب مرتبط و قابل نمایش در بانک داخلی پیدا نشد.",
      policy:"این صفحه راهنمای عمومی است، نه تشخیص یا تجویز. منابع درباره گیاه یا فرآورده‌های بررسی‌شده‌اند و ترکیبات یا ویژگی‌های محصول انتخابی را ثابت نمی‌کنند. اطلاعات اختصاصی محصول فقط با برچسب رسمی قابل تأیید است."
    });
  }
  if (category === "services" || (category === "custom" && serviceQuestion)) {
    const serviceHits = (rules.serviceTerms || []).filter(t => normalized.includes(guideNormalize(t)));
    if (!serviceHits.length) return json(res, 200, { ok: false, allowed: false, reason: "outside_scope", message: "این راهنما فقط برای پرسش‌های مرتبط با محصولات و خدمات چایسا طراحی شده است." });
    return json(res, 200, { ok: true, allowed: true, type: "service_guidance",
      message:"برای اطلاعات قطعی سفارش، اطلاعیه‌ها و پیام‌های رسمی چایسا را ملاک قرار دهید." });
  }
  return json(res, 200, { ok: false, allowed: false, reason: "outside_scope", message: "این راهنما فقط برای پرسش‌های مرتبط با محصولات و خدمات چایسا طراحی شده است." });
});

app.get("/api/products", (_req, res) => json(res, 200, readProducts()));

app.post("/api/admin/login", (req, res) => {
  const key = req.ip || "unknown";
  if (limited("login:" + key, 8, 15 * 60 * 1000)) return json(res, 429, { error: "تعداد تلاش زیاد است؛ کمی بعد دوباره امتحان کن." });
  if (!secret || typeof req.body.password !== "string" || req.body.password.length !== secret.length ||
      !crypto.timingSafeEqual(Buffer.from(req.body.password), Buffer.from(secret))) {
    return json(res, 401, { error: "رمز عبور نادرست است." });
  }
  const exp = String(Date.now() + 8 * 60 * 60 * 1000);
  res.cookie("chaysa_admin", exp + "." + sign(exp), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 * 1000 });
  return json(res, 200, { ok: true });
});
app.all("/api/admin/logout", (_req, res) => {
  res.clearCookie("chaysa_admin", { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  return json(res, 200, { ok: true });
});
const ORDERS_FILE = path.join(DATA, "orders.json");
function readOrders(){try{const x=JSON.parse(fs.readFileSync(ORDERS_FILE,"utf8"));return Array.isArray(x)?x:[]}catch(_){return[]}}
function saveOrders(x){const t=ORDERS_FILE+".tmp";fs.writeFileSync(t,JSON.stringify(x,null,2),"utf8");fs.renameSync(t,ORDERS_FILE)}
function normalizeDigits(v){return String(v||"").replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))}
app.get("/api/admin/orders",requireAdmin,(_req,res)=>json(res,200,readOrders()));
app.patch("/api/admin/orders/:id/status",requireAdmin,async(req,res)=>{
 const allowed=["در انتظار بررسی","در حال آماده‌سازی","ارسال‌شده","تحویل‌شده","لغوشده"];
 if(!allowed.includes(req.body.status))return json(res,400,{error:"وضعیت سفارش معتبر نیست."});
 const rows=readOrders(),o=rows.find(x=>x.id===req.params.id);if(!o)return json(res,404,{error:"سفارش پیدا نشد."});
 try {
  const result=await updateOrderStatus(rows,o,req.body.status);
  return json(res,200,{ok:true,order:o,changed:result.changed,customerNotification:result.notification});
 } catch (_) { return json(res,500,{error:"ثبت وضعیت سفارش انجام نشد."}); }
});
app.post("/api/admin/orders/:id/status-notification/retry",requireAdmin,async(req,res)=>{
 const rows=readOrders(),o=rows.find(x=>x.id===req.params.id);if(!o)return json(res,404,{error:"سفارش پیدا نشد."});
 try {
  const result=await retryOrderStatusNotification(rows,o);
  if(!result.eligible)return json(res,409,{ok:false,error:result.error,customerNotification:o.statusNotification||null});
  if(!result.ok)return json(res,502,{ok:false,error:result.error||"ارسال پیام به مشتری تأیید نشد.",customerNotification:o.statusNotification||null});
  return json(res,200,{ok:true,customerNotification:o.statusNotification});
 } catch (_) { return json(res,500,{ok:false,error:"ثبت نتیجه تلاش مجدد انجام نشد."}); }
});
const TELEGRAM_RECIPIENTS_FILE = path.join(DATA, "telegram-recipients.json");
function readTelegramRecipients() {
  try {
    const rows = JSON.parse(fs.readFileSync(TELEGRAM_RECIPIENTS_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
function getChaysaTelegramPair() {
  const ownerChatId = String(process.env.CHAYSA_OWNER_CHAT_ID || "").trim();
  const bostaniChatId = String(process.env.CHAYSA_BOSTANI_CHAT_ID || "").trim();
  const valid = value => /^-?\d+$/.test(value);
  if (!valid(ownerChatId) || !valid(bostaniChatId) || ownerChatId === bostaniChatId) return null;
  return [
    { id: ownerChatId, linkedChatId: bostaniChatId, pairKey: "chaysa-core" },
    { id: bostaniChatId, linkedChatId: ownerChatId, pairKey: "chaysa-core" }
  ];
}
function syncChaysaTelegramPair() {
  const pair = getChaysaTelegramPair();
  if (!pair) return false;
  const rows = readTelegramRecipients();
  for (const member of pair) {
    const index = rows.findIndex(x => String(x.id) === member.id);
    const current = index >= 0 ? rows[index] : { id: member.id, username: "", first_name: "", type: "private" };
    const linked = { ...current, linkedChatId: member.linkedChatId, pairKey: member.pairKey, linked: true };
    if (index >= 0) rows[index] = linked; else rows.push(linked);
  }
  const tmp = TELEGRAM_RECIPIENTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, TELEGRAM_RECIPIENTS_FILE);
  return true;
}
async function notifyChaysaTelegramPair(message) {
  const pair = getChaysaTelegramPair();
  if (!pair) return { status: "not_configured", recipients: [] };
  const recipients = await Promise.all(pair.map(async member => ({
    chatId: member.id,
    sent: await sendTelegramText(member.id, message)
  })));
  return {
    status: recipients.every(x => x.sent) ? "sent" : recipients.some(x => x.sent) ? "partial" : "failed",
    recipients
  };
}
function saveTelegramRecipient(chat) {
  if (!chat || chat.type !== "private" || chat.id == null) return;
  const rows = readTelegramRecipients();
  const id = String(chat.id);
  const item = { id, username: chat.username || "", first_name: chat.first_name || "", type: "private" };
  const index = rows.findIndex(x => String(x.id) === id);
  if (index >= 0) rows[index] = { ...rows[index], ...item }; else rows.push(item);
  const pair = getChaysaTelegramPair();
  if (pair) {
    for (const member of pair) {
      const existingIndex = rows.findIndex(x => String(x.id) === member.id);
      const existing = existingIndex >= 0 ? rows[existingIndex] : { id: member.id, username: "", first_name: "", type: "private" };
      const linked = { ...existing, linkedChatId: member.linkedChatId, pairKey: member.pairKey, linked: true };
      if (existingIndex >= 0) rows[existingIndex] = linked; else rows.push(linked);
    }
  }
  const tmp = TELEGRAM_RECIPIENTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, TELEGRAM_RECIPIENTS_FILE);
}

async function sendRubikaTextDetailed(chatId, text) {
 const token=process.env.RUBIKA_BOT_TOKEN||"";
 if(!token)return {ok:false,error:"توکن ربات روبیکا تنظیم نشده است."};
 if(typeof chatId!=="string"||!/^[A-Za-z0-9_-]{12,80}$/.test(chatId))
  return {ok:false,error:"شناسه گفت‌وگوی روبیکا معتبر نیست."};
 try {
  const response=await fetch("https://botapi.rubika.ir/v3/"+token+"/sendMessage",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({chat_id:chatId,text,disable_notification:false})
  });
  let data;
  try { data=await response.json(); }
  catch (_) { return {ok:false,error:"پاسخ روبیکا JSON معتبر نبود (HTTP "+response.status+")."}; }
  const messageId=data&&data.data&&data.data.message_id;
  if(response.ok&&data&&data.status==="OK"&&typeof messageId==="string"&&messageId.trim())
   return {ok:true,messageId};
  const details=["HTTP "+response.status];
  if(data&&data.status)details.push("status="+safeRubikaDiagnosticValue(data.status));
  if(data&&data.status_det)details.push("status_det="+safeRubikaDiagnosticValue(data.status_det));
  if(data&&data.error_code!==undefined)details.push("error_code="+safeRubikaDiagnosticValue(data.error_code));
  if(response.ok&&data&&data.status==="OK"&&!messageId)details.push("message_id=missing");
  return {ok:false,error:"ارسال روبیکا تأیید نشد ("+details.join("; ")+")."};
 } catch (error) {
  const kind=error&&error.name?String(error.name).replace(/[^A-Za-z0-9_-]/g,"").slice(0,32):"NetworkError";
  return {ok:false,error:"خطای ارتباط با API روبیکا ("+kind+")."};
 }
}
async function sendRubikaText(chatId, text) {
 const result=await sendRubikaTextDetailed(chatId,text);
 return result.ok;
}
async function notifyBostaniRubika(message) {
 const chatId=String(process.env.CHAYSA_BOSTANI_RUBIKA_CHAT_ID||"").trim();
 if(!/^[A-Za-z0-9_-]{12,80}$/.test(chatId))return {status:"not_configured",sent:false};
 const sent=await sendRubikaText(chatId,message);
 return {status:sent?"sent":"failed",sent};
}
function safeRubikaDiagnosticValue(value){
 if(typeof value!=="string"&&typeof value!=="number")return "missing";
 const safe=String(value).replace(/[^A-Za-z0-9_. -]/g,"").slice(0,48);
 return safe||"empty";
}
function rubikaWebhookKey(){const token=process.env.RUBIKA_BOT_TOKEN||"";return token?crypto.createHash("sha256").update("CHAYSA-RUBIKA-WEBHOOK-V1:"+token).digest("hex").slice(0,40):""}
function extractRubikaUpdates(body){
 const root=body&&typeof body==="object"?body:{};
 const data=root.data&&typeof root.data==="object"?root.data:null;
 if(Array.isArray(root.updates))return root.updates;
 if(Array.isArray(data&&data.updates))return data.updates;
 if(root.update&&typeof root.update==="object")return [root.update];
 if(data&&data.update&&typeof data.update==="object")return [data.update];
 return [root];
}
async function handleRubikaUpdate(update){
 if(!update||typeof update!=="object")return;
 const type=String(update.type||"");
 const msg=update.new_message||update.updated_message||null;
 const chatId=String(update.chat_id||(msg&&msg.chat_id)||"");
 if(!/^[A-Za-z0-9_-]{12,80}$/.test(chatId))return;
 const welcome="به ربات چایسا خوش آمدید.\nشناسه گفت‌وگوی شما برای ثبت سفارش:\n"+chatId+"\nاین شناسه را پس از انتخاب روبیکا در فرم سفارش وارد کنید. فاکتور از همین گفت‌وگو ارسال می‌شود.";
 if(type==="StartedBot"){
  const sent=await sendRubikaText(chatId,welcome);
  console.log("Rubika StartedBot response:",sent?"sent":"failed");
  return;
 }
 if(!msg||msg.sender_type!=="User"||typeof msg.text!=="string")return;
 const command=msg.text.trim();
 if(command==="/start"||/^\/start@Chaysa2026bot$/i.test(command)||command==="شروع"){
  const sent=await sendRubikaText(chatId,welcome);
  console.log("Rubika /start response:",sent?"sent":"failed");
 }
}
app.post("/rubika/webhook/:key",async(req,res)=>{
 const expected=rubikaWebhookKey(),supplied=String(req.params.key||"");
 if(!expected||supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return res.sendStatus(403);
 try{for(const update of extractRubikaUpdates(req.body))await handleRubikaUpdate(update);return res.sendStatus(200)}catch(_){return res.sendStatus(500)}
});
const RUBIKA_UPDATES_OFFSET_FILE=path.join(DATA,"rubika-updates-offset.txt");
function readRubikaUpdatesOffset(){try{return fs.readFileSync(RUBIKA_UPDATES_OFFSET_FILE,"utf8").trim()}catch(_){return""}}
function saveRubikaUpdatesOffset(offset){
 const tmp=RUBIKA_UPDATES_OFFSET_FILE+".tmp";
 fs.writeFileSync(tmp,String(offset),{encoding:"utf8",mode:0o600});
 fs.renameSync(tmp,RUBIKA_UPDATES_OFFSET_FILE);
}
async function startRubikaPolling(token){
 let offsetId=readRubikaUpdatesOffset();
 const intervalMs=Math.max(50,Math.min(60000,Number(process.env.RUBIKA_POLL_INTERVAL_MS)||5000));
 console.log("Rubika polling fallback: started");
 while(true){
  try{
   const payload={limit:50};
   if(offsetId)payload.offset_id=offsetId;
   const response=await fetch("https://botapi.rubika.ir/v3/"+token+"/getUpdates",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
   });
   let result;
   try{result=await response.json()}catch(_){
    console.log("Rubika polling fallback: invalid JSON","http="+response.status);
    result=null;
   }
   if(response.ok&&result&&result.status==="OK"){
    const data=result.data&&typeof result.data==="object"?result.data:{};
    const updates=Array.isArray(data.updates)?data.updates:[];
    for(const update of updates)await handleRubikaUpdate(update);
    const nextOffset=typeof data.next_offset_id==="string"?data.next_offset_id:"";
    if(nextOffset&&nextOffset!==offsetId){
     saveRubikaUpdatesOffset(nextOffset);
     offsetId=nextOffset;
    }
    if(updates.length)console.log("Rubika polling fallback: processed",updates.length,"updates");
   }else{
    const apiStatus=safeRubikaDiagnosticValue(result&&result.status);
    const dataStatus=safeRubikaDiagnosticValue(result&&result.data&&result.data.status);
    console.log("Rubika polling fallback: request failed","http="+response.status,"api="+apiStatus,"data="+dataStatus);
   }
  }catch(error){
   console.log("Rubika polling fallback: request error","type="+safeRubikaDiagnosticValue(error&&error.name));
  }
  await new Promise(resolve=>setTimeout(resolve,intervalMs));
 }
}


async function sendTelegramText(chatId, text, replyMarkup) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return false;
  try {
    const payload = { chat_id: chatId, text, disable_web_page_preview: true };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    return response.ok && result.ok === true;
  } catch (_) { return false; }
}

const ORDER_STATUSES = ["در انتظار بررسی","در حال آماده‌سازی","ارسال‌شده","تحویل‌شده","لغوشده"];
function orderCustomerStatusMessage(order) {
  const firstName = String(order.customer && order.customer.name || "").trim();
  return [
    "به‌روزرسانی سفارش چایسا",
    firstName ? firstName + " عزیز،" : "مشتری گرامی،",
    "شماره سفارش: " + String(order.id || ""),
    "وضعیت جدید: " + String(order.status || ""),
    "برای پیگیری، شناسه سفارش را نزد خود نگه دارید."
  ].join("\n");
}
async function deliverOrderStatusNotification(order) {
  const customer = order.customer || {};
  const platform = String(customer.messengerPlatform || "");
  const chatId = String(customer.messengerId || "").trim();
  if (platform === "telegram") {
    if (!process.env.TELEGRAM_BOT_TOKEN || !/^-?\d{5,20}$/.test(chatId))
      return { status: "not_configured", platform, error: "شناسه یا اتصال تلگرام مشتری آماده نیست." };
    const sent = await sendTelegramText(chatId, orderCustomerStatusMessage(order));
    return { status: sent ? "sent" : "failed", platform, error: sent ? null : "ارسال پیام تلگرام ناموفق بود." };
  }
  if (platform === "rubika") {
    if (!process.env.RUBIKA_BOT_TOKEN || !/^[A-Za-z0-9_-]{12,80}$/.test(chatId))
      return { status: "not_configured", platform, error: "شناسه یا اتصال روبیکای مشتری آماده نیست." };
    const delivery = await sendRubikaTextDetailed(chatId, orderCustomerStatusMessage(order));
    return { status: delivery.ok ? "sent" : "failed", platform, error: delivery.ok ? null : delivery.error };
  }
  return { status: "not_configured", platform: "", error: "پیام‌رسان ثبت‌شده مشتری پشتیبانی نمی‌شود." };
}
async function updateOrderStatus(rows, order, nextStatus) {
  const previousStatus = String(order.status || "در انتظار بررسی");
  if (previousStatus === nextStatus)
    return { changed: false, notification: order.statusNotification || null };
  const now = new Date().toISOString();
  order.status = nextStatus;
  order.updatedAt = now;
  if (nextStatus === "تحویل‌شده") order.deliveredAt = now;
  order.statusNotification = {
    status: "pending", platform: String(order.customer && order.customer.messengerPlatform || ""),
    attemptedAt: null, updatedAt: now, attempts: Number(order.statusNotification && order.statusNotification.attempts || 0) + 1,
    transitionId: crypto.randomUUID(), error: null
  };
  saveOrders(rows);
  const delivery = await deliverOrderStatusNotification(order);
  Object.assign(order.statusNotification, delivery, { attemptedAt: new Date().toISOString() });
  try { saveOrders(rows); }
  catch (_) { return { changed: true, notification: { ...order.statusNotification, persistence: "failed" } }; }
  return { changed: true, notification: order.statusNotification };
}
async function retryOrderStatusNotification(rows, order) {
  const previous = order.statusNotification;
  if (!previous || !["failed","not_configured"].includes(previous.status))
    return { ok: false, error: "فقط پیام ناموفق یا تنظیم‌نشده قابل تلاش مجدد است." };
  previous.status = "pending";
  previous.error = null;
  previous.attemptedAt = null;
  previous.attempts = Number(previous.attempts || 0) + 1;
  previous.transitionId = crypto.randomUUID();
  saveOrders(rows);
  const delivery = await deliverOrderStatusNotification(order);
  Object.assign(previous, delivery, { attemptedAt: new Date().toISOString() });
  saveOrders(rows);
  return { ok: delivery.status === "sent", eligible: true, error: delivery.error || null };
}
function buildOwnerProgressReport() {
  const orders = readOrders();
  const questions = readQuestions();
  const products = readProducts();
  const orderCounts = {};
  for (const order of orders) {
    const status = String(order.status || "نامشخص");
    orderCounts[status] = (orderCounts[status] || 0) + 1;
  }
  const questionCounts = {};
  for (const question of questions) {
    const status = String(question.status || (question.reply ? "پاسخ‌داده‌شده" : "در انتظار پاسخ"));
    questionCounts[status] = (questionCounts[status] || 0) + 1;
  }
  const activeProducts = products.filter(product => product.active !== false).length;
  const orderLines = Object.entries(orderCounts).map(([status, count]) => "• " + status + ": " + count);
  const questionLines = Object.entries(questionCounts).map(([status, count]) => "• " + status + ": " + count);
  return [
    "گزارش مالک پروژه چایسا",
    "زمان تهیه: " + new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }),
    "",
    "۱) وضعیت داده‌های فروشگاه",
    "• کل محصولات: " + products.length,
    "• محصولات فعال: " + activeProducts,
    "• کل سفارش‌های ثبت‌شده: " + orders.length,
    ...(orderLines.length ? orderLines : ["• هنوز سفارشی ثبت نشده است."]),
    "",
    "۲) پرسش و پاسخ",
    "• کل پرسش‌ها: " + questions.length,
    ...(questionLines.length ? questionLines : ["• هنوز پرسشی ثبت نشده است."]),
    "",
    "۳) وضعیت فنی",
    "• این پیام از مسیر وب‌هوک ربات تولید شده است.",
    "• وضعیت زنده انتشار سایت، ساخت و انتشار اندروید، آزمون‌های دستگاه و سلامت زیرساخت از داده‌های فروشگاه قابل استنتاج نیست و باید جداگانه ممیزی شود.",
    "",
    "۴) امنیت و حریم خصوصی",
    "• این گزارش فقط آمار تجمیعی را نشان می‌دهد؛ اطلاعات هویتی مشتریان، نشانی، تماس، متن پرسش‌ها، جزئیات پرداخت، رمزها و توکن‌ها ارسال نمی‌شود."
  ].join("\n");
}

function buildBostaniProgressReport() {
  const orders = readOrders();
  const questions = readQuestions();
  const orderCounts = {};
  for (const order of orders) {
    const status = String(order.status || "نامشخص");
    orderCounts[status] = (orderCounts[status] || 0) + 1;
  }
  const unanswered = questions.filter(q => !q.reply && q.status !== "پاسخ ارسال‌شده").length;
  const answered = questions.length - unanswered;
  const orderLines = Object.entries(orderCounts).length
    ? Object.entries(orderCounts).map(([status, count]) => "• " + status + ": " + count)
    : ["• هنوز سفارشی ثبت نشده است."];
  return [
    "گزارش کلی چایسا",
    "زمان گزارش: " + new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }),
    "",
    "وضعیت سامانه",
    "• سرویس سایت در حال پاسخ‌گویی است؛ دریافت این گزارش از ربات نیز نشان‌دهنده فعال بودن مسیر وب‌هوک در همین لحظه است.",
    "• اپلیکیشن اندروید پروژه‌ای مستقل است؛ وضعیت ساخت و انتشار آن از این ربات به‌صورت زنده قابل تأیید نیست.",
    "",
    "گزارش سفارش‌ها",
    "• مجموع سفارش‌های ثبت‌شده: " + orders.length,
    ...orderLines,
    "",
    "گزارش پرسش‌وپاسخ",
    "• مجموع پرسش‌های ثبت‌شده: " + questions.length,
    "• پاسخ‌داده‌شده: " + answered,
    "• در انتظار پاسخ/اتصال: " + unanswered,
    "",
    "این گزارش فقط آمار کلی و غیرشخصی را نمایش می‌دهد؛ نام، نشانی، شماره تماس، متن پرسش‌ها، اطلاعات پرداخت، رمزها و تنظیمات مدیریتی در آن ارسال نمی‌شود.",
    "برای وضعیت جزئی توسعه سایت و اپلیکیشن، گزارش مستندات پروژه باید توسط مالک به‌روزرسانی شود."
  ].join("\n");
}

const GUIDE_APPROVALS_FILE = path.join(DATA, "guide-approvals.json");
function readGuideApprovals() {
  try {
    const rows = JSON.parse(fs.readFileSync(GUIDE_APPROVALS_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
function saveGuideApprovals(rows) {
  const tmp = GUIDE_APPROVALS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), "utf8");
  fs.renameSync(tmp, GUIDE_APPROVALS_FILE);
}
app.get("/api/admin/guide/approvals", requireAdmin, (_req, res) => {
  return json(res, 200, readGuideApprovals().slice(-100).reverse());
});
async function requestGuideApproval(ownerChatId, version, commit, reviewUrl) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const bostaniChatId = String(process.env.CHAYSA_BOSTANI_CHAT_ID || "").trim();
  if (!token || !/^-?\d+$/.test(bostaniChatId)) {
    await sendTelegramText(ownerChatId, "درخواست تأیید ارسال نشد؛ اتصال ربات یا شناسه عددی خانم بستانی تنظیم نشده است.");
    return;
  }
  let review;
  try {
    review = new URL(reviewUrl);
    const allowedReviewHost = (process.env.CHAYSA_GUIDE_REVIEW_HOST || "chaysa.up.railway.app").trim().toLowerCase();
    if (review.protocol !== "https:" || review.hostname.toLowerCase() !== allowedReviewHost ||
        review.username || review.password || review.href.length > 512) throw new Error("invalid review URL");
  } catch (_) {
    await sendTelegramText(ownerChatId, "نشانی نسخه مورد بررسی معتبر نیست. فقط نشانی HTTPS مجازِ راهنمای آزمایشی چایسا پذیرفته می‌شود.");
    return;
  }
  const id = crypto.randomBytes(6).toString("hex").toUpperCase();
  const record = {
    id, version, commit: commit.toLowerCase(), reviewUrl: review.href,
    status: "pending", requestedAt: new Date().toISOString(),
    requestedByTelegramId: String(ownerChatId), deliveryStatus: "pending"
  };
  const rows = readGuideApprovals();
  rows.push(record);
  try { saveGuideApprovals(rows); }
  catch (_) {
    await sendTelegramText(ownerChatId, "ثبت درخواست تأیید در سابقه پایدار انجام نشد؛ هیچ درخواستی برای خانم بستانی ارسال نشد.");
    return;
  }
  const message = [
    "درخواست بررسی و تأیید نسخه آزمایشی راهنمای چایسا",
    "",
    "نسخه: " + version,
    "شناسه درخواست: " + id,
    "Commit: " + commit.toLowerCase(),
    "لینک نسخه مورد بررسی: " + review.href,
    "",
    "لطفاً ابتدا نسخه آزمایشی را بررسی کنید و سپس یکی از دو دکمه زیر را انتخاب کنید.",
    "این تأیید فقط مربوط به همین نسخه و همین Commit است و به‌معنای مجوز انتشار عمومی نیست."
  ].join("\n");
  const keyboard = {
    keyboard: [[{ text: "تأیید " + id }, { text: "عدم تأیید " + id }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
  const sent = await sendTelegramText(bostaniChatId, message, keyboard);
  const current = readGuideApprovals();
  const saved = current.find(x => x.id === id);
  if (saved) {
    saved.deliveryStatus = sent ? "sent" : "failed";
    saved.sentAt = sent ? new Date().toISOString() : null;
    try { saveGuideApprovals(current); } catch (_) {}
  }
  await sendTelegramText(ownerChatId, sent
    ? "درخواست تأیید نسخه " + version + " برای خانم بستانی ارسال شد. شناسه: " + id
    : "ارسال درخواست به خانم بستانی ناموفق بود. سابقه درخواست با وضعیت ارسال ناموفق نگهداری شد؛ دوباره‌ارسال خودکار انجام نشد.");
}
async function answerTelegramCallback(callbackQueryId, text, showAlert = false) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token || !callbackQueryId) return false;
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert })
    });
    const result = await response.json();
    return response.ok && result.ok === true;
  } catch (_) { return false; }
}
async function removeTelegramReceiptKeyboard(callback) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const message = callback && callback.message;
  if (!token || !message || !message.chat || !message.message_id) return false;
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/editMessageReplyMarkup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: [] } })
    });
    const result = await response.json();
    return response.ok && result.ok === true;
  } catch (_) { return false; }
}
async function handleTelegramLetterReceipt(callback) {
  const match = typeof callback.data === "string" ? callback.data.match(/^lr:([A-Za-z0-9_-]{40,60})$/) : null;
  const pair = getChaysaTelegramPair();
  const senderId = String(callback.from && callback.from.id || "");
  const messageChatId = String(callback.message && callback.message.chat && callback.message.chat.id || "");
  if (!match || !pair || !pair.some(member => member.id === senderId && member.id === messageChatId)) {
    await answerTelegramCallback(callback.id, "این دکمه معتبر یا مجاز نیست.", true);
    return;
  }
  const found = findLetterByReceiptToken(match[1]);
  if (!found || found.row.deliveryStatus !== "sent") {
    await answerTelegramCallback(callback.id, "نامه معتبر یا ارسال‌شده پیدا نشد.", true);
    return;
  }
  const { rows, row } = found;
  if (row.receiptStatus !== "received") {
    row.receiptStatus = "received";
    row.receivedAt = new Date().toISOString();
    row.receiptMethod = "telegram_inline_button";
    row.receivedByTelegramId = senderId;
    try { saveLettersArchive(rows); }
    catch (_) {
      await answerTelegramCallback(callback.id, "ثبت دریافت در بایگانی انجام نشد؛ دوباره تلاش کنید.", true);
      return;
    }
    const notice = "تأیید دریافت نامه در بایگانی چایسا ثبت شد.\nشماره نامه: " + row.letterNumber + "\nزمان دریافت: " +
      new Date(row.receivedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
    const delivery = await notifyChaysaTelegramPair(notice);
    row.receiptNotificationStatus = delivery.status;
    row.receiptNotificationDeliveredCount = delivery.recipients.filter(item => item.sent).length;
    try { saveLettersArchive(rows); } catch (_) {}
  }
  await answerTelegramCallback(callback.id, "دریافت نامه در بایگانی ثبت شد.");
  await removeTelegramReceiptKeyboard(callback);
}
app.post("/telegram/webhook", async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const supplied = req.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || supplied !== expected) return res.sendStatus(403);
  try {
    const update = req.body || {};
    if (update.callback_query && typeof update.callback_query.data === "string" && update.callback_query.data.startsWith("lr:")) {
      await handleTelegramLetterReceipt(update.callback_query);
      return res.sendStatus(200);
    }
    const msg = update.message || update.edited_message;
    if (msg && msg.chat) saveTelegramRecipient(msg.chat);
    if (msg && msg.chat && msg.chat.type === "private" && typeof msg.text === "string") {
      const senderId = String(msg.chat.id);
      const text = msg.text.trim();
      const ownerId = String(process.env.CHAYSA_OWNER_CHAT_ID || "").trim();
      const allowedBostaniId = String(process.env.CHAYSA_BOSTANI_CHAT_ID || "").trim();
      const customerStart = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?$/i);
      if (customerStart && (!customerStart[1] || customerStart[1] === "order")) {
        await sendTelegramText(msg.chat.id, [
          "به ربات چایسا خوش آمدید.",
          "شناسه عددی گفت‌وگوی شما برای ثبت سفارش:",
          senderId,
          "این عدد را کپی کنید و در فرم خرید، پس از انتخاب تلگرام، در کادر شناسه گفت‌وگو وارد کنید.",
          "آیدی عمومی با @ برای ارسال فاکتور و وضعیت سفارش کافی نیست."
        ].join("\n"));
        return res.sendStatus(200);
      }
      if (text === "چایسا فایل") {
        if (ownerId && senderId === ownerId) {
          await sendTelegramText(msg.chat.id, buildOwnerProgressReport());
        } else if (allowedBostaniId && senderId === allowedBostaniId) {
          await sendTelegramText(msg.chat.id, buildBostaniProgressReport());
        }
        return res.sendStatus(200);
      }
      if (text.startsWith("/guide_approval")) {
        if (ownerId && senderId === ownerId) {
          const match = text.match(/^\/guide_approval(?:@\w+)?\s+([A-Za-z0-9._+-]{1,40})\s+([a-f0-9]{7,40})\s+(https:\/\/\S+)$/i);
          if (!match) {
            await sendTelegramText(msg.chat.id, "قالب دستور:\n/guide_approval <version> <commit-sha> <review-url>\nنمونه: /guide_approval 1.0.0 abcdef123456 https://chaysa.up.railway.app");
          } else {
            await requestGuideApproval(msg.chat.id, match[1], match[2], match[3]);
          }
        }
        return res.sendStatus(200);
      }
      const decision = text.match(/^(عدم\s+تأیید|عدم\s+تایید|تأیید|تایید)\s+([A-F0-9]{12})$/i);
      if (senderId === allowedBostaniId && decision) {
        const id = decision[2].toUpperCase();
        const rows = readGuideApprovals();
        const record = rows.find(x => x.id === id);
        if (!record || record.status !== "pending" || record.deliveryStatus !== "sent") {
          await sendTelegramText(msg.chat.id, "این درخواست تأیید معتبر یا فعال نیست.");
        } else {
          const approved = !decision[1].startsWith("عدم");
          record.status = approved ? "approved" : "rejected";
          record.reviewedAt = new Date().toISOString();
          record.reviewerTelegramId = String(msg.from && msg.from.id || msg.chat.id);
          try {
            saveGuideApprovals(rows);
            await sendTelegramText(msg.chat.id,
              (approved ? "تأیید نسخه ثبت شد." : "عدم تأیید نسخه ثبت شد.") +
              "\nنسخه: " + record.version +
              "\nCommit: " + record.commit +
              "\nشناسه: " + id +
              (approved ? "" : "\nبرای ثبت اشکالات، دستور /guide_note " + id + " <شرح اشکال> را ارسال کنید."),
              { remove_keyboard: true });
          } catch (_) {
            await sendTelegramText(msg.chat.id, "ثبت نتیجه در سابقه پایدار ناموفق بود؛ لطفاً دوباره تلاش کنید.");
          }
        }
        return res.sendStatus(200);
      }
      const note = text.match(/^\/guide_note(?:@\w+)?\s+([A-F0-9]{12})\s+([\s\S]{1,1000})$/i);
      if (senderId === allowedBostaniId && note) {
        const rows = readGuideApprovals();
        const record = rows.find(x => x.id === note[1].toUpperCase() && x.status === "rejected");
        if (!record) {
          await sendTelegramText(msg.chat.id, "شناسه نسخه پیدا نشد یا هنوز با عدم تأیید ثبت نشده است.");
        } else {
          record.reviewNote = note[2].trim();
          record.noteAt = new Date().toISOString();
          try {
            saveGuideApprovals(rows);
            await sendTelegramText(msg.chat.id, "توضیحات شما برای نسخه " + record.version + " ثبت شد.");
          } catch (_) {
            await sendTelegramText(msg.chat.id, "ثبت توضیحات انجام نشد؛ لطفاً دوباره تلاش کنید.");
          }
        }
        return res.sendStatus(200);
      }
    }
    const startMatch = msg && msg.chat && msg.chat.type === "private" &&
      typeof msg.text === "string" ? msg.text.trim().match(/^\/start(?:@\w+)?\s+(Q-[A-Za-z0-9-]+)$/i) : null;
    if (startMatch) {
      const rows = readQuestions();
      const question = rows.find(x => x.id === startMatch[1]);
      if (question) {
        question.customerChatId = String(msg.chat.id);
        question.customerUsername = msg.chat.username || "";
        question.customerName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ");
        question.linkedAt = new Date().toISOString();
        question.status = question.reply ? "پاسخ ثبت‌شده" : "در انتظار پاسخ";
        saveQuestions(rows);
        const token = process.env.TELEGRAM_BOT_TOKEN || "";
        if (token) await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: msg.chat.id, text: "اتصال شما به پرسش چایسا انجام شد. پاسخ همکارمون از همین گفت‌وگو براتون ارسال می‌شه." })
        });
      } else {
        const token = process.env.TELEGRAM_BOT_TOKEN || "";
        if (token) await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: msg.chat.id, text: "این پیوند پرسش معتبر نیست. لطفاً از فرم پرسش و پاسخ چایسا دوباره اقدام کنید." })
        });
      }
    }
    return res.sendStatus(200);
  } catch (_) { return res.sendStatus(500); }
});
app.get("/api/admin/telegram/recipients", requireAdmin, async (_req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return json(res, 503, { error: "توکن تلگرام تنظیم نشده است." });
  try {
    const base = "https://api.telegram.org/bot" + token + "/";
    const [meResponse, webhookResponse] = await Promise.all([fetch(base + "getMe"), fetch(base + "getWebhookInfo")]);
    const [me, webhook] = await Promise.all([meResponse.json(), webhookResponse.json()]);
    if (!meResponse.ok || me.ok !== true) return json(res, 502, { error: "توکن به یک ربات معتبر تلگرام متصل نیست." });
    if (!webhookResponse.ok || webhook.ok !== true) return json(res, 502, { error: "وضعیت وب‌هوک تلگرام قابل دریافت نیست." });
    const pair = getChaysaTelegramPair();
    const recipients = readTelegramRecipients();
    return json(res, 200, {
      recipients,
      chaysa_pair: {
        configured: Boolean(pair),
        linked: Boolean(pair && pair.every(member => recipients.some(x => x.id === member.id && x.linkedChatId === member.linkedChatId))),
        participants: pair ? pair.map(x => ({ chat_id: x.id, linked_chat_id: x.linkedChatId })) : []
      },
      bot_username: me.result.username || "",
      webhook_active: Boolean(webhook.result.url),
      webhook_url_matches: Boolean(webhook.result.url && webhook.result.url.endsWith("/telegram/webhook")),
      pending_update_count: webhook.result.pending_update_count || 0,
      last_webhook_error: webhook.result.last_error_message || ""
    });
  } catch (_) { return json(res, 502, { error: "ارتباط با تلگرام برقرار نشد." }); }
});
app.get("/api/admin/products", requireAdmin, (_req, res) => json(res, 200, readProducts()));
app.put("/api/admin/products", requireAdmin, (req, res) => {
  if (!Array.isArray(req.body) || req.body.length > 1000) return json(res, 400, { error: "ساختار اطلاعات معتبر نیست." });
  saveProducts(req.body);
  try {
    const queue = healthResearchQueue.syncCatalog(req.body);
    return json(res, 200, { ok: true, researchQueue: { total: queue.items.length, active: queue.items.filter(item => item.catalogActive).length } });
  } catch (_) {
    return json(res, 503, { ok: false, productSaved: true, error: "محصول ذخیره شد، اما همگام‌سازی صف پژوهش انجام نشد؛ وضعیت صف باید در پنل بررسی شود." });
  }
});
app.get("/api/admin/health-research/queue", requireAdmin, (_req, res) => {
  try {
    const queue = healthResearchQueue.syncCatalog(readProducts());
    return json(res, 200, queue);
  } catch (_) { return json(res, 500, { error: "دریافت صف پژوهش انجام نشد." }); }
});
app.post("/api/admin/health-research/queue/:id/suggestions", requireAdmin, async (req, res) => {
  if (limited("health-research-suggestions:" + (req.ip || "unknown"), 8, 60 * 1000))
    return json(res, 429, { error: "تعداد جست‌وجوهای پژوهشی زیاد است؛ کمی بعد دوباره تلاش کنید." });
  const query = typeof (req.body && req.body.query) === "string" ? req.body.query.trim().slice(0, 180) : "";
  if (!query) return json(res, 400, { error: "عبارت جست‌وجو الزامی است." });
  try {
    const result = await healthResearchQueue.searchPubMed(req.params.id, query);
    return json(res, 200, {
      ...result,
      notice: "این نتایج فقط سرنخ جست‌وجوی اولیه‌اند؛ ارتباط با ترکیبات و ویژگی‌های محصول باید جداگانه بررسی شود. نتایج به‌صورت خودکار به پرونده افزوده یا منتشر نمی‌شوند."
    });
  } catch (error) {
    const message = error && error.message ? error.message : "";
    const status = /پیدا نشد/.test(message) ? 404 : /فقط برای محصول فعال/.test(message) ? 409 : /عبارت جست‌وجو/.test(message) ? 400 : 502;
    return json(res, status, { error: status === 502 ? "جست‌وجوی رایگان PubMed موقتاً در دسترس نیست." : message });
  }
});
app.patch("/api/admin/health-research/queue/:id", requireAdmin, (req, res) => {
  try {
    const item = healthResearchQueue.updateItem(req.params.id, req.body || {});
    return json(res, 200, { ok: true, item });
  } catch (error) { return json(res, 400, { error: error.message || "ذخیره پرونده پژوهشی انجام نشد." }); }
});

const HEALTH_RESEARCH_EVIDENCE_DIR = path.join(DATA, "health-research-evidence");
fs.mkdirSync(HEALTH_RESEARCH_EVIDENCE_DIR, { recursive: true });
const healthResearchEvidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, HEALTH_RESEARCH_EVIDENCE_DIR),
    filename: (_req, file, cb) => {
      const ext = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" })[file.mimetype] || "";
      cb(null, crypto.randomUUID() + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.mimetype))
});
function isSupportedResearchEvidence(file) {
  const head = fs.readFileSync(file.path).subarray(0, 12);
  if (file.mimetype === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (file.mimetype === "image/png") return head.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (file.mimetype === "image/webp") return head.toString("ascii",0,4) === "RIFF" && head.toString("ascii",8,12) === "WEBP";
  if (file.mimetype === "application/pdf") return head.toString("ascii",0,5) === "%PDF-";
  return false;
}
app.post("/api/admin/health-research/queue/:id/evidence", requireAdmin, (req, res, next) => {
  if (limited("health-research-evidence-upload:" + (req.ip || "unknown"), 30, 60 * 60 * 1000))
    return json(res, 429, { error: "سقف بارگذاری مدارک پژوهشی در این ساعت تکمیل شده است." });
  return healthResearchEvidenceUpload.single("evidence")(req, res, error => {
    if (!error) return next();
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return json(res, status, { error: status === 413 ? "حجم فایل از ۱۰ مگابایت بیشتر است." : "فایل ارسالی معتبر نیست." });
  });
}, (req, res) => {
  const file = req.file;
  const cleanup = () => { if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path); };
  if (!file) return json(res, 400, { error: "یک فایل JPG، PNG، WebP یا PDF تا ۱۰ مگابایت انتخاب کنید." });
  if (!isSupportedResearchEvidence(file)) {
    cleanup();
    return json(res, 400, { error: "محتوای فایل با فرمت اعلام‌شده مطابقت ندارد." });
  }
  const state = healthResearchQueue.read();
  const allEvidence = state.items.flatMap(item => item.evidence || []);
  const totalBytes = allEvidence.reduce((sum, item) => sum + Number(item.size || 0), 0);
  if (allEvidence.length >= 500 || totalBytes + file.size > 100 * 1024 * 1024) {
    cleanup();
    return json(res, 413, { error: "ظرفیت بایگانی مدارک پژوهشی به سقف مجاز رسیده است." });
  }
  const fileId = crypto.randomUUID();
  const type = typeof req.body.type === "string" ? req.body.type : "";
  const metadata = {
    fileId,
    fileName: path.basename(file.filename),
    originalName: path.basename(String(file.originalname || "evidence")).slice(0, 180),
    mime: file.mimetype,
    size: file.size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(file.path)).digest("hex"),
    type
  };
  try {
    const item = healthResearchQueue.addEvidence(req.params.id, metadata);
    return json(res, 201, { ok: true, item });
  } catch (error) {
    cleanup();
    return json(res, 400, { error: error.message || "ثبت مدرک انجام نشد." });
  }
});
app.get("/api/admin/health-research/evidence/:id", requireAdmin, (req, res) => {
  const found = healthResearchQueue.getEvidence(req.params.id);
  if (!found || path.basename(found.evidence.fileName) !== found.evidence.fileName) return res.sendStatus(404);
  const filePath = path.join(HEALTH_RESEARCH_EVIDENCE_DIR, found.evidence.fileName);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "no-store");
  res.set("Content-Disposition", "attachment; filename=\"research-evidence\"");
  res.type(found.evidence.mime);
  return res.sendFile(filePath);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
      cb(null, crypto.randomUUID() + (ext || ".img"));
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/i.test(file.mimetype))
});

const HEALTH_ARCHIVE_DIR = path.join(DATA, "health-archive");
const HEALTH_ARCHIVE_FILE = path.join(DATA, "health-archive.json");
fs.mkdirSync(HEALTH_ARCHIVE_DIR, { recursive: true });
function readHealthArchive() {
  try {
    const rows = JSON.parse(fs.readFileSync(HEALTH_ARCHIVE_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
function saveHealthArchive(rows) {
  const tmp = HEALTH_ARCHIVE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, HEALTH_ARCHIVE_FILE);
}
const healthArchiveUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, HEALTH_ARCHIVE_DIR),
    filename: (_req, file, cb) => {
      const ext = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" })[file.mimetype] || "";
      cb(null, crypto.randomUUID() + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
});
function isSupportedEvidence(file) {
  const head = fs.readFileSync(file.path).subarray(0, 12);
  if (file.mimetype === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (file.mimetype === "image/png") return head.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (file.mimetype === "image/webp") return head.toString("ascii",0,4) === "RIFF" && head.toString("ascii",8,12) === "WEBP";
  return false;
}

const HEALTH_APPROVAL_REQUESTS_FILE = path.join(DATA, "health-approval-requests.json");
function readHealthApprovalRequests() {
  try {
    const rows = JSON.parse(fs.readFileSync(HEALTH_APPROVAL_REQUESTS_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
function saveHealthApprovalRequests(rows) {
  const tmp = HEALTH_APPROVAL_REQUESTS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, HEALTH_APPROVAL_REQUESTS_FILE);
}
function healthApprovalTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function findHealthApprovalRequest(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const hash = Buffer.from(healthApprovalTokenHash(token), "hex");
  const rows = readHealthApprovalRequests();
  const row = rows.find(item => {
    if (typeof item.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(item.tokenHash)) return false;
    const stored = Buffer.from(item.tokenHash, "hex");
    return stored.length === hash.length && crypto.timingSafeEqual(stored, hash);
  });
  return row ? { rows, row } : null;
}
function healthApprovalOriginAllowed(req) {
  const origin = req.get("origin");
  return !origin || origin === req.protocol + "://" + req.get("host");
}
const HEALTH_APPROVAL_LETTER = [
  "درخواست بررسی و اعلام نظر نهایی بخش مشاور سلامت فروشگاه اینترنتی چایسا",
  "",
  "سرکار خانم بستانی",
  "",
  "با سلام،",
  "بخش مستقل CHAYSA HEALTH با هدف فراهم‌کردن مرجعی ساختارمند برای آگاهی و انتخاب آگاهانه مشتریان فروشگاه اینترنتی چایسا طراحی شده است.",
  "",
  "برنامه توسعه این بخش، ایجاد بانک اطلاعاتی جامع و پویا درباره چای، دمنوش‌ها و محصولات گیاهی است. اطلاعات هر محصول بر پایه مستندات پزشکی و دارویی، منابع علمی معتبر و شواهد پژوهشی قابل استناد بررسی و پس از ارزیابی، دسته‌بندی و ثبت خواهد شد.",
  "",
  "با افزوده‌شدن محصولات جدید به فروشگاه، اطلاعات علمی متناسب با ماهیت و نوع محصول، ترکیبات، ویژگی‌ها، موارد احتیاط و تداخلات احتمالی آن‌ها نیز بررسی و به‌روزرسانی می‌شود. هدف، جلوگیری از انتشار ادعاهای درمانی تأییدنشده و توصیه‌های ناایمن است.",
  "",
  "این بخش برای افزایش آگاهی مشتریان طراحی شده و جایگزین تشخیص، درمان یا مشاوره تخصصی پزشک و داروساز نخواهد بود.",
  "",
  "خواهشمند است موارد زیر را بررسی و نظر نهایی خود را ثبت فرمایید:",
  "۱. محتوای معرفی و هدف بخش مشاور سلامت",
  "۲. ساختار و دسته‌بندی اطلاعات",
  "۳. مبانی علمی، اعتبار منابع و شیوه ارزیابی شواهد",
  "۴. هشدارهای ایمنی و نحوه بیان موارد احتیاط و تداخلات احتمالی",
  "۵. برنامه توسعه و به‌روزرسانی بانک اطلاعاتی",
  "",
  "لطفاً یکی از سه گزینه «تأیید می‌شود»، «تأیید نمی‌شود» یا «نیاز به اصلاح دارد» را انتخاب کنید. امکان درج توضیح نیز فراهم است.",
  "",
  "ثبت این نظر، سابقه بررسی در بایگانی داخلی چایسا ایجاد می‌کند و به‌تنهایی به معنای انتشار عمومی یا امضای الکترونیکی واجد شرایط قانونی نیست. لینک اختصاصی است؛ لطفاً آن را در اختیار دیگران قرار ندهید.",
  "",
  "با احترام،",
  "تیم طراحی و توسعه فروشگاه اینترنتی چایسا (CHAYSA)",
  "ناظر فنی و ایده‌پرداز: آقای نظام"
].join("\n");
app.post("/api/admin/health-approval/send", requireAdmin, async (req, res) => {
  if (limited("health-approval-send:" + (req.ip || "unknown"), 5, 60 * 60 * 1000))
    return json(res, 429, { error: "تعداد درخواست‌های ارسال در این ساعت بیش از حد مجاز است." });
  const bostaniChatId = String(process.env.CHAYSA_BOSTANI_CHAT_ID || "").trim();
  if (!/^-?\d+$/.test(bostaniChatId) || !process.env.TELEGRAM_BOT_TOKEN)
    return json(res, 503, { error: "تنظیمات امن ارسال تلگرام خانم بستانی کامل نیست." });
  const rows = readHealthApprovalRequests();
  const active = rows.find(item => item.status === "pending" && item.deliveryStatus === "sent" && item.expiresAt && Date.parse(item.expiresAt) > Date.now());
  if (active) return json(res, 409, { error: "یک درخواست بررسی فعال وجود دارد؛ برای جلوگیری از ایجاد لینک‌های موازی، ابتدا همان درخواست را پیگیری کنید.", requestId: active.id, expiresAt: active.expiresAt });
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const request = {
    id: crypto.randomUUID(),
    section: "CHAYSA HEALTH",
    status: "pending",
    tokenHash: healthApprovalTokenHash(token),
    reviewerChatId: bostaniChatId,
    version: "نسخه منتشرشده CHAYSA HEALTH در زمان ارسال",
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    deliveryStatus: "pending"
  };
  rows.push(request);
  try { saveHealthApprovalRequests(rows); }
  catch (_) { return json(res, 500, { error: "ایجاد درخواست بررسی در فضای پایدار انجام نشد." }); }
  const link = "https://chaysa.up.railway.app/health-approval.html#" + token;
  const message = [
    "درخواست رسمی بررسی بخش مشاور سلامت فروشگاه اینترنتی چایسا",
    "",
    "سرکار خانم بستانی،",
    "لطفاً متن نامه و موارد بررسی را در لینک اختصاصی زیر مطالعه و یکی از سه نتیجه را ثبت فرمایید:",
    link,
    "",
    "این لینک فقط برای شما صادر شده و تا ۷ روز اعتبار دارد. پس از ثبت نظر، نتیجه به‌صورت خودکار در بایگانی داخلی CHAYSA HEALTH ثبت و به حساب‌های مرتبط اطلاع‌رسانی می‌شود.",
    "ثبت این نظر، امضای الکترونیکی واجد شرایط قانونی محسوب نمی‌شود."
  ].join("\n");
  const sent = await sendTelegramText(bostaniChatId, message);
  request.deliveryStatus = sent ? "sent" : "failed";
  request.sentAt = sent ? new Date().toISOString() : null;
  try { saveHealthApprovalRequests(rows); }
  catch (_) { return json(res, 500, { error: "وضعیت ارسال ثبت نشد؛ پیش از تلاش مجدد، سوابق درخواست را بررسی کنید.", requestId: request.id }); }
  if (!sent) return json(res, 502, { error: "ارسال پیام تلگرام ناموفق بود؛ درخواست در سوابق با وضعیت ناموفق نگهداری شد.", requestId: request.id });
  return json(res, 201, { ok: true, requestId: request.id, deliveryStatus: "sent", expiresAt: request.expiresAt });
});

const LETTERS_ARCHIVE_FILE = path.join(DATA, "letters-archive.json");
function readLettersArchive() {
  try {
    const rows = JSON.parse(fs.readFileSync(LETTERS_ARCHIVE_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
function saveLettersArchive(rows) {
  const tmp = LETTERS_ARCHIVE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, LETTERS_ARCHIVE_FILE);
}
function getLetterDraftMeta(rows = readLettersArchive(), now = new Date()) {
  const dayKey = tehranDay(now);
  const count = rows.filter(row => row.dayKey === dayKey).length + 1;
  const letterNumber = "CHY-" + dayKey.replace(/-/g, "") + "-" + String(count).padStart(3, "0");
  const dateTime = now.toLocaleString("fa-IR", {
    timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  return { dayKey, letterNumber, dateTime };
}
function formatGeneralChaysaLetter(meta, body) {
  return [
    "CHAYSA | فروشگاه اینترنتی چایسا",
    "نامه رسمی",
    "شماره نامه: " + meta.letterNumber,
    "تاریخ و ساعت: " + meta.dateTime,
    "--------------------------------",
    body,
    "",
    "--------------------------------",
    "محمدرضا نظام",
    "ناظر کیفی و ایده‌پرداز فروشگاه اینترنتی چایسا (CHAYSA)"
  ].join("\n");
}
app.get("/api/admin/letters/meta", requireAdmin, (_req, res) => {
  return json(res, 200, getLetterDraftMeta());
});
app.get("/api/admin/letters", requireAdmin, (_req, res) => {
  const rows = readLettersArchive().slice(-50).reverse().map(({ receiptTokenHash, ...row }) => row);
  return json(res, 200, rows);
});
app.post("/api/admin/letters/archive", requireAdmin, (req, res) => {
  if (limited("admin-letter-archive:" + (req.ip || "unknown"), 30, 60 * 60 * 1000))
    return json(res, 429, { error: "تعداد ثبت نامه بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید." });
  const title = typeof (req.body && req.body.title) === "string"
    ? req.body.title.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  const body = typeof (req.body && req.body.text) === "string" ? req.body.text.trim() : "";
  if (!title || title.length > 160)
    return json(res, 400, { error: "عنوان نامه الزامی است و نباید بیشتر از ۱۶۰ نویسه باشد." });
  if (body.length > 3400)
    return json(res, 400, { error: "متن نامه نباید بیشتر از ۳۴۰۰ نویسه باشد." });
  const rows = readLettersArchive();
  if (rows.length >= 500)
    return json(res, 413, { error: "ظرفیت بایگانی نامه‌ها تکمیل است." });
  const now = new Date();
  const meta = getLetterDraftMeta(rows, now);
  const record = {
    id: crypto.randomUUID(),
    letterNumber: meta.letterNumber,
    dayKey: meta.dayKey,
    createdAt: now.toISOString(),
    dateTime: meta.dateTime,
    title,
    body,
    registeredBy: "محمدرضا نظام",
    formattedMessage: body ? formatGeneralChaysaLetter(meta, body) : "",
    signatureName: "محمدرضا نظام",
    signatureRole: "ناظر کیفی و ایده‌پرداز فروشگاه اینترنتی چایسا (CHAYSA)",
    recordType: "archive_only",
    deliveryStatus: "not_sent",
    deliveredCount: 0,
    sentAt: null,
    receiptStatus: "not_applicable",
    archivedOnly: true
  };
  rows.push(record);
  try { saveLettersArchive(rows); }
  catch (_) { return json(res, 500, { error: "ثبت نامه در بایگانی انجام نشد." }); }
  return json(res, 201, {
    ok: true,
    letterNumber: record.letterNumber,
    title: record.title,
    dateTime: record.dateTime,
    deliveryStatus: record.deliveryStatus,
    archivedOnly: true
  });
});
app.post("/api/admin/letters/send", requireAdmin, async (req, res) => {
  if (limited("admin-letter-send:" + (req.ip || "unknown"), 5, 60 * 60 * 1000))
    return json(res, 429, { error: "تعداد ارسال نامه بیش از حد مجاز است؛ یک ساعت بعد دوباره تلاش کنید." });
  const body = typeof (req.body && req.body.text) === "string" ? req.body.text.trim() : "";
  if (!body || body.length > 3400)
    return json(res, 400, { error: "متن نامه الزامی است و نباید بیشتر از ۳۴۰۰ نویسه باشد." });
  if (!process.env.TELEGRAM_BOT_TOKEN || !getChaysaTelegramPair())
    return json(res, 503, { error: "اتصال امن ربات یا پیوند دوطرفه حساب‌های تلگرام آماده نیست." });
  const rows = readLettersArchive();
  const now = new Date();
  const meta = getLetterDraftMeta(rows, now);
  const receiptToken = crypto.randomBytes(32).toString("base64url");
  const receiptTokenHash = crypto.createHash("sha256").update(receiptToken).digest("hex");
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "https://chaysa.up.railway.app").replace(/\/+$/, "");
  const message = formatGeneralChaysaLetter(meta, body) + "\n\nآیا نامه را دریافت کرده‌اید؟";
  const receiptKeyboard = {
    inline_keyboard: [[{ text: "بله، دریافت کردم", callback_data: "lr:" + receiptToken }]]
  };
  if (message.length > 4096)
    return json(res, 400, { error: "متن نهایی نامه از محدودیت پیام تلگرام بیشتر است." });
  const record = {
    id: crypto.randomUUID(),
    letterNumber: meta.letterNumber,
    dayKey: meta.dayKey,
    createdAt: now.toISOString(),
    dateTime: meta.dateTime,
    title: typeof (req.body && req.body.title) === "string" ? req.body.title.trim().slice(0, 160) : "",
    body,
    formattedMessage: message,
    signatureName: "محمدرضا نظام",
    signatureRole: "ناظر کیفی و ایده‌پرداز فروشگاه اینترنتی چایسا (CHAYSA)",
    deliveryStatus: "pending",
    deliveredCount: 0,
    recipientCount: 2,
    receiptTokenHash,
    receiptStatus: "pending",
    receivedAt: null,
    receiptNotificationStatus: null
  };
  rows.push(record);
  try { saveLettersArchive(rows.slice(-500)); }
  catch (_) { return json(res, 500, { error: "ذخیره اولیه نامه در بایگانی انجام نشد؛ هیچ پیامی ارسال نشد." }); }
  const pair = getChaysaTelegramPair();
  const recipients = await Promise.all(pair.map(async member => ({
    chatId: member.id,
    sent: await sendTelegramText(member.id, message, receiptKeyboard)
  })));
  const delivery = {
    status: recipients.every(x => x.sent) ? "sent" : recipients.some(x => x.sent) ? "partial" : "failed",
    recipients
  };
  record.deliveryStatus = delivery.status;
  record.deliveredCount = delivery.recipients.filter(item => item.sent).length;
  record.sentAt = record.deliveredCount ? new Date().toISOString() : null;
  try {
    const current = readLettersArchive();
    const saved = current.find(item => item.id === record.id);
    if (saved) {
      Object.assign(saved, {
        deliveryStatus: record.deliveryStatus,
        deliveredCount: record.deliveredCount,
        sentAt: record.sentAt
      });
      saveLettersArchive(current);
    }
  } catch (_) {
    return json(res, 500, { error: "وضعیت ارسال در بایگانی به‌روزرسانی نشد؛ پیش از ارسال مجدد، بایگانی را بررسی کنید.", letterNumber: record.letterNumber });
  }
  if (delivery.status !== "sent")
    return json(res, 502, {
      error: delivery.status === "partial"
        ? "نامه فقط به یکی از دو حساب تلگرام رسید؛ از ارسال مجدد خودکار جلوگیری شد."
        : "ارسال نامه به تلگرام ناموفق بود؛ وضعیت آن در بایگانی ثبت شد.",
      letterNumber: record.letterNumber,
      deliveredCount: record.deliveredCount,
      deliveryStatus: delivery.status
    });
  return json(res, 201, {
    ok: true,
    letterNumber: record.letterNumber,
    dateTime: record.dateTime,
    deliveredCount: record.deliveredCount,
    deliveryStatus: record.deliveryStatus
  });
});

function findLetterByReceiptToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const supplied = Buffer.from(crypto.createHash("sha256").update(token).digest("hex"), "hex");
  const rows = readLettersArchive();
  const row = rows.find(item => {
    if (typeof item.receiptTokenHash !== "string" || !/^[a-f0-9]{64}$/.test(item.receiptTokenHash)) return false;
    const stored = Buffer.from(item.receiptTokenHash, "hex");
    return stored.length === supplied.length && crypto.timingSafeEqual(stored, supplied);
  });
  return row ? { rows, row } : null;
}
function letterReceiptOriginAllowed(req) {
  const origin = req.get("origin");
  return !origin || origin === req.protocol + "://" + req.get("host");
}
app.post("/api/letter-receipt/view", (req, res) => {
  if (!letterReceiptOriginAllowed(req)) return json(res, 403, { error: "مبدأ درخواست معتبر نیست." });
  if (limited("letter-receipt-view:" + (req.ip || "unknown"), 30, 10 * 60 * 1000))
    return json(res, 429, { error: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." });
  const found = findLetterByReceiptToken(req.body && req.body.token);
  if (!found) return json(res, 404, { error: "پیوند دریافت نامه معتبر نیست." });
  const { row } = found;
  if (row.deliveryStatus !== "sent") return json(res, 403, { error: "ارسال این نامه به‌طور کامل تأیید نشده است." });
  return json(res, 200, {
    ok: true, letterNumber: row.letterNumber, dateTime: row.dateTime,
    body: row.body, signatureName: row.signatureName, signatureRole: row.signatureRole,
    receiptStatus: row.receiptStatus || "pending", receivedAt: row.receivedAt || null
  });
});
app.post("/api/letter-receipt/confirm", async (req, res) => {
  if (!letterReceiptOriginAllowed(req)) return json(res, 403, { error: "مبدأ درخواست معتبر نیست." });
  if (limited("letter-receipt-confirm:" + (req.ip || "unknown"), 10, 10 * 60 * 1000))
    return json(res, 429, { error: "تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." });
  const found = findLetterByReceiptToken(req.body && req.body.token);
  if (!found) return json(res, 404, { error: "پیوند دریافت نامه معتبر نیست." });
  const { rows, row } = found;
  if (row.deliveryStatus !== "sent") return json(res, 403, { error: "ارسال این نامه به‌طور کامل تأیید نشده است." });
  if (row.receiptStatus === "received")
    return json(res, 200, { ok: true, alreadyReceived: true, letterNumber: row.letterNumber, receivedAt: row.receivedAt });
  row.receiptStatus = "received";
  row.receivedAt = new Date().toISOString();
  row.receiptMethod = "private_bearer_link";
  try { saveLettersArchive(rows); }
  catch (_) { return json(res, 500, { error: "ثبت دریافت نامه در بایگانی انجام نشد؛ دوباره تلاش کنید." }); }
  const notice = "تأیید دریافت نامه در بایگانی چایسا ثبت شد.\nشماره نامه: " + row.letterNumber + "\nزمان دریافت: " +
    new Date(row.receivedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
  const delivery = await notifyChaysaTelegramPair(notice);
  row.receiptNotificationStatus = delivery.status;
  row.receiptNotificationDeliveredCount = delivery.recipients.filter(item => item.sent).length;
  try { saveLettersArchive(rows); } catch (_) {}
  return json(res, 200, {
    ok: true, letterNumber: row.letterNumber, receivedAt: row.receivedAt,
    notificationStatus: delivery.status
  });
});

app.post("/api/health-approval/view", (req, res) => {
  if (!healthApprovalOriginAllowed(req)) return json(res, 403, { error: "مبدأ درخواست معتبر نیست." });
  if (limited("health-approval-view:" + (req.ip || "unknown"), 30, 10 * 60 * 1000))
    return json(res, 429, { error: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." });
  const found = findHealthApprovalRequest(req.body && req.body.token);
  if (!found) return json(res, 404, { error: "لینک بررسی معتبر نیست." });
  const { row } = found;
  if (row.deliveryStatus !== "sent") return json(res, 403, { error: "این درخواست از مسیر رسمی ارسال نشده است." });
  if (Date.parse(row.expiresAt) <= Date.now()) return json(res, 410, { error: "مهلت این لینک به پایان رسیده است." });
  if (row.status !== "pending") return json(res, 409, { error: "این درخواست قبلاً تعیین تکلیف شده است.", decision: row.decision || null });
  return json(res, 200, { ok: true, letter: HEALTH_APPROVAL_LETTER, version: row.version, expiresAt: row.expiresAt });
});
app.post("/api/health-approval/decision", async (req, res) => {
  if (!healthApprovalOriginAllowed(req)) return json(res, 403, { error: "مبدأ درخواست معتبر نیست." });
  if (limited("health-approval-decision:" + (req.ip || "unknown"), 10, 10 * 60 * 1000))
    return json(res, 429, { error: "تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره تلاش کنید." });
  const token = req.body && req.body.token;
  const decision = req.body && req.body.decision;
  const reviewerName = typeof (req.body && req.body.reviewerName) === "string"
    ? req.body.reviewerName.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()
    : "";
  const note = typeof (req.body && req.body.note) === "string" ? req.body.note.trim().slice(0, 2000) : "";
  const allowed = ["تأیید می‌شود", "تأیید نمی‌شود", "نیاز به اصلاح دارد"];
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s\u200c-]{1,118}$/u.test(reviewerName))
    return json(res, 400, { error: "نام و نام خانوادگی را با حروف معتبر و بدون عدد وارد کنید." });
  if (!allowed.includes(decision)) return json(res, 400, { error: "گزینه ثبت نظر معتبر نیست." });
  const found = findHealthApprovalRequest(token);
  if (!found) return json(res, 404, { error: "لینک بررسی معتبر نیست." });
  const { rows: requests, row: request } = found;
  if (request.deliveryStatus !== "sent") return json(res, 403, { error: "این درخواست از مسیر رسمی ارسال نشده است." });
  if (Date.parse(request.expiresAt) <= Date.now()) return json(res, 410, { error: "مهلت این لینک به پایان رسیده است." });
  if (request.status !== "pending") return json(res, 409, { error: "این درخواست قبلاً ثبت شده است.", decision: request.decision || null });
  const archive = readHealthArchive();
  let record = archive.find(item => item.sourceRequestId === request.id);
  if (!record) {
    if (archive.length >= 200) return json(res, 413, { error: "ظرفیت بایگانی به سقف مجاز رسیده است." });
    record = {
      id: crypto.randomUUID(),
      section: "CHAYSA HEALTH",
      reviewerName,
      decision,
      version: request.version,
      commit: request.commit,
      note,
      recordedAt: new Date().toISOString(),
      evidenceFile: null,
      evidenceMime: null,
      evidenceSize: 0,
      evidenceType: "online_decision",
      sourceRequestId: request.id,
      reviewerIdentityMethod: "private_bearer_link",
      reviewerIdentityNote: "نام و نام خانوادگی توسط استفاده‌کننده لینک تایپ شده و مستقلاً احراز هویت نشده است؛ لینک اختصاصی به حساب تلگرام مقصد ارسال شده، اما این روش امضای الکترونیکی واجد شرایط یا احراز هویت حقوقی محسوب نمی‌شود.",
      telegramPair: (getChaysaTelegramPair() || []).map(member => ({
        chatId: member.id,
        linkedChatId: member.linkedChatId,
        pairKey: member.pairKey
      }))
    };
    archive.push(record);
    try { saveHealthArchive(archive); }
    catch (_) { return json(res, 500, { error: "ثبت نتیجه در بایگانی انجام نشد؛ دوباره تلاش کنید." }); }
  }
  request.status = "recorded";
  request.reviewerName = record.reviewerName;
  request.decision = record.decision;
  request.note = record.note;
  request.recordedAt = record.recordedAt;
  request.archiveRecordId = record.id;
  try { saveHealthApprovalRequests(requests); }
  catch (_) { return json(res, 500, { error: "نتیجه در بایگانی ثبت شده، اما وضعیت درخواست کامل نشد؛ برای جلوگیری از ثبت تکراری، پشتیبانی فنی باید بررسی کند." }); }
  if (!record.telegramNotification) {
    const notification = await notifyChaysaTelegramPair([
      "نتیجه بررسی بخش CHAYSA HEALTH در بایگانی ثبت شد.",
      "شناسه پرونده: " + record.id,
      "نتیجه: " + record.decision,
      "زمان ثبت: " + new Date(record.recordedAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }),
      "این ثبت از طریق لینک اختصاصی ارسال‌شده برای بررسی انجام شده است."
    ].join("\n"));
    record.telegramNotification = notification;
    try { saveHealthArchive(archive); } catch (_) {}
  }
  return json(res, 200, { ok: true, reviewerName: record.reviewerName, decision: record.decision, recordedAt: record.recordedAt, archiveRecordId: record.id });
});
app.get("/api/admin/health-archive", requireAdmin, (_req, res) => {
  const rows = readHealthArchive().slice(-200).reverse().map(({ evidenceFile, ...row }) => ({ ...row, hasEvidence: Boolean(evidenceFile) }));
  return json(res, 200, rows);
});
app.post("/api/admin/health-archive", requireAdmin, healthArchiveUpload.single("evidence"), async (req, res) => {
  const file = req.file;
  const reviewerName = typeof req.body.reviewerName === "string" ? req.body.reviewerName.trim().slice(0,120) : "";
  const decision = typeof req.body.decision === "string" ? req.body.decision.trim() : "";
  const version = typeof req.body.version === "string" ? req.body.version.trim().slice(0,80) : "";
  const commit = typeof req.body.commit === "string" ? req.body.commit.trim().toLowerCase() : "";
  const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0,2000) : "";
  const allowedDecisions = ["تأیید می‌شود", "تأیید نمی‌شود", "نیاز به اصلاح دارد"];
  const cleanup = () => { if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path); };
  if (!file || !reviewerName || !allowedDecisions.includes(decision) || !version ||
      (commit && !/^[a-f0-9]{7,40}$/.test(commit))) {
    cleanup();
    return json(res, 400, { error: "نام تأییدکننده، نسخه، نتیجه معتبر و تصویر مدرک الزامی است." });
  }
  if (!isSupportedEvidence(file)) {
    cleanup();
    return json(res, 400, { error: "محتوای فایل با فرمت تصویر اعلام‌شده مطابقت ندارد." });
  }
  const rows = readHealthArchive();
  const currentBytes = rows.reduce((sum, row) => sum + Number(row.evidenceSize || 0), 0);
  if (rows.length >= 200 || currentBytes + file.size > 100 * 1024 * 1024) {
    cleanup();
    return json(res, 413, { error: "ظرفیت بایگانی به سقف مجاز رسیده است." });
  }
  const record = {
    id: crypto.randomUUID(),
    section: "CHAYSA HEALTH",
    reviewerName,
    decision,
    version,
    commit: commit || null,
    note,
    recordedAt: new Date().toISOString(),
    evidenceFile: path.basename(file.filename),
    evidenceMime: file.mimetype,
    evidenceSize: file.size,
    telegramPair: (getChaysaTelegramPair() || []).map(member => ({
      chatId: member.id,
      linkedChatId: member.linkedChatId,
      pairKey: member.pairKey
    }))
  };
  try {
    rows.push(record);
    saveHealthArchive(rows);
    const notification = await notifyChaysaTelegramPair([
      "پرونده جدید در بایگانی CHAYSA HEALTH ثبت شد.",
      "شناسه پرونده: " + record.id,
      "نتیجه ثبت‌شده: " + record.decision,
      "بررسی‌کننده اعلام‌شده: " + record.reviewerName,
      "نسخه: " + record.version,
      "این اعلان اطلاع‌رسانی است؛ برای مشاهده مدرک وارد پنل مدیریت شوید."
    ].join("\n"));
    record.telegramNotification = notification;
    saveHealthArchive(rows);
    const { evidenceFile, ...publicRecord } = record;
    return json(res, 201, { ok: true, record: publicRecord });
  } catch (_) {
    cleanup();
    return json(res, 500, { error: "ذخیره پرونده در بایگانی انجام نشد." });
  }
});
app.get("/api/admin/health-archive/:id/evidence", requireAdmin, (req, res) => {
  const row = readHealthArchive().find(item => item.id === req.params.id);
  if (!row || !row.evidenceFile || path.basename(row.evidenceFile) !== row.evidenceFile) return res.sendStatus(404);
  const filePath = path.join(HEALTH_ARCHIVE_DIR, row.evidenceFile);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "no-store");
  res.type(row.evidenceMime || "application/octet-stream");
  return res.sendFile(filePath);
});

app.post("/api/admin/upload", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) return json(res, 400, { error: "فقط فایل تصویری تا ۵ مگابایت مجاز است." });
  return json(res, 200, { url: "/media/" + path.basename(req.file.filename) });
});
app.use("/media", express.static(MEDIA, { maxAge: "1y", immutable: true, fallthrough: false }));

const QUESTIONS_FILE = path.join(DATA, "questions.json");
function readQuestions(){try{const x=JSON.parse(fs.readFileSync(QUESTIONS_FILE,"utf8"));return Array.isArray(x)?x:[]}catch(_){return[]}}
function saveQuestions(rows){const t=QUESTIONS_FILE+".tmp";fs.writeFileSync(t,JSON.stringify(rows,null,2),"utf8");fs.renameSync(t,QUESTIONS_FILE)}
app.get("/api/admin/questions",requireAdmin,(_req,res)=>{
  const rows=readQuestions().map(q=>({
    id:q.id,createdAt:q.createdAt,question:q.question,status:q.status||"در انتظار اتصال مشتری",
    firstName:q.firstName||"",lastName:q.lastName||"",telegramUsername:q.telegramUsername||"",
    customerLinked:Boolean(q.customerChatId),customerUsername:q.customerUsername||"",
    customerName:q.customerName||"",reply:q.reply||"",repliedAt:q.repliedAt||""
  })).reverse();
  return json(res,200,rows);
});
app.post("/api/admin/questions/:id/reply",requireAdmin,async(req,res)=>{
  const key="question-reply:"+(req.ip||"unknown");
  if(limited(key,20,10*60*1000))return json(res,429,{ok:false,error:"تعداد پاسخ‌ها زیاد است؛ کمی بعد دوباره تلاش کنید."});
  const reply=typeof req.body.reply==="string"?req.body.reply.trim():"";
  if(!reply||reply.length>4000)return json(res,400,{ok:false,error:"متن پاسخ را کامل و معتبر وارد کنید."});
  const rows=readQuestions(),q=rows.find(x=>x.id===req.params.id);
  if(!q)return json(res,404,{ok:false,error:"پرسش پیدا نشد."});
  if(!q.customerChatId)return json(res,409,{ok:false,error:"مشتری هنوز اتصال تلگرام را کامل نکرده است."});
  const token=process.env.TELEGRAM_BOT_TOKEN||"";
  if(!token)return json(res,503,{ok:false,error:"اتصال ربات تلگرام آماده نیست."});
  const message=["پاسخ پرسش شما از چایسا 🌿","شناسه پرسش: "+q.id,"--------------------",reply].join("\n");
  try{
    const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:q.customerChatId,text:message,disable_web_page_preview:true})
    });
    const result=await response.json();
    if(!response.ok||result.ok!==true)return json(res,502,{ok:false,error:"ارسال پاسخ به تلگرام مشتری انجام نشد."});
  }catch(_){return json(res,502,{ok:false,error:"ارتباط با تلگرام برقرار نشد؛ پاسخ ارسال نشد."})}
  q.reply=reply;q.repliedAt=new Date().toISOString();q.status="پاسخ ارسال‌شده";saveQuestions(rows);
  return json(res,200,{ok:true,status:q.status,repliedAt:q.repliedAt});
});
app.get("/bostani.html", (req, res, next) => {
  const access = process.env.BOSTANI_ACCESS_TOKEN || "";
  const supplied = typeof req.query.key === "string" ? req.query.key : "";
  if (access && supplied) {
    const expected = Buffer.from(access), actual = Buffer.from(supplied);
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      res.cookie("chaysa_bostani", access, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.redirect(302, "/bostani.html");
    }
    return res.sendStatus(404);
  }
  next();
});
app.post("/api/bostani/login",(req,res)=>{
 const key=req.ip||"unknown";if(limited("bostani-login:"+key,6,15*60*1000))return json(res,429,{error:"تعداد تلاش زیاد است؛ کمی بعد دوباره امتحان کنید."});
 const supplied=typeof req.body.password==="string"?req.body.password:"";
 if(!bostaniSecret||supplied.length!==bostaniSecret.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(bostaniSecret)))return json(res,401,{error:"رمز دسترسی نادرست است."});
 const exp=String(Date.now()+8*60*60*1000);res.cookie("chaysa_bostani",exp+"."+signBostani(exp),{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:8*60*60*1000});return json(res,200,{ok:true});
});
app.post("/api/bostani/logout",(_req,res)=>{res.clearCookie("chaysa_bostani",{httpOnly:true,secure:true,sameSite:"strict",path:"/"});return json(res,200,{ok:true});});
app.get("/api/bostani/orders",requireBostani,(_req,res)=>{
 const allowedCustomerFields=["name","family","contact","messengerPlatform","messengerId","province","city","address","postal","notes"];
 const rows=readOrders().map(o=>({
  id:o.id,createdAt:o.createdAt,status:o.status||"در انتظار بررسی",
  statusNotification:o.statusNotification?{status:o.statusNotification.status,platform:o.statusNotification.platform,attemptedAt:o.statusNotification.attemptedAt||null,attempts:Number(o.statusNotification.attempts)||0,error:o.statusNotification.error||null}:null,
  customer:Object.fromEntries(allowedCustomerFields.map(k=>[k,String(o.customer&&o.customer[k]||"")])),
  items:Array.isArray(o.items)?o.items.map(x=>({sku:String(x.sku||""),name:String(x.name||""),qty:Number(x.qty)||0,unitPrice:Number(x.unitPrice)||0,lineTotal:Number(x.lineTotal)||0})):[],
  total:Number(o.total)||0
 })).reverse();
 return json(res,200,rows);
});
app.patch("/api/bostani/orders/:id/status",requireBostani,async(req,res)=>{
 if(!ORDER_STATUSES.includes(req.body.status))return json(res,400,{error:"وضعیت سفارش معتبر نیست."});
 const rows=readOrders(),o=rows.find(x=>x.id===req.params.id);if(!o)return json(res,404,{error:"سفارش پیدا نشد."});
 try {
  const result=await updateOrderStatus(rows,o,req.body.status);
  return json(res,200,{ok:true,id:o.id,status:o.status,updatedAt:o.updatedAt,changed:result.changed,customerNotification:result.notification});
 } catch (_) { return json(res,500,{error:"ثبت وضعیت سفارش انجام نشد."}); }
});
app.post("/api/bostani/orders/:id/status-notification/retry",requireBostani,async(req,res)=>{
 const rows=readOrders(),o=rows.find(x=>x.id===req.params.id);if(!o)return json(res,404,{error:"سفارش پیدا نشد."});
 try {
  const result=await retryOrderStatusNotification(rows,o);
  if(!result.ok)return json(res,409,{ok:false,error:result.error,customerNotification:o.statusNotification||null});
  return json(res,200,{ok:true,customerNotification:o.statusNotification});
 } catch (_) { return json(res,500,{ok:false,error:"ثبت نتیجه تلاش مجدد انجام نشد."}); }
});
app.get("/api/bostani/questions",requireBostani,(_req,res)=>{const rows=readQuestions().map(q=>({id:q.id,createdAt:q.createdAt,question:q.question,status:q.status||"در انتظار اتصال مشتری",firstName:q.firstName||"",lastName:q.lastName||"",telegramUsername:q.telegramUsername||"",customerLinked:Boolean(q.customerChatId),customerUsername:q.customerUsername||"",reply:q.reply||"",repliedAt:q.repliedAt||""})).reverse();return json(res,200,rows);});
app.post("/api/bostani/questions/:id/reply",requireBostani,async(req,res)=>{
 const key="bostani-reply:"+(req.ip||"unknown");if(limited(key,20,10*60*1000))return json(res,429,{ok:false,error:"تعداد پاسخ‌ها زیاد است؛ کمی بعد دوباره تلاش کنید."});
 const reply=typeof req.body.reply==="string"?req.body.reply.trim():"";if(!reply||reply.length>4000)return json(res,400,{ok:false,error:"متن پاسخ را کامل و معتبر وارد کنید."});
 const rows=readQuestions(),q=rows.find(x=>x.id===req.params.id);if(!q)return json(res,404,{ok:false,error:"پرسش پیدا نشد."});if(!q.customerChatId)return json(res,409,{ok:false,error:"مشتری هنوز اتصال تلگرام را کامل نکرده است."});
 const token=process.env.TELEGRAM_BOT_TOKEN||"";if(!token)return json(res,503,{ok:false,error:"اتصال ربات تلگرام آماده نیست."});
 const message=["پاسخ پرسش شما از چایسا 🌿","شناسه پرسش: "+q.id,"--------------------",reply].join("\n");
 try{const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:q.customerChatId,text:message,disable_web_page_preview:true})});const result=await response.json();if(!response.ok||result.ok!==true)return json(res,502,{ok:false,error:"ارسال پاسخ به تلگرام مشتری انجام نشد."});}catch(_){return json(res,502,{ok:false,error:"ارتباط با تلگرام برقرار نشد؛ پاسخ ارسال نشد."});}
 q.reply=reply;q.repliedAt=new Date().toISOString();q.status="پاسخ ارسال‌شده";saveQuestions(rows);return json(res,200,{ok:true,status:q.status,repliedAt:q.repliedAt});
});
app.post("/api/questions",async(req,res)=>{
  const key="question:"+(req.ip||"unknown");
  if(limited(key,5,10*60*1000))return json(res,429,{ok:false,error:"تعداد درخواست‌ها زیاد است. چند دقیقه بعد دوباره تلاش کنید."});
  const origin=req.get("origin");
  if(origin){
    try{if(new URL(origin).host!==req.get("host"))return json(res,403,{ok:false,error:"درخواست نامعتبر است."});}
    catch(_){return json(res,403,{ok:false,error:"درخواست نامعتبر است."});}
  }
  const b=req.body||{};
  const firstName=typeof b.firstName==="string"?b.firstName.trim():"";
  const lastName=typeof b.lastName==="string"?b.lastName.trim():"";
  const question=typeof b.question==="string"?b.question.trim():"";
  const telegramUsername=typeof b.telegramUsername==="string"?b.telegramUsername.trim().replace(/^@+/,""):"";
  if(!firstName||firstName.length>60||!lastName||lastName.length>80)
    return json(res,400,{ok:false,error:"نام و نام خانوادگی الزامی است و باید معتبر وارد شوند."});
  if(!question||question.length>2000)
    return json(res,400,{ok:false,error:"متن پرسش را کامل و معتبر وارد کنید."});
  if(!/^[A-Za-z0-9_]{5,32}$/.test(telegramUsername))
    return json(res,400,{ok:false,error:"آیدی تلگرام الزامی است و باید بدون @ و با حروف انگلیسی، عدد یا زیرخط وارد شود."});
  const token=process.env.TELEGRAM_BOT_TOKEN||"";
  const recipients=String(process.env.ORDER_CHAT_IDS||"").split(",").map(x=>x.trim()).filter(x=>/^-?\d+$/.test(x));
  if(!token||recipients.length!==2||new Set(recipients).size!==2)
    return json(res,503,{ok:false,error:"سامانه دریافت پرسش‌ها موقتاً آماده نیست. لطفاً بعداً تلاش کنید."});
  const now=new Date();
  const item={id:"Q-"+now.toISOString().replace(/[-:.TZ]/g,"").slice(0,14)+"-"+crypto.randomBytes(4).toString("hex").toUpperCase(),createdAt:now.toISOString(),firstName,lastName,question,telegramUsername,delivery:"در انتظار ارسال"};
  const rows=readQuestions();rows.push(item);
  try{saveQuestions(rows)}catch(_){return json(res,500,{ok:false,error:"ثبت پرسش انجام نشد. لطفاً دوباره تلاش کنید."})}
  const message=["پرسش جدید از فروشگاه چایسا","شناسه: "+item.id,"زمان: "+now.toLocaleString("fa-IR",{timeZone:"Asia/Tehran"}),"نام مشتری: "+firstName+" "+lastName,"آیدی تلگرام مشتری: @"+telegramUsername,"--------------------","متن پرسش:",question].join("\n");
  const [results,rubikaNotice]=await Promise.all([
    Promise.all(recipients.map(async chat_id=>{
      try{const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id,text:message,disable_web_page_preview:true})});const d=await r.json();return r.ok&&d.ok===true}catch(_){return false}
    })),
    notifyBostaniRubika(message)
  ]);
  item.delivered=results.filter(Boolean).length;
  item.delivery=item.delivered===2?"ارسال‌شده برای هر دو گیرنده":"ارسال ناقص";
  item.rubikaNotification={status:rubikaNotice.status,attemptedAt:rubikaNotice.status==="not_configured"?null:new Date().toISOString()};
  item.updatedAt=new Date().toISOString();
  try{const current=readQuestions();const saved=current.find(x=>x.id===item.id);if(saved){saved.delivered=item.delivered;saved.delivery=item.delivery;saved.rubikaNotification=item.rubikaNotification;saved.updatedAt=item.updatedAt;saveQuestions(current)}}catch(_){}
  if(item.delivered!==2)return json(res,502,{ok:false,error:"ارسال پرسش به هر دو گیرنده تلگرام کامل نشد. وضعیت ارسال روبیکا جداگانه ثبت شده است.",delivered:item.delivered,rubikaNotificationStatus:rubikaNotice.status,requestId:item.id});
  return json(res,200,{ok:true,delivered:2,rubikaNotificationStatus:rubikaNotice.status,requestId:item.id});
});
app.get("/api/telegram/customer-bot",async(req,res)=>{
 const key="telegram-customer-bot:"+(req.ip||"unknown");
 if(limited(key,30,10*60*1000))return json(res,429,{error:"درخواست‌های زیاد؛ کمی بعد دوباره تلاش کنید."});
 const token=process.env.TELEGRAM_BOT_TOKEN||"";
 if(!token)return json(res,503,{error:"اتصال ربات تلگرام در حال حاضر آماده نیست."});
 try{
  const response=await fetch("https://api.telegram.org/bot"+token+"/getMe");
  const result=await response.json();
  const username=String(result&&result.result&&result.result.username||"");
  if(!response.ok||result.ok!==true||!/^[A-Za-z0-9_]{5,32}$/.test(username))
   return json(res,503,{error:"نشانی ربات تلگرام قابل دریافت نیست."});
  res.set("Cache-Control","public, max-age=300");
  return json(res,200,{username,url:"https://t.me/"+username+"?start=order"});
 }catch(_){return json(res,503,{error:"ارتباط با تلگرام برقرار نشد."});}
});
app.post("/api/orders",async(req,res)=>{
 const key="order:"+(req.ip||"unknown");if(limited(key,5,10*60*1000))return json(res,429,{error:"تعداد درخواست‌ها زیاد است. چند دقیقه بعد دوباره تلاش کن."});
 const b=req.body||{},c=b.customer||{},fields=["name","family","contact","messengerPlatform","messengerId","province","city","address","postal","notes"];
 if(!["telegram","rubika"].includes(String(c.messengerPlatform||"")))return json(res,400,{error:"پیام‌رسان انتخابی باید تلگرام یا روبیکا باشد."});
 if(!fields.every(k=>typeof c[k]==="string"&&c[k].trim())||b.termsAccepted!==true||typeof b.termsAcceptedAt!=="string")return json(res,400,{error:"اطلاعات خریدار و تأیید صحت آن‌ها الزامی است."});
 if(!/^\d{10}$/.test(normalizeDigits(c.postal).replace(/[^0-9]/g,"")))return json(res,400,{error:"کد پستی باید دقیقاً ۱۰ رقم باشد."});
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)return json(res,400,{error:"سبد سفارش معتبر نیست."});
 const catalog=readProducts(),items=[];
 for(const x of b.items){const p=catalog.find(p=>String(p.sku)===String(x.sku)&&p.active!==false),qty=Number(x.qty);if(!p||!Number.isInteger(qty)||qty<1||qty>99)return json(res,400,{error:"کالا یا تعداد آن معتبر نیست؛ سبد را تازه‌سازی کنید."});items.push({sku:String(p.sku),name:String(p.name),qty,unitPrice:Number(p.price),lineTotal:Number(p.price)*qty})}
 const customerId=String(c.messengerId||"").trim();
 if(c.messengerPlatform==="telegram"&&!/^-?\d{5,20}$/.test(customerId))return json(res,400,{error:"شناسه گفت‌وگوی تلگرام معتبر نیست؛ ربات را Start کنید و شناسه عددی را وارد کنید."});
 if(c.messengerPlatform==="rubika"&&!/^[A-Za-z0-9_-]{12,80}$/.test(customerId))return json(res,400,{error:"شناسه گفت‌وگوی روبیکا معتبر نیست؛ ربات چایسا را Start کنید و شناسه ارسالی را وارد کنید."});
 const total=items.reduce((n,x)=>n+x.lineTotal,0),now=new Date();
 const order={id:"CH-"+now.toISOString().slice(0,10).replace(/-/g,"")+"-"+crypto.randomBytes(6).toString("hex").toUpperCase(),createdAt:now.toISOString(),status:"در انتظار بررسی",customer:Object.fromEntries(fields.map(k=>[k,String(c[k]).trim()])),termsAccepted:true,termsAcceptedAt:b.termsAcceptedAt,items,total,notification:{status:"pending",delivered:0,recipientCount:0,attemptedAt:null},deliveryRule:"تحویل سفارش باید فقط به خریدار و پس از احراز هویت و تطبیق شناسه سفارش انجام شود. خریدار فاکتور و شناسه اختصاصی را تا زمان دریافت نگهداری کند."};
 const rows=readOrders();rows.push(order);try{saveOrders(rows)}catch(_){return json(res,500,{error:"ذخیره سفارش انجام نشد؛ دوباره تلاش کنید."})}
 const invoice=["فاکتور سفارش چایسا","شناسه سفارش: "+order.id,"تاریخ: "+now.toLocaleString("fa-IR",{timeZone:"Asia/Tehran"}),"وضعیت: "+order.status,"مشخصات خریدار",c.name+" "+c.family,"تماس: "+c.contact,"پیام‌رسان انتخابی: "+(c.messengerPlatform==="rubika"?"روبیکا":"تلگرام"),"شناسه پیام‌رسان: "+c.messengerId,"استان/شهر: "+c.province+" / "+c.city,"نشانی: "+c.address,"کد پستی: "+c.postal,"توضیحات: "+c.notes,"اقلام سفارش",...items.map(x=>x.name+" | "+x.sku+" | "+x.qty+" × "+x.unitPrice.toLocaleString("en-US")+" = "+x.lineTotal.toLocaleString("en-US")+" تومان"),"جمع کل: "+total.toLocaleString("en-US")+" تومان",order.deliveryRule].join("\n");
 const token=process.env.TELEGRAM_BOT_TOKEN||"",recipients=String(process.env.ORDER_CHAT_IDS||"").split(",").map(x=>x.trim()).filter(x=>/^-?\d+$/.test(x));
 const configured=Boolean(token&&recipients.length===2&&new Set(recipients).size===2);
 const [telegramResults,rubikaNotice]=await Promise.all([
  configured?Promise.all(recipients.map(async id=>{try{const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:id,text:invoice,disable_web_page_preview:true})});const d=await r.json();return r.ok&&d.ok}catch(_){return false}})):Promise.resolve([]),
  notifyBostaniRubika(invoice)
 ]);
 const delivered=telegramResults.filter(Boolean).length;
 const notificationStatus=!configured?"not_configured":delivered===recipients.length?"sent":delivered>0?"partial":"failed";
 order.notification={status:notificationStatus,delivered,recipientCount:configured?recipients.length:0,attemptedAt:configured?new Date().toISOString():null,
  rubikaStatus:rubikaNotice.status,rubikaAttemptedAt:rubikaNotice.status==="not_configured"?null:new Date().toISOString()};
 let notificationStatusSaved=true;
 try{saveOrders(rows)}catch(_){notificationStatusSaved=false}
 let customerDelivered=c.messengerPlatform==="rubika"?await sendRubikaText(customerId,invoice):await sendTelegramText(customerId,invoice);
 order.customerDelivery={platform:c.messengerPlatform,status:customerDelivered?"sent":"failed",attemptedAt:new Date().toISOString()};
 let customerDeliveryStatusSaved=true;try{saveOrders(rows)}catch(_){customerDeliveryStatusSaved=false}
 return json(res,200,{ok:true,orderId:order.id,invoice,delivered,recipientCount:configured?recipients.length:0,notificationStatus,notificationStatusSaved,rubikaNotificationStatus:rubikaNotice.status,customerDeliveryStatus:order.customerDelivery.status,customerDeliveryStatusSaved});
});
// Do not expose server-side source, package metadata, or deployment configuration.
app.use((req, res, next) => {
  const blocked = new Set(["server.js", "package.json", "package-lock.json", "worker.js", "wrangler.toml", "CLOUDFLARE-SETUP.md", "guide-bank.json", "translated-sources.json", "BACKUP-STATUS.md", "DEVELOPMENT-CHECKPOINT.md"]);
  const name = decodeURIComponent((req.path || "").split("/").pop() || "");
  if (blocked.has(name) || name.startsWith(".")) return res.sendStatus(404);
  next();
});

app.use((req, res, next) => {
  const page = req.method === "GET" && (req.path === "/" || req.path === "/index.html" || /\\.html$/i.test(req.path));
  if (!page || req.path === "/admin.html" || req.path === "/bostani.html") return next();
  let visitor = (req.headers.cookie || "").match(/(?:^|;\\s*)chaysa_visitor=([A-Za-z0-9_-]+)/);
  let visitorId = visitor && visitor[1];
  if (!visitorId) {
    visitorId = crypto.randomBytes(18).toString("hex");
    res.cookie("chaysa_visitor", visitorId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 * 1000 });
  }
  const hashed = crypto.createHash("sha256").update(visitorId).digest("hex");
  const data = readAnalytics();
  const day = tehranDay();
  if (!data.site.daily[day]) data.site.daily[day] = { views: 0, visitors: [] };
  data.site.views = (data.site.views || 0) + 1;
  data.site.daily[day].views = (data.site.daily[day].views || 0) + 1;
  if (!data.site.visitors.includes(hashed)) data.site.visitors.push(hashed);
  if (!data.site.daily[day].visitors.includes(hashed)) data.site.daily[day].visitors.push(hashed);
  try { saveAnalytics(data); } catch (_) {}
  next();
});

app.get("/health-approval.html", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  return res.sendFile(path.join(ROOT, "health-approval.html"));
});
app.use(express.static(ROOT, {
  index: "index.html",
  dotfiles: "ignore",
  setHeaders(res, filePath) {
    if (/\.(?:html|json)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  }
}));
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return json(res, 400, { error: "حجم عکس نباید بیشتر از ۵ مگابایت باشد." });
  return json(res, 500, { error: "خطای داخلی سرور." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log("CHAYSA backup listening on " + port);
  try {
    const linked = syncChaysaTelegramPair();
    console.log("CHAYSA Telegram pair:", linked ? "linked" : "not configured");
  } catch (_) {
    console.log("CHAYSA Telegram pair: sync failed");
  }
  const rubikaToken=process.env.RUBIKA_BOT_TOKEN||"",rubikaKey=rubikaWebhookKey();
  if(rubikaToken&&rubikaKey){
    const url=(process.env.RUBIKA_WEBHOOK_URL||"https://chaysa.up.railway.app/rubika/webhook/"+rubikaKey).trim();
    fetch("https://botapi.rubika.ir/v3/"+rubikaToken+"/updateBotEndpoints",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({url,type:"ReceiveUpdate"})
    }).then(async response=>{
      let result;
      try{result=await response.json()}catch(_){
        console.log("Rubika webhook registration: failed", "http="+response.status, "reason=invalid_json");
        return;
      }
      const dataStatusValue=typeof(result&&result.data)==="string"?result.data:(result&&result.data&&result.data.status);
      const success=response.ok&&result&&result.status==="OK"&&["Done","OK"].includes(dataStatusValue);
      if(success){console.log("Rubika webhook registration: ok");return}
      const apiStatus=safeRubikaDiagnosticValue(result&&result.status);
      const dataStatus=safeRubikaDiagnosticValue(dataStatusValue);
      const errorCode=safeRubikaDiagnosticValue(
        result&&(result.error_code??result.errorCode??(result.data&&(result.data.error_code??result.data.errorCode??result.data.code)))
      );
      const responseKeys=result&&typeof result==="object"?Object.keys(result).map(safeRubikaDiagnosticValue).join(","):"none";
      const dataKeys=result&&result.data&&typeof result.data==="object"?Object.keys(result.data).map(safeRubikaDiagnosticValue).join(","):"none";
      console.log("Rubika webhook registration: failed", "http="+response.status, "api="+apiStatus, "data="+dataStatus, "code="+errorCode, "keys="+responseKeys, "dataKeys="+dataKeys);
      console.log("Rubika webhook unavailable; switching to official getUpdates polling.");
      void startRubikaPolling(rubikaToken);
    }).catch(error=>{
      console.log("Rubika webhook registration: failed", "reason=request_error", "type="+safeRubikaDiagnosticValue(error&&error.name));
      console.log("Rubika webhook unavailable; switching to official getUpdates polling.");
      void startRubikaPolling(rubikaToken);
    });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (token && webhookSecret) {
    const webhookUrl = (process.env.TELEGRAM_WEBHOOK_URL || "https://chaysa.up.railway.app/telegram/webhook").trim();
    fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret, allowed_updates: ["message"], drop_pending_updates: false })
    }).then(r => r.json()).then(result => console.log("Telegram webhook registration:", result.ok ? "ok" : "failed"))
      .catch(() => console.log("Telegram webhook registration failed"));
  }
});
