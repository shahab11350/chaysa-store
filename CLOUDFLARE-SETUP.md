# راه‌اندازی پنل مدیریت چایسا روی Cloudflare

این شاخه آزمایشی است و هنوز سایت اصلی را تغییر نمی‌دهد. فایل‌های اصلی فروشگاه تا زمان آزمایش نهایی دست‌نخورده می‌مانند.

## فایل‌ها
- `admin.html`: پنل فارسی مدیریت محصولات
- `worker.js`: API، ورود مدیر و ذخیره محصولات و تصاویر
- `products.html`: خواندن فهرست زنده محصولات از API و حفظ فهرست ثابت به‌عنوان جایگزین
- `products-seed.json`: فهرست اولیه استخراج‌شده از صفحه فعلی فروشگاه (۴۷ محصول شناسایی‌شده؛ پیش از انتشار نهایی با فهرست کامل تطبیق شود)
- `wrangler.toml`: پیکربندی Worker و اتصال‌ها

## موارد لازم در Cloudflare
1. یک KV Namespace بسازید و شناسه آن را در `wrangler.toml` به‌جای `REPLACE_WITH_KV_NAMESPACE_ID` قرار دهید. نام binding باید دقیقاً `CHSY_PRODUCTS` باشد.
2. یک R2 bucket با نام `chaysa-product-images` بسازید و binding با نام `CHSY_IMAGES` به آن متصل کنید.
3. در تنظیمات Worker یک secret با نام `ADMIN_PASSWORD` تعریف کنید. رمز را در فایل‌های GitHub قرار ندهید.
4. پروژه را از شاخه `admin-panel-development` به‌صورت Cloudflare Worker با Static Assets و فایل پیکربندی همین شاخه مستقر کنید.
5. پس از استقرار، ابتدا `/admin.html` را باز کنید و ورود مدیر را آزمایش کنید؛ سپس `/api/products` را بررسی کنید.
6. پس از تأیید پنل و فهرست محصولات، دامنه/مسیر فروشگاه به نسخه Worker منتقل شود. تا قبل از این مرحله، GitHub Pages نسخه قبلی را نمایش می‌دهد.

## نکات امنیتی و عملیاتی
- رمز مدیر فقط باید به‌صورت Secret در Cloudflare ذخیره شود.
- URL پنل به‌تنهایی محرمانه نیست؛ امنیت واقعی با کنترل سمت Worker انجام می‌شود.
- پیش از انتشار عمومی، محدودسازی تلاش‌های ورود (rate limiting)، بررسی CSRF و آزمون کامل نشست ورود لازم است.
- فایل seed فعلی ۴۷ محصول از HTML موجود استخراج کرده است؛ شمارش دسته‌ها با عنوان‌های نمایشی صفحه فعلی کاملاً یکسان نیست و باید پیش از انتقال نهایی بازبینی شود.
- این شاخه هنوز روی سایت زنده منتشر نشده است.


## Owner password recovery

The owner panel includes a one-time recovery-code flow. Before it can be used, configure the Worker secret `OWNER_RECOVERY_CODE` with a long, random value (at least 32 characters) using the hosting provider's secret/variable settings. Never commit this value to Git or paste it into source files. The first successful recovery stores a PBKDF2-SHA-256 password hash (310,000 iterations, random salt) in the existing `CHSY_PRODUCTS` KV namespace and marks the recovery code as used. Subsequent logins use the stored password hash; the original `ADMIN_PASSWORD` remains the HMAC session-signing secret. The recovery code is intentionally one-time; to issue another recovery code, an operator must securely clear KV key `owner-recovery-used-v1` and rotate the `OWNER_RECOVERY_CODE` secret. Do not clear the used marker as a routine action.

The recovery feature is not operational until `CHSY_PRODUCTS`, `ADMIN_PASSWORD`, and `OWNER_RECOVERY_CODE` are configured and the updated Worker is deployed.
