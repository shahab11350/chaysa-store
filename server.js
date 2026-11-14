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
app.get("/api/health", (_req, res) => json(res, 200, { ok: true, service: "chaysa-backup" }));
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
app.post("/api/admin/upload", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) return json(res, 400, { error: "فقط فایل تصویری تا ۵ مگابایت مجاز است." });
  return json(res, 200, { url: "/media/" + path.basename(req.file.filename) });
});
app.use("/media", express.static(MEDIA, { maxAge: "1y", immutable: true, fallthrough: false }));

app.post("/api/orders", async (req, res) => {
  const key = "order:" + (req.ip || "unknown");
  if (limited(key, 5, 10 * 60 * 1000)) return json(res, 429, { error: "تعداد درخواست‌ها زیاد است. چند دقیقه بعد دوباره تلاش کن." });
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 3900) return json(res, 400, { error: "متن سفارش خالی یا بیش از حد طولانی است." });
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const recipients = String(process.env.ORDER_CHAT_IDS || "").split(",").map(x => x.trim()).filter(x => /^-?\d+$/.test(x));
  if (!token || recipients.length !== 2 || new Set(recipients).size !== 2) return json(res, 503, { error: "تنظیمات محرمانه ارسال فاکتور هنوز کامل نشده است." });
  const results = await Promise.all(recipients.map(async chat_id => {
    try {
      const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, text: message, disable_web_page_preview: true })
      });
      const data = await r.json();
      return r.ok && data.ok === true;
    } catch (_) { return false; }
  }));
  if (results.some(x => !x)) return json(res, 502, { error: "ارسال فاکتور به هر دو گیرنده کامل نشد.", delivered: results.filter(Boolean).length });
  return json(res, 200, { ok: true, delivered: 2 });
});

// Do not expose server-side source, package metadata, or deployment configuration.
app.use((req, res, next) => {
  const blocked = new Set(["server.js", "package.json", "package-lock.json", "worker.js", "wrangler.toml", "CLOUDFLARE-SETUP.md", "BACKUP-STATUS.md", "DEVELOPMENT-CHECKPOINT.md"]);
  const name = decodeURIComponent((req.path || "").split("/").pop() || "");
  if (blocked.has(name) || name.startsWith(".")) return res.sendStatus(404);
  next();
});
app.use(express.static(ROOT, { index: "index.html", dotfiles: "ignore" }));
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return json(res, 400, { error: "حجم عکس نباید بیشتر از ۵ مگابایت باشد." });
  return json(res, 500, { error: "خطای داخلی سرور." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log("CHAYSA backup listening on " + port));
