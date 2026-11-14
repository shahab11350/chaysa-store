# CHAYSA — Development checkpoint
Last updated: 2026-11-14

## Current branch and deployment status
- Repository: shahab11350/chaysa-store
- Working branch: admin-panel-development
- Production branch: main (not changed)
- Production site: https://shahab11350.github.io/chaysa-store/
- No Cloudflare deployment has been completed.
- No merge or pull request to main has been made.
- Keep all further development on admin-panel-development until the owner approves release.

## Work already committed on the development branch
- admin.html: Persian mobile-friendly admin UI; product editing, active/inactive toggles, and save flow.
- worker.js: API for public product listing, admin login/session, KV product storage, and R2 image handling.
- wrangler.toml: Worker configuration scaffold; KV namespace ID is still a placeholder.
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