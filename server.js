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
  if (!bostaniSecret) return false;
  const raw = req.headers.cookie || "";
  const token = (raw.match(new RegExp("(?:^|;\\s*)chaysa_bostani=([^;]+)")) || [])[1];
  if (!token) return false;
  const parts=token.split("."), exp=parts[0], sig=parts[1];
  if (!exp || !sig || !/^\\d+$/.test(exp) || Number(exp)<Date.now()) return false;
  const expected=Buffer.from(signBostani(exp)), actual=Buffer.from(sig);
  return expected.length===actual.length && crypto.timingSafeEqual(expected,actual);
}
function requireBostani(req,res,next) {
  if(!isBostani(req)) return json(res,401,{error:"برای ورود به صفحهٔ اختصاصی خانم بستانی، رمز دسترسی را وارد کنید."});
  const origin=req.get("origin");
  if(origin && origin!==req.protocol+"://"+req.get("host")) return json(res,403,{error:"درخواست نامعتبر است."});
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
function saveTelegramRecipient(chat) {
  if (!chat || chat.type !== "private" || chat.id == null) return;
  const rows = readTelegramRecipients();
  const id = String(chat.id);
  const item = { id, username: chat.username || "", first_name: chat.first_name || "", type: "private" };
  const index = rows.findIndex(x => String(x.id) === id);
  if (index >= 0) rows[index] = item; else rows.push(item);
  fs.writeFileSync(TELEGRAM_RECIPIENTS_FILE + ".tmp", JSON.stringify(rows, null, 2), "utf8");
  fs.renameSync(TELEGRAM_RECIPIENTS_FILE + ".tmp", TELEGRAM_RECIPIENTS_FILE);
}
app.post("/telegram/webhook", async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const supplied = req.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || supplied !== expected) return res.sendStatus(403);
  try {
    const update = req.body || {};
    const msg = update.message || update.edited_message;
    if (msg && msg.chat) saveTelegramRecipient(msg.chat);
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
    return json(res, 200, {
      recipients: readTelegramRecipients(),
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
app.post("/api/bostani/login",(req,res)=>{
 const key=req.ip||"unknown";if(limited("bostani-login:"+key,6,15*60*1000))return json(res,429,{error:"تعداد تلاش زیاد است؛ کمی بعد دوباره امتحان کنید."});
 const supplied=typeof req.body.password==="string"?req.body.password:"";
 if(!bostaniSecret||supplied.length!==bostaniSecret.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(bostaniSecret)))return json(res,401,{error:"رمز دسترسی نادرست است."});
 const exp=String(Date.now()+8*60*60*1000);res.cookie("chaysa_bostani",exp+"."+signBostani(exp),{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:8*60*60*1000});return json(res,200,{ok:true});
});
app.post("/api/bostani/logout",(_req,res)=>{res.clearCookie("chaysa_bostani",{httpOnly:true,secure:true,sameSite:"strict",path:"/"});return json(res,200,{ok:true});});
app.get("/api/bostani/questions",requireBostani,(_req,res)=>{const rows=readQuestions().map(q=>({id:q.id,createdAt:q.createdAt,question:q.question,status:q.status||"در انتظار اتصال مشتری",customerLinked:Boolean(q.customerChatId),customerUsername:q.customerUsername||"",reply:q.reply||"",repliedAt:q.repliedAt||""})).reverse();return json(res,200,rows);});
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
  const question=typeof b.question==="string"?b.question.trim():"";
  const telegramUsername=typeof b.telegramUsername==="string"?b.telegramUsername.trim().replace(/^@+/,""):"";
  if(!question||question.length>2000)
    return json(res,400,{ok:false,error:"متن پرسش را کامل و معتبر وارد کنید."});
  if(!/^[A-Za-z0-9_]{5,32}$/.test(telegramUsername))
    return json(res,400,{ok:false,error:"آیدی تلگرام الزامی است و باید بدون @ و با حروف انگلیسی، عدد یا زیرخط وارد شود."});
  const token=process.env.TELEGRAM_BOT_TOKEN||"";
  const recipients=String(process.env.ORDER_CHAT_IDS||"").split(",").map(x=>x.trim()).filter(x=>/^-?\d+$/.test(x));
  if(!token||recipients.length!==2||new Set(recipients).size!==2)
    return json(res,503,{ok:false,error:"سامانه دریافت پرسش‌ها موقتاً آماده نیست. لطفاً بعداً تلاش کنید."});
  const now=new Date();
  const item={id:"Q-"+now.toISOString().replace(/[-:.TZ]/g,"").slice(0,14)+"-"+crypto.randomBytes(4).toString("hex").toUpperCase(),createdAt:now.toISOString(),question,telegramUsername,delivery:"در انتظار ارسال"};
  const rows=readQuestions();rows.push(item);
  try{saveQuestions(rows)}catch(_){return json(res,500,{ok:false,error:"ثبت پرسش انجام نشد. لطفاً دوباره تلاش کنید."})}
  const message=["پرسش جدید از فروشگاه چایسا","شناسه: "+item.id,"زمان: "+now.toLocaleString("fa-IR",{timeZone:"Asia/Tehran"}),"آیدی تلگرام مشتری: @"+telegramUsername,"--------------------","متن پرسش:",question].join("\n");
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
app.listen(port, "0.0.0.0", () => {
  console.log("CHAYSA backup listening on " + port);
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (token && webhookSecret) {
    const webhookUrl = "https://chaysa-backup-store-production.up.railway.app/telegram/webhook";
    fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret, allowed_updates: ["message"], drop_pending_updates: false })
    }).then(r => r.json()).then(result => console.log("Telegram webhook registration:", result.ok ? "ok" : "failed"))
      .catch(() => console.log("Telegram webhook registration failed"));
  }
});
