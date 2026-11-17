const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

const adminPassword = process.env.ADMIN_PASSWORD || "";
if (adminPassword.length < 16) {
  throw new Error("ADMIN_PASSWORD must be set to a unique value of at least 16 characters");
}
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const dataDir = process.env.DATA_DIR || path.join(os.tmpdir(), "chaysa-media-preview");
const mediaDir = path.join(dataDir, "media");
const tempDir = path.join(dataDir, "tmp");
const indexFile = path.join(dataDir, "media-library.json");
fs.mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
sharp.concurrency(1);

const rateWindows = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const old = rateWindows.get(key);
  if (!old || old.until <= now) {
    rateWindows.set(key, { count: 1, until: now + windowMs });
    return false;
  }
  old.count++;
  return old.count > max;
}
function json(res, status, value) {
  return res.status(status).set("Cache-Control", "no-store").json(value);
}
function signature(exp) {
  return crypto.createHmac("sha256", sessionSecret).update(exp).digest("hex");
}
function isAdmin(req) {
  const raw = req.headers.cookie || "";
  const token = (raw.match(/(?:^|;\\s*)chaysa_preview=([^;]+)/) || [])[1];
  if (!token) return false;
  const [exp, supplied] = token.split(".");
  if (!/^\\d+$/.test(exp || "") || Number(exp) < Date.now() || !supplied) return false;
  const expected = Buffer.from(signature(exp));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return json(res, 401, { error: "ابتدا وارد نمونه آزمایشی شوید." });
  const origin = req.get("origin");
  if (origin && origin !== req.protocol + "://" + req.get("host")) {
    return json(res, 403, { error: "درخواست نامعتبر است." });
  }
  next();
}
app.post("/api/login", (req, res) => {
  const key = "login:" + (req.ip || "unknown");
  if (rateLimited(key, 5, 15 * 60 * 1000)) {
    return json(res, 429, { error: "تلاش‌های ورود بیش از حد مجاز است؛ ۱۵ دقیقه بعد دوباره امتحان کنید." });
  }
  const supplied = typeof req.body.password === "string" ? req.body.password : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(adminPassword);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return json(res, 401, { error: "رمز ورود صحیح نیست." });
  const exp = String(Date.now() + 8 * 60 * 60 * 1000);
  res.cookie("chaysa_preview", exp + "." + signature(exp), {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 * 1000
  });
  return json(res, 200, { ok: true });
});
app.post("/api/logout", requireAdmin, (_req, res) => {
  res.clearCookie("chaysa_preview", { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  return json(res, 200, { ok: true });
});
app.get("/api/auth", (req, res) => json(res, 200, { authenticated: isAdmin(req) }));
app.get("/api/health", (_req, res) => json(res, 200, { ok: true, service: "chaysa-media-preview" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, ""))
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\\/(jpeg|png|webp|avif)|audio\\/(mpeg|mp4|aac|ogg|wav|webm|x-wav)|video\\/(mp4|quicktime|webm|x-matroska))$/i;
    cb(null, allowed.test(file.mimetype));
  }
});

function readIndex() {
  try {
    const rows = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (_) { return []; }
}
function saveIndex(rows) {
  const tmp = indexFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, indexFile);
}
let mediaProcessing = false;
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-filter_threads", "1", ...args], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let error = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) { settled = true; reject(new Error("media_processing_timeout")); }
    }, 120000);
    child.stderr.on("data", chunk => { error = (error + chunk.toString()).slice(-3000); });
    child.on("error", cause => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(cause); }
    });
    child.on("close", code => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      code === 0 ? resolve() : reject(new Error(error || "media_conversion_failed"));
    });
  });
}
app.get("/api/admin/media", requireAdmin, (_req, res) => {
  const rows = readIndex().map(({ id, name, kind, mime, size, originalSize, createdAt, url }) =>
    ({ id, name, kind, mime, size, originalSize, createdAt, url }));
  return json(res, 200, rows);
});
app.post("/api/admin/media", requireAdmin, upload.single("media"), async (req, res) => {
  if (!req.file) return json(res, 400, { error: "فرمت فایل پشتیبانی نمی‌شود یا فایلی انتخاب نشده است." });
  const source = req.file.path;
  if (mediaProcessing) {
    try { fs.unlinkSync(source); } catch (_) {}
    return json(res, 429, { error: "پردازش فایل دیگری در جریان است؛ کمی بعد دوباره تلاش کنید." });
  }
  mediaProcessing = true;
  const id = crypto.randomUUID();
  const inputBytes = req.file.size;
  const kind = req.file.mimetype.startsWith("image/") ? "image" : req.file.mimetype.startsWith("audio/") ? "audio" : "video";
  const outputName = id + (kind === "image" ? ".webp" : kind === "audio" ? ".mp3" : ".mp4");
  const output = path.join(mediaDir, outputName);
  try {
    if (kind === "image") {
      const image = sharp(source, { failOn: "error", limitInputPixels: 40000000 });
      const meta = await image.metadata();
      if (!["jpeg", "png", "webp", "avif"].includes(meta.format)) throw new Error("unsupported_image");
      await image.rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 5 }).toFile(output);
    } else if (kind === "audio") {
      await runFfmpeg(["-i", source, "-vn", "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-threads:a", "1", output]);
    } else {
      await runFfmpeg(["-i", source, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-threads:v", "1",
        "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-threads:a", "1", "-b:a", "96k",
        "-movflags", "+faststart", "-pix_fmt", "yuv420p", output]);
    }
    const stat = fs.statSync(output);
    if (!stat.size) throw new Error("empty_output");
    if (stat.size >= inputBytes) throw new Error("no_size_reduction");
    const row = {
      id, name: path.basename(req.file.originalname || outputName).slice(0, 180), kind,
      mime: kind === "image" ? "image/webp" : kind === "audio" ? "audio/mpeg" : "video/mp4",
      file: outputName, size: stat.size, originalSize: inputBytes,
      createdAt: new Date().toISOString(), url: "/media/" + outputName
    };
    const rows = readIndex();
    rows.unshift(row);
    saveIndex(rows);
    return json(res, 201, {
      id: row.id, name: row.name, kind: row.kind, mime: row.mime, size: row.size,
      originalSize: row.originalSize, createdAt: row.createdAt, url: row.url
    });
  } catch (error) {
    try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (_) {}
    console.error("Preview media processing failed:", String(error && error.message || "unknown").slice(0, 300));
    return json(res, 422, { error: "پردازش فایل انجام نشد؛ فرمت یا محتوای فایل را بررسی کنید." });
  } finally {
    try { if (fs.existsSync(source)) fs.unlinkSync(source); } catch (_) {}
    mediaProcessing = false;
  }
});
app.delete("/api/admin/media/:id", requireAdmin, (req, res) => {
  const rows = readIndex();
  const row = rows.find(item => item.id === req.params.id);
  if (!row || path.basename(row.file || "") !== row.file) return json(res, 404, { error: "فایل پیدا نشد." });
  try {
    const filePath = path.join(mediaDir, row.file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    saveIndex(rows.filter(item => item.id !== row.id));
    return json(res, 200, { ok: true });
  } catch (_) { return json(res, 500, { error: "حذف فایل انجام نشد." }); }
});
app.use("/media", requireAdmin, express.static(mediaDir, { maxAge: "1h", fallthrough: false }));
app.get("/", (_req, res) => res.set("Cache-Control", "no-store").sendFile(path.join(__dirname, "index.html")));
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return json(res, 400, { error: "حجم فایل نباید بیشتر از ۱۰۰ مگابایت باشد." });
  return json(res, 500, { error: "خطای داخلی سرور." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log("CHAYSA media preview listening on " + port));
