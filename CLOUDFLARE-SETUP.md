# راه‌اندازی پنل مدیریت چایسا روی Cloudflare

این شاخه آزمایشی است و هنوز سایت اصلی را تغییر نمی‌دهد. فایل‌های اصلی فروشگاه تا زمان آزمایش نهایی دست‌نخورده می‌مانند.

## فایل‌ها
- `admin.html`: پنل فارسی مدیریت محصولات
- `worker.js`: API، ورود مدیر و ذخیره محصولات و تصاویر
- `products.html`: خواندن فهرست زنده محصولات از API و حفظ فهرست ثابت به‌عنوان جایگزین
- `products-seed.json`: فهرست اولیه استخراج‌شده از صفحه فعلی فروشگاه (۴۷ محصول شناسایی‌شده؛ پیش از انتشار نهایی با فهرست کامل تطبیق شود)
- `wrangler.toml`: پیکربندی Worker و اتصال‌ها

## موارد لازم در Cloudflare
1. انجام شده: KV Namespace با نام `CHSY_PRODUCTS` و شناسه `fbd00c90aba34b7184c264b448426089` ساخته و به Worker آزمایشی متصل شده است. همین شناسه در `wrangler.toml` شاخه توسعه ثبت شده است.
2. فعلاً ساخت R2 به درخواست مالک به مرحلهٔ بعد موکول شده است. تا آن زمان پنل محصولات بدون بارگذاری عکس قابل استفاده خواهد بود و binding مربوط به R2 در `wrangler.toml` وجود ندارد.
3. انجام شده: secret با نام `ADMIN_PASSWORD` در محیط Production Worker ثبت شده است. مقدار آن هرگز نباید در فایل‌های GitHub یا گفتگو ذخیره شود.
4. هنوز انجام نشده: پس از تکمیل کنترل‌های امنیتی، پروژه را از شاخه `admin-panel-development` به‌صورت Cloudflare Worker با Static Assets و فایل پیکربندی همین شاخه مستقر کنید. نام Worker هدف `soft-rain-89bbchaysa-api` است. اتصال R2 می‌تواند در مرحلهٔ بعد اضافه شود.
5. پس از استقرار، ابتدا `/admin.html` را باز کنید و ورود مدیر را آزمایش کنید؛ سپس `/api/products` را بررسی کنید.
6. پس از تأیید پنل و فهرست محصولات، دامنه/مسیر فروشگاه به نسخه Worker منتقل شود. تا قبل از این مرحله، GitHub Pages نسخه قبلی را نمایش می‌دهد.

## نکات امنیتی و عملیاتی
- رمز مدیر فقط باید به‌صورت Secret در Cloudflare ذخیره شود.
- URL پنل به‌تنهایی محرمانه نیست؛ امنیت واقعی با کنترل سمت Worker انجام می‌شود.
- برای ورود و بازیابی رمز، binding بومی Rate Limiting با سقف ۵ تلاش در ۶۰ ثانیه برای هر IP و هر مسیر تعریف شده است. این محدودسازی تقریبی و محلی به هر نقطه Cloudflare است، نه سقف سخت جهانی؛ پیش از انتشار باید پس از deploy عملاً آزمایش شود. بازبینی CSRF و آزمون کامل نشست ورود نیز لازم است.
- فایل seed فعلی ۴۷ محصول از HTML موجود استخراج کرده است؛ شمارش دسته‌ها با عنوان‌های نمایشی صفحه فعلی کاملاً یکسان نیست و باید پیش از انتقال نهایی بازبینی شود.
- این شاخه هنوز روی سایت زنده منتشر نشده است.


## Owner password recovery

The owner panel includes a one-time recovery-code flow. Before it can be used, configure the Worker secret `OWNER_RECOVERY_CODE` with a long, random value (at least 32 characters) using the hosting provider's secret/variable settings. Never commit this value to Git or paste it into source files. The first successful recovery stores a PBKDF2-SHA-256 password hash (310,000 iterations, random salt) in the existing `CHSY_PRODUCTS` KV namespace and marks the recovery code as used. Subsequent logins use the stored password hash; the original `ADMIN_PASSWORD` remains the HMAC session-signing secret. The recovery code is intentionally one-time; to issue another recovery code, an operator must securely clear KV key `owner-recovery-used-v1` and rotate the `OWNER_RECOVERY_CODE` secret. Do not clear the used marker as a routine action.

The recovery feature is not operational until `CHSY_PRODUCTS`, `ADMIN_PASSWORD`, and `OWNER_RECOVERY_CODE` are configured and the updated Worker is deployed.


## وضعیت راه‌اندازی در 2026-11-15
- KV و secret مربوط به رمز مدیر در Cloudflare تنظیم شده‌اند.
- سه regex در `worker.js` برای خواندن کوکی نشست، اعتبارسنجی زمان انقضا و پاک‌سازی نام فایل اصلاح شده‌اند.
- هنوز هیچ deployment یا runtime test انجام نشده است.
- R2 و بارگذاری عکس‌ها عمداً به مرحلهٔ بعد موکول شده‌اند.
- تصمیم درباره secret بازیابی، rate limiting و بازبینی نهایی امنیتی باقی مانده‌اند.


## Login and recovery rate limiting
- The development Worker config declares the native Cloudflare Rate Limiting binding `CHAYSA_LOGIN_LIMITER` (namespace ID `1150115`), with 5 requests per 60 seconds per key.
- Login and recovery use separate IP-based keys. The Worker fails closed with HTTP 503 if the binding is missing and returns HTTP 429 with Retry-After when the configured threshold is exceeded.
- Cloudflare documents these limits as approximate and local to each Cloudflare location; they are a useful low-friction abuse barrier, not a strict global lockout. Validate behavior after deployment. See https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/.


## Cloudflare dashboard status — 2026-11-15 (verified by owner)
- Production Worker `soft-rain-89bbchaysa-api` now has `ADMIN_PASSWORD`, KV binding `CHSY_PRODUCTS`, and Rate Limiter binding `CHAYSA_LOGIN_LIMITER` configured.
- Active dashboard deployment `c028244f` is Ready and serves 100% of traffic, but the Worker URL still responds with `Hello world`. This is only the baseline script with the bindings attached; it is NOT the CHAYSA application Worker.
- Do not treat the rate limiter as protecting the CHAYSA login endpoint until the branch's application Worker code is deployed and its behavior is tested.
- No R2 bucket or `CHSY_IMAGES` binding has been created; image upload remains intentionally deferred. `OWNER_RECOVERY_CODE` is also not configured, so password recovery is not operational.
- Next step is code review and a safe deployment path for the development branch. Production application deployment and any change to `main` or the public GitHub Pages site still require explicit owner approval.


## Static asset publishing safeguard
- The assets directory is currently the repository root (`.`). The development branch now contains a root `.assetsignore` that excludes `worker.js`, `wrangler.toml`, Markdown documentation, and `.github/` from public static asset uploads.
- `products-seed.json` remains included because the Worker uses the ASSETS binding to load the initial product catalogue.
- This safeguard must be included in the eventual deployment and verified by requesting `/worker.js` and internal documentation paths; those paths should not expose source or internal notes.
