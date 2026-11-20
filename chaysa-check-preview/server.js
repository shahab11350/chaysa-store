"use strict";
const http = require("node:http");
const crypto = require("node:crypto");

const USER = process.env.CHECK_PREVIEW_USER;
const PASS = process.env.CHECK_PREVIEW_PASSWORD;
const PORT = Number(process.env.PORT || 3000);

const html = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>CHAYSA CHECK | فاز ۲ — مسیر مشتری</title>
<style>
:root{color-scheme:dark;--bg:#090a0b;--panel:#121416;--panel2:#191b1d;--gold:#c9a85d;--gold2:#ead69c;--muted:#a8a39a;--line:#393329;--red:#a92c35;--green:#718b78}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% -15%,#292218 0,transparent 45%),var(--bg);color:#f1eee7;font:15px/1.9 Tahoma,Arial,sans-serif}
main{max-width:1040px;margin:auto;padding:26px 18px 60px}
header{border:1px solid var(--line);border-radius:18px;padding:26px;background:linear-gradient(135deg,#171717,#101112 65%,#201b11);box-shadow:0 18px 50px #0008}
.kicker{color:var(--gold);font-size:11px;letter-spacing:2px;direction:ltr;text-align:right;font-weight:bold}
h1{font-size:clamp(23px,4vw,34px);margin:8px 0;color:var(--gold2)}h2{font-size:21px;color:var(--gold2);margin:0 0 16px}h3{font-size:16px;color:var(--gold2);margin:0 0 8px}
p{margin:8px 0}.muted{color:var(--muted);font-size:13px}.banner{margin-top:18px;padding:12px 15px;border:1px solid #78643b;border-radius:10px;background:#211d14;color:#e8d8ad}
section{margin-top:18px;padding:22px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(160deg,var(--panel),#0f1112)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.item{padding:14px;border:1px solid #34302a;border-radius:11px;background:var(--panel2);min-width:0}
.num{color:var(--gold);font-size:12px;font-weight:bold}.item strong{display:block;color:#f3e8ca;margin:3px 0}
.tag{display:inline-block;border:1px solid #625333;border-radius:20px;padding:2px 9px;color:var(--gold2);font-size:11px;margin:3px}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.flow span{background:#1d1d1a;border:1px solid #55482c;border-radius:9px;padding:8px 11px;color:#eee1c2}.arrow{color:var(--gold);font-size:18px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border-bottom:1px solid #37332b;text-align:right;vertical-align:top}th{color:var(--gold2);background:#1c1a16}
ul{padding-right:22px;margin:8px 0}li{padding:3px 0}.ok{color:#a8c7ad}.warn{color:#e3c77e}.no{color:#e39a9d}
.status{border-right:3px solid var(--gold);padding:10px 14px;background:#1b1914;border-radius:7px;margin:10px 0}
footer{text-align:center;color:#777;font-size:11px;margin-top:24px}
@media(max-width:650px){main{padding:14px 10px 40px}.grid{grid-template-columns:1fr}section{padding:16px}header{padding:19px}table{font-size:12px}th,td{padding:8px}}
</style></head>
<body><main>
<header>
<div class="kicker">CHAYSA CONTROL / PHASE 02</div>
<h1>طراحی مسیر مشتری و کنترل داخلی</h1>
<p>فاز ۲ چِک — نسخه بازبینی مالک</p>
<div class="banner">پیش‌نمایش خصوصی برای مالک • فقط محتوای طراحی • داده ساختگی • بدون اتصال به سفارش، پرداخت، مشتری، تلگرام یا پایگاه داده عملیاتی</div>
</header>

<section><h2>۱. هدف و مرز فاز</h2>
<p>ترسیم مسیر کامل مشتری از ورود به فروشگاه تا تحویل و خدمات پس از فروش، و مشخص‌کردن کنترل‌ها و رخدادهایی که چِک باید در پشت صحنه مشاهده و ثبت کند.</p>
<div class="status"><strong>اصل نامرئی‌بودن:</strong> توسعه چِک نباید تا زمان تکمیل همه فازها، آزمون جامع و تأیید صریح مالک، تغییری در تجربه مشتری ایجاد کند. چِک ناظر مستقل است؛ چایسا مرجع اصلی عملیات و داده تجاری باقی می‌ماند.</div>
</section>

<section><h2>۲. مسیر مشتری — تجربه جاری حفظ می‌شود</h2>
<div class="grid">
<div class="item"><span class="num">۰۱</span><strong>ورود به سایت</strong><span class="muted">مشاهده صفحه اصلی و بخش‌های عمومی فعلی.</span></div>
<div class="item"><span class="num">۰۲</span><strong>مرور محصولات</strong><span class="muted">دسته‌بندی، جست‌وجو و مشاهده جزئیات و قیمت جاری.</span></div>
<div class="item"><span class="num">۰۳</span><strong>انتخاب و سبد</strong><span class="muted">انتخاب کالا و تعداد، بازبینی اقلام و جمع فاکتور.</span></div>
<div class="item"><span class="num">۰۴</span><strong>تکمیل اطلاعات</strong><span class="muted">فرم فعلی و فیلدهای الزامی؛ بدون افزودن فیلد یا تغییر متن.</span></div>
<div class="item"><span class="num">۰۵</span><strong>ثبت سفارش</strong><span class="muted">ثبت در مسیر فعلی چایسا و دریافت شناسه سفارش.</span></div>
<div class="item"><span class="num">۰۶</span><strong>دریافت فاکتور</strong><span class="muted">ارسال از کانال تلگرام طبق اتصال و رفتار مصوب فعلی.</span></div>
<div class="item"><span class="num">۰۷</span><strong>پرداخت خارج از درگاه</strong><span class="muted">طبق دستورالعمل واقعی چایسا؛ ثبت سفارش به‌معنای پرداخت نیست.</span></div>
<div class="item"><span class="num">۰۸</span><strong>بررسی پرداخت</strong><span class="muted">تصمیم نهایی تأیید یا رد پرداخت فقط با مالک است.</span></div>
<div class="item"><span class="num">۰۹</span><strong>آماده‌سازی و کنترل کیفیت</strong><span class="muted">فقط پس از تأیید معتبر پرداخت و مجوز گردش‌کار.</span></div>
<div class="item"><span class="num">۱۰</span><strong>بسته‌بندی و تحویل به حمل</strong><span class="muted">ثبت تحویل و کد شرکت حمل توسط متصدی مجاز.</span></div>
<div class="item"><span class="num">۱۱</span><strong>رهگیری و تحویل</strong><span class="muted">دریافت پیام‌های مرحله‌ای تلگرام و پیگیری سفارش.</span></div>
<div class="item"><span class="num">۱۲</span><strong>خدمات پس از فروش</strong><span class="muted">ثبت درخواست، رسیدگی، پاسخ و بستن پرونده با سابقه محفوظ.</span></div>
</div>
</section>

<section><h2>۳. مسیر داخلی چِک — پشت صحنه</h2>
<div class="flow"><span>رویداد معتبر</span><b class="arrow">←</b><span>اعتبارسنجی</span><b class="arrow">←</b><span>پرونده و شناسه رخداد</span><b class="arrow">←</b><span>ثبت سابقه</span></div>
<div class="grid" style="margin-top:12px">
<div class="item"><strong>ثبت و جلوگیری از تکرار</strong><span class="muted">کلید یکتای رویداد، زمان، منبع و پیوند امن با شناسه سفارش؛ ارسال دوباره نباید سفارش دوم بسازد.</span></div>
<div class="item"><strong>نظارت پرداخت</strong><span class="muted">وضعیت در انتظار بررسی؛ چِک پرداخت را تأیید نمی‌کند. تصمیم نهایی فقط توسط مالک ثبت می‌شود.</span></div>
<div class="item"><strong>دروازه آماده‌سازی</strong><span class="muted">تا پیش از تأیید انسانی معتبر، هیچ مجوزی برای آماده‌سازی صادر نمی‌شود.</span></div>
<div class="item"><strong>آماده‌سازی و QC</strong><span class="muted">ثبت مسئول، زمان شروع و پایان، کمبود، مغایرت و نتیجه کنترل کیفیت.</span></div>
<div class="item"><strong>بسته‌بندی و ارسال</strong><span class="muted">تطبیق اقلام، ثبت زمان تحویل به شرکت حمل و متصدی مسئول.</span></div>
<div class="item"><strong>رهگیری</strong><span class="muted">کد پستی شرکت حمل که به متصدی پیامک می‌شود دستی ثبت و برای مشتری ارسال می‌شود؛ کد رهگیری چایسا جدا نگهداری می‌شود.</span></div>
<div class="item"><strong>خدمات پس از فروش</strong><span class="muted">پرونده مستقل برای پرسش، شکایت، آسیب، مغایرت یا درخواست پیگیری.</span></div>
<div class="item"><strong>گزارش و هشدار</strong><span class="muted">هشدار به مالک فقط با شواهد رویدادی/فنی؛ گزارش مشتری به‌تنهایی اثبات خرابی نیست.</span></div>
</div>
</section>

<section><h2>۴. شناسه‌ها و وضعیت‌ها</h2>
<table><thead><tr><th>شناسه</th><th>کاربرد</th><th>قاعده</th></tr></thead><tbody>
<tr><td>شناسه سفارش چایسا</td><td>پرونده اصلی خرید</td><td>شناسه موجود حفظ می‌شود؛ جایگزین نمی‌شود.</td></tr>
<tr><td>شناسه رخداد چِک</td><td>ردیابی هشدار، خطا یا گزارش</td><td>یکتا، مستقل و قابل حسابرسی؛ به سفارش مرتبط پیوند می‌خورد.</td></tr>
<tr><td>کد رهگیری چایسا</td><td>پیگیری داخلی/مشتری در سامانه چایسا</td><td>مستقل از شناسه سفارش و کد شرکت حمل.</td></tr>
<tr><td>کد رهگیری شرکت حمل</td><td>رهگیری مرسوله نزد شرکت حمل</td><td>متصدی آن را از پیامک شرکت حمل دریافت و دستی ثبت می‌کند.</td></tr>
</tbody></table>
<h3 style="margin-top:18px">وضعیت‌های نظارتی پیشنهادی</h3>
<div class="flow"><span>ثبت‌شده</span><span>در انتظار بررسی پرداخت</span><span>پرداخت تأییدشده توسط مالک</span><span>مجاز برای آماده‌سازی</span><span>آماده‌سازی / QC</span><span>بسته‌بندی</span><span>تحویل به حمل</span><span>تحویل‌شده</span></div>
<p class="muted">این وضعیت‌ها در این پیش‌نمایش صرفاً مدل طراحی هستند؛ هیچ وضعیت سفارش واقعی را تغییر نمی‌دهند.</p>
</section>

<section><h2>۵. نقش‌ها و مرز اختیارات</h2>
<table><thead><tr><th>نقش</th><th>مجاز</th><th>ممنوع / ارجاع</th></tr></thead><tbody>
<tr><td>مالک</td><td>نظارت کامل؛ تصمیم نهایی پرداخت؛ لغو نهایی و بازپرداخت؛ مدیریت سیاست‌ها.</td><td>هر اقدام حساس باید با دلیل و سابقه ثبت شود.</td></tr>
<tr><td>متصدی سفارش</td><td>بررسی اولیه، پیگیری، ثبت کد حمل و ارجاع مغایرت.</td><td>تأیید نهایی پرداخت، لغو نهایی یا بازپرداخت ندارد.</td></tr>
<tr><td>آماده‌سازی / QC</td><td>فقط سفارش دارای مجوز؛ ثبت آماده‌سازی و کنترل کیفیت.</td><td>تغییر مبلغ، تأیید پرداخت یا لغو ندارد.</td></tr>
<tr><td>بسته‌بندی / ارسال</td><td>تطبیق بسته، ثبت تحویل و کد حمل.</td><td>تغییر اقلام یا تأیید پرداخت ندارد.</td></tr>
<tr><td>پشتیبانی</td><td>رسیدگی به درخواست مرتبط و ثبت نتیجه.</td><td>تصمیم مالی یا مشاهده اطلاعات خارج از نیاز کاری ندارد.</td></tr>
<tr><td>چِک</td><td>مشاهده مجاز، تحلیل، کشف مغایرت، ثبت رخداد، هشدار و پیشنهاد.</td><td>ثبت/لغو سفارش، تأیید پرداخت، تغییر موجودی/قیمت یا اقدام مستقل مشتری‌محور ندارد.</td></tr>
<tr><td>ربات تلگرام</td><td>اعلان و مشاهده محدودِ مجاز.</td><td>فرمان حساس یا تغییر وضعیت سفارش اجرا نمی‌کند.</td></tr>
</tbody></table>
<div class="status">هر متصدی فقط پنل و سفارش‌های تخصیص‌یافته به خودش را می‌بیند؛ محدودیت باید در سمت سرور اعمال و آزموده شود. اطلاعات کامل مشتری فقط در اختیار مالک است.</div>
</section>

<section><h2>۶. قواعد تجاری ثبت‌شده</h2>
<ul>
<li>تمام مراحل سفارش مشتری از طریق تلگرام اطلاع‌رسانی می‌شود؛ فقط پس از رخداد واقعی و مجاز.</li>
<li>پرسش مشتری به خانم بستانی ارجاع می‌شود و پاسخ از همان گفت‌وگو به مشتری برمی‌گردد.</li>
<li>اگر ارسال پاسخ شکست خورد، خطا اعلام می‌شود؛ ارسال مجدد خودکار انجام نمی‌شود و متصدی با فشردن دوباره دکمه اقدام می‌کند.</li>
<li>لغو نهایی فقط با مالک است. متصدی می‌تواند با مشتری تماس بگیرد و درخواست را ارجاع دهد.</li>
<li>بازپرداخت کامل پس از لغو نهایی، حداکثر ظرف ۷۲ ساعت انجام می‌شود.</li>
<li>آخرین موجودی به سفارش دارای فاکتور زودتر تعلق می‌گیرد؛ اختلاف یک‌ثانیه‌ای با زمان ثبت معتبر فاکتور سنجیده می‌شود.</li>
<li>کمبود موجودی را مسئول انبار گزارش می‌کند؛ مالک یا مسئول مجاز پنل، موجودی ثبت‌شده سایت را به‌روزرسانی می‌کند. اتصال خودکار انبار فرض نمی‌شود.</li>
<li>مسئول خرید معمولاً کمبود را در کمتر از یک هفته جبران می‌کند؛ یک هفته سقف استثنایی است، نه زمان معمول.</li>
</ul>
</section>

<section><h2>۷. استثناها و واکنش امن</h2>
<div class="grid">
<div class="item"><strong>سفارش تکراری / دوبار کلیک</strong><span class="muted">تشخیص idempotency؛ حفظ همان شناسه و جلوگیری از ثبت مجدد.</span></div>
<div class="item"><strong>قیمت یا موجودی تغییر کرده</strong><span class="muted">مقایسه با مرجع سرور؛ توقف همان مورد و ارجاع، بدون حدس.</span></div>
<div class="item"><strong>ثبت موفق، اعلان ناموفق</strong><span class="muted">سفارش ثبت‌شده حفظ می‌شود؛ نتیجه ارسال ثبت و از ثبت دوباره جلوگیری می‌شود.</span></div>
<div class="item"><strong>پرداخت مبهم یا ناقص</strong><span class="muted">توقف آماده‌سازی و ارجاع به مالک؛ تصویر رسید به‌تنهایی سند تأیید نیست.</span></div>
<div class="item"><strong>کمبود یا مغایرت در آماده‌سازی</strong><span class="muted">توقف همان قلم/مرحله، ثبت رخداد و ارجاع به نقش مسئول.</span></div>
<div class="item"><strong>ارسال پیام ناموفق</strong><span class="muted">ثبت خطا؛ برای پاسخ پرسش‌وپاسخ retry خودکار نداریم؛ اقدام مجدد دستی.</span></div>
<div class="item"><strong>کد حمل نامعتبر / تحویل ناموفق</strong><span class="muted">ثبت وضعیت نامشخص و پیگیری انسانی؛ پرونده بدون شاهد بسته نمی‌شود.</span></div>
<div class="item"><strong>لغو، مرجوعی یا شکایت</strong><span class="muted">ثبت درخواست؛ تصمیم مالی/لغو نهایی فقط مالک؛ بازپرداخت کامل حداکثر ۷۲ ساعت.</span></div>
</div>
</section>

<section><h2>۸. امنیت، حریم خصوصی و استقلال</h2>
<ul>
<li>دریافت داده از چایسا حداقلی، مجاز، ترجیحاً فقط‌خواندنی و قابل حسابرسی است.</li>
<li>هیچ دسترسی گسترده به پایگاه داده، اسرار یا اطلاعات کامل مشتریان برای چِک فرض نمی‌شود.</li>
<li>محیط توسعه فقط برای مالک؛ داده ساختگی؛ پیام‌رسان عملیاتی خاموش یا mock.</li>
<li>قطع یا خرابی چِک نباید عملیات سایت، اپ مشتری، سفارش، پرداخت، آماده‌سازی، ارسال یا پیام‌رسانی چایسا را مختل کند.</li>
<li>چِک فروشگاه موازی یا مرجع دوم داده تجاری نیست؛ چایسا تنها مرجع سفارش و عملیات است.</li>
<li>هیچ اتصال یا فرمان عملیاتی در این نسخه فعال نیست.</li>
</ul>
</section>

<section><h2>۹. معیار بازبینی و پذیرش فاز ۲</h2>
<ul>
<li>مسیر مشتری و مسیر داخلی چِک از هم تفکیک و همه مراحل پوشش داده شده‌اند.</li>
<li>دروازه پرداخت انسانی، اختیار انحصاری مالک و قفل آماده‌سازی روشن است.</li>
<li>شناسه سفارش، شناسه رخداد، کد رهگیری چایسا و کد حمل مستقل‌اند.</li>
<li>قواعد تلگرام، نقش‌ها، اطلاعات مشتری، لغو و بازپرداخت مطابق تصمیم‌های ثبت‌شده‌اند.</li>
<li>سناریوهای شکست و استثنا برای جلوگیری از ثبت تکراری و اقدام ناخواسته پوشش داده شده‌اند.</li>
<li>هیچ تغییری در تجربه مشتری یا منطق عملیاتی تا انتشار نهایی رخ نمی‌دهد.</li>
</ul>
<div class="status"><strong>وضعیت:</strong> طراحی فاز ۲ برای بازبینی مالک آماده شده است. تأیید نهایی مالک و آزمون‌های اجرایی مستقل هنوز انجام نشده‌اند؛ این صفحه به‌تنهایی به معنی تکمیل عملیاتی فاز نیست.</div>
</section>
<footer>CHAYSA CHECK • PHASE 02 • Owner review preview • No production integration</footer>
</main></body></html>`;

function secureEqual(a,b){const aa=Buffer.from(String(a));const bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
const server=http.createServer((req,res)=>{
  res.setHeader("Cache-Control","no-store, max-age=0");
  res.setHeader("Pragma","no-cache");
  res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if(!USER||!PASS){res.writeHead(503,{"Content-Type":"text/plain; charset=utf-8"});return res.end("Preview authentication is not configured.");}
  const auth=String(req.headers.authorization||"");
  let suppliedUser="",suppliedPass="";
  if(auth.startsWith("Basic ")){
    try{const decoded=Buffer.from(auth.slice(6),"base64").toString("utf8");const i=decoded.indexOf(":");if(i>=0){suppliedUser=decoded.slice(0,i);suppliedPass=decoded.slice(i+1)}}catch(_){}
  }
  if(!secureEqual(suppliedUser,USER)||!secureEqual(suppliedPass,PASS)){
    res.writeHead(401,{"WWW-Authenticate":'Basic realm="CHAYSA CHECK Phase 2 Owner Preview", charset="UTF-8"',"Content-Type":"text/plain; charset=utf-8"});
    return res.end("دسترسی فقط برای مالک مجاز است.");
  }
  if(req.method!=="GET"||!(req.url==="/"||req.url==="/index.html")){
    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});return res.end("Not found");
  }
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  res.end(html);
});
server.listen(PORT,"0.0.0.0");
