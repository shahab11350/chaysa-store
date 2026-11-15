# اتصال امن ربات تلگرام چایسا با Cloudflare Workers

این سرویس یک پل مستقل بین پنل مالک و Telegram Bot API است. کد در شاخه توسعه قرار می‌گیرد و به‌تنهایی روی سایت اصلی منتشر نمی‌شود.

## 1) ساخت منابع Cloudflare
1. در Cloudflare Dashboard وارد Workers & Pages شوید و یک Worker با نامی مانند `chaysa-telegram` بسازید.
2. فایل `cloudflare/telegram-worker.js` را به‌عنوان کد Worker قرار دهید و Deploy کنید.
3. در Storage & Databases > KV یک namespace بسازید و آن را با binding نام `CHAYSA_TELEGRAM_KV` به Worker وصل کنید.

## 2) افزودن تنظیمات محرمانه
در Worker > Settings > Variables and Secrets این مقادیر را ثبت کنید؛ مقادیر محرمانه را فقط در داشبورد وارد کنید:
- Secret: `TELEGRAM_BOT_TOKEN` — توکن تازه‌ای که از BotFather گرفته‌اید.
- Secret: `TELEGRAM_WEBHOOK_SECRET` — یک رشته تصادفی طولانی (فقط حروف و اعداد، 32 تا 64 کاراکتر).
- Variable: `ACCESS_TEAM_DOMAIN` — دامنهٔ تیم Cloudflare Access، مانند `https://team-name.cloudflareaccess.com`.
- Variable: `ACCESS_AUD` — مقدار AUD مربوط به اپلیکیشن Access که از تنظیمات اپ دریافت می‌شود.
- Variable: `OWNER_EMAIL` — ایمیل حساب مالک که اجازهٔ فراخوانی اعلان‌ها را دارد.
- Variable: `ADMIN_TELEGRAM_USERNAMES` — نام‌های کاربری مجاز برای دریافت اعلان، بدون @ و جداشده با کاما؛ مثلاً `artshahab,Bostani1346`.
- Variable: `ALLOWED_PANEL_ORIGINS` — مبدأ دقیق پنل پس از استقرار (فعلاً تا زمان تعیین دامنهٔ نهایی خالی بماند).

## 3) محدودکردن API اعلان‌ها
در Cloudflare Zero Trust > Access یک Self-hosted application برای مسیر `/telegram/notify*` بسازید. فقط ایمیل مالک را در policy مجاز کنید. مسیر webhook عمومی است اما فقط درخواست‌هایی را می‌پذیرد که هدر secret تلگرام معتبر داشته باشند. اعتبار JWT Access در Worker نیز جداگانه بررسی می‌شود.

## 4) تنظیم webhook تلگرام
پس از Deploy و ثبت Secretها، از BotFather توکن جدید بگیرید و webhook را با درخواست زیر تنظیم کنید. توکن و secret را در مرورگر عمومی یا چت قرار ندهید؛ درخواست را از محیط امن خود اجرا کنید:

```bash
curl -X POST "https://api.telegram.org/bot<NEW_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<WORKER_SUBDOMAIN>.workers.dev/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>"}'
```

## 5) ثبت شناسهٔ گفتگوها
پس از تنظیم webhook، مالک و همکار مجاز هرکدام یک بار در گفت‌وگوی خصوصی ربات `/start` را بفرستند. سرویس chat_id را فقط برای usernameهای مجاز در KV ذخیره می‌کند. بعد از آن endpoint اعلان می‌تواند به هر دو پیام بفرستد.

## 6) آزمون
- `GET /telegram/health` باید وضعیت online بدهد.
- با `/start` از حساب‌های مجاز باید پیام تأیید دریافت شود.
- فراخوانی `POST /telegram/notify` فقط با نشست معتبر Cloudflare Access و ایمیل مالک مجاز است.

## نکات امنیتی
- توکن قبلی که در گفتگو افشا شده را در BotFather باطل و تعویض کنید.
- هیچ توکن، chat_id، ایمیل خصوصی یا دادهٔ مشتری را در GitHub ثبت نکنید.
- این Worker هنوز به پنل مالک وصل نشده است؛ اتصال رابط پنل بعد از مشخص‌شدن آدرس Worker و تنظیمات Access انجام می‌شود.
- این نسخه اعلان مدیریتی و ثبت chat_id را فراهم می‌کند؛ مدیریت کامل گفت‌وگوهای مشتریان و پاسخ‌گویی از داخل پنل مرحلهٔ بعدی است.
