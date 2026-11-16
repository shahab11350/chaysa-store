const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
    return json(res, 200, { ok: false, allowed: false, reason: "unsafe_medical_request", message: "راهنمای چایسا برای تشخیص، درمان یا تغییر دارو طراحی نشده است. برای تصمیم درمانی با پزشک یا داروساز مشورت کنید." });
  const products = readProducts().filter(p => p && p.active !== false);
  const product = guideFindProduct(products, productSku, question);
  const serviceQuestion = guideContainsAny(normalized, rules.serviceTerms);
  const productQuestion = Boolean(product) || guideContainsAny(normalized, rules.productTopics);
  if (category === "services" && !serviceQuestion)
    return json(res, 200, { ok: false, allowed: false, reason: "needs_service_context", message: "لطفاً پرسش را به خرید، سفارش، پرداخت، ارسال یا پیگیری خدمات چایسا مرتبط کنید." });
  if (category === "products" && (!product || !productQuestion))
    return json(res, 200, { ok: false, allowed: false, reason: "needs_product", message: "برای ادامه، محصول موردنظر را از فهرست انتخاب کنید و پرسش را درباره همان محصول بنویسید." });
  if (category === "safety") {
    if (!product) return json(res, 200, { ok: false, allowed: false, reason: "needs_product", message: "ابتدا محصول چایسا را انتخاب کنید." });
    const interactionQuestion = guideContainsAny(normalized, ["تداخل", "دارو", "همزمان", "هم زمان"]);
    let q = "";
    if (interactionQuestion) {
      if (!medicine) return json(res, 200, { ok: false, allowed: false, reason: "needs_medicine", message: "برای بررسی تداخل، نام دارو را در فیلد جداگانه وارد کنید؛ اطلاعات شخصی یا شرح پرونده پزشکی را ننویسید." });
      q = '"' + product.name + '" "' + medicine + '" تداخل مصرف هم‌زمان interaction safety شواهد علمی ';
    } else {
      const safetyHits = (rules.safetyTopics || []).filter(t => normalized.includes(guideNormalize(t)));
      if (!safetyHits.length) return json(res, 200, { ok: false, allowed: false, reason: "needs_safety_context", message: "پرسش را درباره عوارض احتمالی، احتیاط، حساسیت، بارداری، شیردهی یا ایمنی مصرف محصول روشن‌تر کنید." });
      q = '"' + product.name + '" ' + safetyHits.join(" ") + " ایمنی مصرف safety شواهد علمی ";
    }
    q += "(" + (bank.healthPolicy.sourceDomains || []).map(d => "site:" + d).join(" OR ") + ")";
    const url = "https://www.google.com/search?q=" + encodeURIComponent(q);
    return json(res, 200, { ok: true, allowed: true, type: "medical_external_search", url,
      notice: bank.healthPolicy.notice || "", rule: bank.healthPolicy.rule || "" });
  }
  if (category === "products") {
    const topicHits = (rules.productTopics || []).filter(t => normalized.includes(guideNormalize(t)));
    const topics = topicHits.length ? topicHits.join(" ") : "اطلاعات محصول";
    const q = '"' + product.name + '" ' + topics + " اطلاعات رسمی";
    return json(res, 200, { ok: true, allowed: true, type: "product_external_search",
      url: "https://www.google.com/search?q=" + encodeURIComponent(q),
      notice: "اطلاعات ترکیبات و ویژگی‌ها باید با برچسب رسمی محصول تطبیق داده شود." });
  }
  if (category === "services" || (category === "custom" && serviceQuestion)) {
    const serviceHits = (rules.serviceTerms || []).filter(t => normalized.includes(guideNormalize(t)));
    if (!serviceHits.length) return json(res, 200, { ok: false, allowed: false, reason: "outside_scope", message: "این راهنما فقط برای پرسش‌های مرتبط با محصولات و خدمات چایسا طراحی شده است." });
    const q = "چایسا فروشگاه " + serviceHits.join(" ");
    return json(res, 200, { ok: true, allowed: true, type: "service_external_search",
      url: "https://www.google.com/search?q=" + encodeURIComponent(q),
      notice: "برای اطلاعات قطعی سفارش، فقط اطلاعیه‌ها و پیام‌های رسمی چایسا را ملاک قرار دهید." });
  }
  if (category === "custom" && product) {
    const topics = (rules.productTopics || []).filter(t => normalized.includes(guideNormalize(t)));
    const q = '"' + product.name + '" ' + (topics.length ? topics.join(" ") : "اطلاعات محصول");
    return json(res, 200, { ok: true, allowed: true, type: "product_external_search",
      url: "https://www.google.com/search?q=" + encodeURIComponent(q),
      notice: "اطلاعات محصول را با برچسب رسمی همان محصول تطبیق دهید." });
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
app.patch("/api/admin/orders/:id/status",requireAdmin,(req,res)=>{
 const allowed=["در انتظار بررسی","در حال آماده‌سازی","ارسال‌شده","تحویل‌شده","لغوشده"];
 if(!allowed.includes(req.body.status))return json(res,400,{error:"وضعیت سفارش معتبر نیست."});
 const rows=readOrders(),o=rows.find(x=>x.id===req.params.id);if(!o)return json(res,404,{error:"سفارش پیدا نشد."});
 o.status=req.body.status;o.updatedAt=new Date().toISOString();if(o.status==="تحویل‌شده")o.deliveredAt=o.updatedAt;saveOrders(rows);return json(res,200,{ok:true,order:o});
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
app.post("/telegram/webhook", async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const supplied = req.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || supplied !== expected) return res.sendStatus(403);
  try {
    const update = req.body || {};
    const msg = update.message || update.edited_message;
    if (msg && msg.chat) saveTelegramRecipient(msg.chat);
    if (msg && msg.chat && msg.chat.type === "private" && typeof msg.text === "string") {
      const senderId = String(msg.chat.id);
      const text = msg.text.trim();
      const ownerId = String(process.env.CHAYSA_OWNER_CHAT_ID || "").trim();
      const allowedBostaniId = String(process.env.CHAYSA_BOSTANI_CHAT_ID || "").trim();
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
  return json(res, 200, { ok: true });
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
app.get("/api/admin/health-archive", requireAdmin, (_req, res) => {
  const rows = readHealthArchive().slice(-200).reverse().map(({ evidenceFile, ...row }) => row);
  return json(res, 200, rows);
});
app.post("/api/admin/health-archive", requireAdmin, healthArchiveUpload.single("evidence"), (req, res) => {
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
app.get("/api/bostani/questions",requireBostani,(_req,res)=>{const rows=readQuestions().map(q=>({id:q.id,createdAt:q.createdAt,question:q.question,status:q.status||"در انتظار اتصال مشتری",firstName:q.firstName||"",lastName:q.lastName||"",telegramUsername:q.telegramUsername||"",customerLinked:Boolean(q.customerChatId),customerUsername:q.customerUsername||"",reply:q.reply||"",repliedAt:q.repliedAt||""})).reverse();return json(res,200,rows);});
app.post("/api/bostani/questions/:id/reply",requireBostani,async(req,res)=>{
 const key="bostani-reply:"+(req.ip||"unknown");if(limited(key,20,10*60*1000))return json(res,429,{ok:false,error:"تعداد پاسخ‌ها زیاد است؛ کمی بعد دوباره تلاش کنید."});
 const reply=typeof req.body.reply==="string"?req.body.reply.trim():"";if(!reply||reply.length>4000)return json(res,400,{ok:false,error:"متن پاسخ را کامل و معتبر وارد کنید."});
 const rows=readQuestions(),q=rows.find(x=>x.id===req.params.id);if(!q)return json(res,404,{ok:false,error:"پرسش پیدا نشد."});if(!q.customerChatId)return json(res,409,{ok:false,error:"مشتری هنوز اتصال تلگرام را کامل نکرده است."});
 const token=process.env.TELEGRAM_BOT_TOKEN||"";if(!token)return json(res,503,{ok:false,error:"اتصال ربات تلگرام آماده نیست."});
 const message=["پاسخ پرسش شما از چایسا 🌿","شناسه پرسش: "+q.id,"--------------------",reply].join("\\n");
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
  const results=await Promise.all(recipients.map(async chat_id=>{
    try{const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id,text:message,disable_web_page_preview:true})});const d=await r.json();return r.ok&&d.ok===true}catch(_){return false}
  }));
  item.delivered=results.filter(Boolean).length;
  item.delivery=item.delivered===2?"ارسال‌شده برای هر دو گیرنده":"ارسال ناقص";
  item.updatedAt=new Date().toISOString();
  try{const current=readQuestions();const saved=current.find(x=>x.id===item.id);if(saved){saved.delivered=item.delivered;saved.delivery=item.delivery;saved.updatedAt=item.updatedAt;saveQuestions(current)}}catch(_){}
  if(item.delivered!==2)return json(res,502,{ok:false,error:"ارسال پرسش به هر دو گیرنده کامل نشد. لطفاً کمی بعد دوباره تلاش کنید.",delivered:item.delivered,requestId:item.id});
  return json(res,200,{ok:true,delivered:2,requestId:item.id});
});
app.post("/api/orders",async(req,res)=>{
 const key="order:"+(req.ip||"unknown");if(limited(key,5,10*60*1000))return json(res,429,{error:"تعداد درخواست‌ها زیاد است. چند دقیقه بعد دوباره تلاش کن."});
 const b=req.body||{},c=b.customer||{},fields=["name","family","contact","messengerId","province","city","address","postal","notes"];
 if(!fields.every(k=>typeof c[k]==="string"&&c[k].trim())||b.termsAccepted!==true||typeof b.termsAcceptedAt!=="string")return json(res,400,{error:"اطلاعات خریدار و تأیید صحت آن‌ها الزامی است."});
 if(!/^\d{10}$/.test(normalizeDigits(c.postal).replace(/[^0-9]/g,"")))return json(res,400,{error:"کد پستی باید دقیقاً ۱۰ رقم باشد."});
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)return json(res,400,{error:"سبد سفارش معتبر نیست."});
 const catalog=readProducts(),items=[];
 for(const x of b.items){const p=catalog.find(p=>String(p.sku)===String(x.sku)&&p.active!==false),qty=Number(x.qty);if(!p||!Number.isInteger(qty)||qty<1||qty>99)return json(res,400,{error:"کالا یا تعداد آن معتبر نیست؛ سبد را تازه‌سازی کنید."});items.push({sku:String(p.sku),name:String(p.name),qty,unitPrice:Number(p.price),lineTotal:Number(p.price)*qty})}
 const total=items.reduce((n,x)=>n+x.lineTotal,0),now=new Date();
 const order={id:"CH-"+now.toISOString().slice(0,10).replace(/-/g,"")+"-"+crypto.randomBytes(6).toString("hex").toUpperCase(),createdAt:now.toISOString(),status:"در انتظار بررسی",customer:Object.fromEntries(fields.map(k=>[k,String(c[k]).trim()])),termsAccepted:true,termsAcceptedAt:b.termsAcceptedAt,items,total,deliveryRule:"تحویل سفارش باید فقط به خریدار و پس از احراز هویت و تطبیق شناسه سفارش انجام شود. خریدار فاکتور و شناسه اختصاصی را تا زمان دریافت نگهداری کند."};
 const rows=readOrders();rows.push(order);try{saveOrders(rows)}catch(_){return json(res,500,{error:"ذخیره سفارش انجام نشد؛ دوباره تلاش کنید."})}
 const invoice=["فاکتور سفارش چایسا","شناسه سفارش: "+order.id,"تاریخ: "+now.toLocaleString("fa-IR",{timeZone:"Asia/Tehran"}),"وضعیت: "+order.status,"مشخصات خریدار",c.name+" "+c.family,"تماس: "+c.contact,"شناسه پیام‌رسان: "+c.messengerId,"استان/شهر: "+c.province+" / "+c.city,"نشانی: "+c.address,"کد پستی: "+c.postal,"توضیحات: "+c.notes,"اقلام سفارش",...items.map(x=>x.name+" | "+x.sku+" | "+x.qty+" × "+x.unitPrice.toLocaleString("en-US")+" = "+x.lineTotal.toLocaleString("en-US")+" تومان"),"جمع کل: "+total.toLocaleString("en-US")+" تومان",order.deliveryRule].join("\n");
 const token=process.env.TELEGRAM_BOT_TOKEN||"",recipients=String(process.env.ORDER_CHAT_IDS||"").split(",").map(x=>x.trim()).filter(x=>/^-?\d+$/.test(x));
 let delivered=0;if(token&&recipients.length===2&&new Set(recipients).size===2){const rs=await Promise.all(recipients.map(async id=>{try{const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:id,text:invoice,disable_web_page_preview:true})});const d=await r.json();return r.ok&&d.ok}catch(_){return false}}));delivered=rs.filter(Boolean).length}
 return json(res,200,{ok:true,orderId:order.id,invoice,delivered});
});
// Do not expose server-side source, package metadata, or deployment configuration.
app.use((req, res, next) => {
  const blocked = new Set(["server.js", "package.json", "package-lock.json", "worker.js", "wrangler.toml", "CLOUDFLARE-SETUP.md", "guide-bank.json", "BACKUP-STATUS.md", "DEVELOPMENT-CHECKPOINT.md"]);
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

app.use(express.static(ROOT, { index: "index.html", dotfiles: "ignore" }));
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return json(res, 400, { error: "حجم عکس نباید بیشتر از ۵ مگابایت باشد." });
  return json(res, 500, { error: "خطای داخلی سرور." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log("CHAYSA backup listening on " + port);
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
