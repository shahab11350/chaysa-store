# CHAYSA — Development checkpoint
Last updated: 2026-11-14

## Current branch and deployment status
- Repository: shahab11350/chaysa-store
- Working branch: admin-panel-development
- Production branch: main (not changed)
- Production site: https://shahab11350.github.io/chaysa-store/
- No Cloudflare deployment has been completed. The existing test Worker is named `soft-rain-89bbchaysa-api` and its URL is `https://soft-rain-89bbchaysa-api.faryadereza.workers.dev/`.
- No merge or pull request to main has been made.
- Keep all further development on admin-panel-development until the owner approves release.

## Work already committed on the development branch
- admin.html: Persian mobile-friendly admin UI; product editing, active/inactive toggles, and save flow.
- worker.js: API for public product listing, admin login/session, KV product storage, and R2 image handling.
- wrangler.toml: Worker configuration targets the existing test Worker `soft-rain-89bbchaysa-api`; KV namespace binding `CHSY_PRODUCTS` is configured with ID `fbd00c90aba34b7184c264b448426089`.
- products-seed.json: 47 products extracted from the existing store HTML.
- products.html: attempts to fetch /api/products and dynamically render live products; falls back to existing static content if API is unavailable.
- CLOUDFLARE-SETUP.md: setup instructions for KV, R2, ADMIN_PASSWORD secret, and deployment.
- Recent relevant commits:
  - 5d6465dd7e02a65bb31c3f2fd97536d30189baf9 (KV empty-array behavior)
  - f71c6fa9a3dfea900aa744aaa008ef200fb80a5a (products page API integration)
  - 810e8bef8e4a148957579c93b7e77dbd76ae971a (47-product seed)
  - ee36f1e5441ad97e4a6bf1758bd28ac6b03f7c09 (active/inactive controls)
  - 8497350732b87c81e74e5134bf295a4ef487e766 (Cloudflare setup guide)

## Outstanding work — do not mark complete until verified
1. Fetch and audit the current versions of worker.js, admin.html, wrangler.toml, products.html, and products-seed.json on this branch.
2. Reconcile the product count discrepancy: the original HTML heading indicates 25 tea products, but extraction found 24 tea entries; current seed totals 47 (24 tea, 14 herbal tea, 9 spices). Verify whether one product is missing before release.
3. Verify endpoint paths, login/session cookie behavior, saveAll(), image upload, active flag handling, and Worker static asset fallback are mutually compatible.
4. Review security before production: login rate limiting, CSRF protections, secure cookie settings, and session expiration. Do not claim production-grade security without tests.
5. Create a real KV namespace and replace the placeholder namespace ID in wrangler.toml.
6. Create the R2 bucket named chaysa-product-images and bind it as CHSY_IMAGES.
7. Set ADMIN_PASSWORD as a Cloudflare secret. Never commit this secret to GitHub or ask the owner to paste it into chat.
8. Deploy the development branch as a Cloudflare Worker with static assets, then test admin login, product CRUD, image upload, and public product rendering.
9. Only after successful tests and explicit owner approval, plan the production cutover. Do not merge to main or change the public site without approval.

## Important architecture facts
- Current live GitHub Pages site cannot use same-origin /api/products from the Cloudflare Worker; it falls back to static HTML.
- Live KV changes will not appear on the current public site until the storefront is served through the Worker (or configured to call the API origin correctly).
- The current Cloudflare Worker previously inspected was static-assets-only and had no runtime bindings configured.
- The admin page URL may be reachable as a static asset, but all admin API operations must require server-side authentication. Hiding a button is not security.
- The owner prefers that the assistant perform all GitHub-side coding directly and ask for only the minimum necessary owner actions in Cloudflare. The owner primarily uses an Android phone; instructions should be one step at a time.

## Resume instruction
When continuing, first inspect the actual current files on admin-panel-development and verify this checkpoint against GitHub. Do not repeat completed work blindly. Report only changes actually committed or tested.

## Owner panel upgrade — 2026-11-15
- Upgraded `owner.html` from a mostly-static module launcher into an authenticated owner workspace with dashboard, order records, invoices, message templates, and customer summaries.
- Added authenticated `/api/admin/owner-data` GET/PUT endpoints in `worker.js`; data is stored centrally under `owner-data-v1` in the existing `CHSY_PRODUCTS` KV namespace.
- Public `/api/products` now excludes products explicitly marked inactive.
- Owner panel links to the existing product-management page at `/admin.html`.
- Commits on `admin-panel-development`:
  - `cfdcafc79296e81ccecc4784ed1436dc45ed9577` — owner workspace UI
  - `5aac9fceceec7b17e4bfb46895f377940158e323` — owner data API and public active-product filtering
- Not deployed and not yet runtime-tested. The KV namespace ID is still a placeholder and the R2/secret setup is still outstanding.
- Important functional boundaries: orders entered in the owner panel are manual records; automatic checkout-to-order integration is not implemented. The current owner login still shares the existing ADMIN_PASSWORD; separate staff credentials/roles (including the Bostani reply-only panel) are not implemented. Do not represent these as complete.
- Before deployment, test JavaScript/runtime behavior, API validation, login/session/logout, data persistence, active-product filtering, and existing product CRUD/upload. Review rate limiting and CSRF/origin enforcement further; this is not yet production-certified.


## 2026-11-15 — Owner password recovery

- Added a “فراموشی رمز عبور” action to `owner.html`.
- Added `POST /api/admin/recover` to `worker.js`; it validates a one-time `OWNER_RECOVERY_CODE`, enforces a 12–128 character new password, stores a salted PBKDF2-SHA-256 hash in KV, and permanently marks the recovery code as used.
- Login now checks the stored password hash after recovery, falling back to `ADMIN_PASSWORD` before the first recovery.
- Same-origin checks are now strict for state-changing admin/login/recovery requests.
- Commits: owner UI `39d7129c0857a8ed1f7bfd6fd01bd6370501eaaa`; Worker `9ef4aadc8e71e7e31503dbcc3785d4b168419e41`.
- Not deployed or runtime-tested. Recovery remains unavailable until the Worker has a configured KV binding, `ADMIN_PASSWORD`, and `OWNER_RECOVERY_CODE` secret.


## Cloudflare setup progress — 2026-11-15
- Created KV namespace `CHSY_PRODUCTS` (ID `fbd00c90aba34b7184c264b448426089`) and connected it to the existing test Worker as the `CHSY_PRODUCTS` binding.
- Configured `ADMIN_PASSWORD` as a Cloudflare Secret; its value is intentionally not recorded here or in Git.
- Updated `wrangler.toml` on `admin-panel-development` to use the existing Worker name `soft-rain-89bbchaysa-api`, preventing an accidental deploy to a differently named Worker.
- Still outstanding: create R2 bucket `chaysa-product-images` and bind it as `CHSY_IMAGES`; configure `OWNER_RECOVERY_CODE` if recovery is to be enabled; review rate limiting and security; deploy and runtime-test only after configuration review. No deployment has occurred.


## Static audit follow-up — 2026-11-15
- Compared the current `products.html` catalogue rows against `products-seed.json`: both contain the same 47 unique SKUs; no row in the HTML catalogue is missing from the seed, and no seed row is absent from the HTML catalogue.
- Category counts in the current catalogue are 24 tea, 14 herbal tea, and 9 spices. The visible tea category heading says 25, so the mismatch is in the displayed count versus the 24 actual tea rows; the identity of any intended 25th tea must be confirmed from the source product list before release.
- Fixed `products.html` so a successful API response containing an empty product array is respected instead of silently falling back to the old embedded catalogue. Commit: `7de731a15fa1c0ac6f9a48d071f1b9a84b2465af`.
- Remaining blockers before deployment: R2 bucket/binding, optional recovery secret if recovery is required, rate limiting/security review, and runtime tests. No Worker deployment has been performed.


## Worker static audit — 2026-11-15
- Audited the current Worker source and found three incorrectly double-escaped regular expressions: cookie parsing whitespace, numeric session-expiry validation, and upload filename sanitization.
- Corrected those patterns on `admin-panel-development` so session cookies can be parsed, expiry timestamps can be validated, and uploaded filenames are sanitized as intended.
- Commit: `b6bdc27feefda0bb8d53d279f72f607f42a92994`.
- Verified the corrected source text on GitHub. This is a static source verification only; no Worker deployment or runtime test has been performed.
- Remaining before deployment: configure the R2 bucket/binding `CHSY_IMAGES`, decide whether to enable password recovery by setting `OWNER_RECOVERY_CODE`, add reliable login rate limiting, complete endpoint/session/security review, then deploy and runtime-test the development Worker. Do not deploy or change `main`/the public GitHub Pages site without explicit owner approval.


## Owner/admin functional and security fixes — 2026-11-15
- Fixed product creation so a new product never inherits the first product's image or inactive state when the edit index is blank.
- Changed both admin and owner login flows to reveal the management interface only after the initial authenticated data load succeeds; this avoids leaving the login form hidden after a post-login API/storage error.
- Hardened Worker session token parsing: exactly two token parts, 13-digit expiry, 64-hex signature, and constant-time signature comparison.
- Added small request-body limits and strict password type checking for login/recovery; logout now requires POST and same-origin Origin.
- Restricted image uploads to JPEG/PNG/WebP/GIF/AVIF, validates basic file signatures, and generates server-side random keys with fixed extensions (SVG is rejected).
- These are source-level changes only. They have not been deployed or runtime-tested. Login rate limiting still needs a reliable Cloudflare-side control; do not treat the panel as production-ready until runtime/security tests pass.


## Image storage deferred by owner — 2026-11-15
- Owner explicitly deferred creation of the R2 bucket and image-storage binding until a later phase.
- Removed the not-yet-created R2 bucket binding from `wrangler.toml` so the current development Worker can be configured without R2.
- Disabled the product image file picker in `admin.html` for now; product creation without a new image remains available, and an existing image is preserved when editing without selecting a replacement.
- Worker image-upload code remains ready for a later R2 binding; until then the endpoint returns a clear storage-not-configured response.
- This is a development-branch configuration change only; no deployment has occurred.


## Owner/admin hardening follow-up — 2026-11-15
- Product manager: failed saves now restore the previous in-memory product list instead of leaving the UI showing unsaved edits; add/edit/delete/active-toggle use this rollback path.
- Rollback snapshots clone product records, so a failed active/inactive toggle also restores the previous state rather than retaining a mutated object.
- Product form: Persian and Arabic-Indic digits are normalized for prices; unsafe/invalid prices, duplicate SKUs, missing edit targets, non-image files, and files over 5 MB are rejected before saving.
- Worker: unknown `/api/admin/*` paths now return JSON 404 rather than falling through to static assets.
- Worker API and static-asset responses now include baseline anti-sniffing, referrer, framing, and permissions headers; R2 media keys are constrained to generated UUID filenames and media responses include `nosniff`.
- These are source-level changes only. They have not been deployed or runtime-tested. Reliable login rate limiting and full end-to-end runtime testing remain release gates.
