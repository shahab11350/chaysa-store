# CHAYSA Backup Manifest — 2026-11-18

## Scope and status

This is a point-in-time source snapshot, not yet a complete production-data backup. No production code, business logic, or Railway configuration was changed.

## Website source

- Repository: `shahab11350/chaysa-store`
- Production source branch: `chaysa-backup`
- Captured commit: `f0294fadd703807c0d7126f3695844b7fbdcd6b3`
- Snapshot branch: `backup/full-snapshot-2026-11-18`
- Open PR head snapshots: #1, #5, #14, #17, #19, #23, #24, #26, #30, #35, #38, #45, #46, #51
- Branch naming: `backup/2026-11-18/pr-<number>`

## Android source

- Repository: `shahab11350/chaysapp-android` (private)
- Captured branch: `main`
- Captured commit: `aa9fb4c6fb5ed45e8a345d56fdb807919afb6d23`
- Snapshot branch: `backup/full-snapshot-2026-11-18`
- Open PR head snapshots: #2, #3, #4, #5, #6
- Branch naming: `backup/2026-11-18/pr-<number>`

## Android build artifact

- GitHub Actions run: #185 / ID `44087856505`
- Artifact: `chaysapp-android-webview-arm64`
- Source branch and commit: `feat/chaysa-real-3d-companion` / `c8202f1307e3842562a4c5675eee3bc24bdc1cde`
- ZIP digest: `sha256:331de89b13008ee1650638600d30aed33b713842278a819b302683720583a76e`
- Contains `app-debug.apk`; it is a debug artifact from a feature branch, not a production release or a build of current main.
- Extracted APK SHA-256: `3db7fad9e9485046014b55f11f60e1994861d7a1eff2467685be0775aed10f65`

## Railway production inventory (read-only)

- Project: `chaysa-backup`
- Environment: `production`
- Service: `chaysa-backup-store`
- Service ID: `8f62db84-5d2e-4c6d-bcc6-6971e7eb97af`
- Latest deployment at audit: `a9bba66d-f480-4aa2-bbc6-929757f2ce71` — SUCCESS
- Service state: Online, 1/1 replicas, no recent failures, no pending work
- Persistent volume: `chaysa-backup-data`, 500 MB, mounted at `/data`
- Volume ID: `3ebfcb19-4b62-4e02-9aec-95b5a9c98d35`
- No Railway object-storage bucket was present.

## Runtime data requiring a separate backup

The current server code persists business and user data under `/data`, including:

- `products.json`
- `analytics.json`
- `orders.json`
- `telegram-recipients.json`
- `guide-approvals.json`
- `health-archive.json` and `health-archive/*`
- `health-approval-requests.json`
- `letters-archive.json`
- `questions.json`
- `media/*`

**Not yet backed up:** the actual contents of the production volume, including all files and media. This environment did not expose a safe volume-export/backup action. Do not label this snapshot a complete backup until a Railway volume backup/export has been created and its contents verified.

## Secrets and recovery configuration

Railway variable names were inventoried. Secret values were intentionally not copied into Git, this manifest, or the APK package. A separate secure recovery procedure is required for secrets and bot credentials; do not place them in ordinary ZIP archives.

## Verification

- Both source snapshot branches were created from the exact captured commit SHAs.
- Open PR head snapshots were created for the listed website and Android PRs.
- Android Actions artifact ZIP was downloaded; ZIP integrity and APK SHA-256 were checked in the working container.
- Production Railway service status was checked read-only after the branch snapshots.


## External Cloudflare dependency not yet captured

- Android `main.dart` references the live Worker `black-mud-3a10` at `https://black-mud-3a10.faryadereza.workers.dev/` as its question API.
- This is distinct from the repository's `worker.js` / `wrangler.toml` for the separate `chaysa-backup` Worker. The repository setup document says that separate Worker has not been deployed and its KV namespace ID is still a placeholder.
- Prior Cloudflare inspection records indicate the actual `black-mud-3a10` Worker was Ready and had a Telegram secret, but its source was not available through the GitHub repository. Its current dashboard state was not rechecked in this backup session.
- Its deployed source, settings and secure secret-recovery record are not included. Do not treat the Android backend as backed up until its current Worker code/configuration is exported from Cloudflare and safely preserved.


## Railway volume backup — next required action

Railway documents manual and scheduled backups in the service's **Backups** tab. The owner must open project `chaysa-backup` → service `chaysa-backup-store` → **Backups** → **Create a backup**. No new volume backup was created or restored during this session, and existing backup inventory was not verified through the connected tools.

Railway's documented manual-backup limit is 50% of volume capacity. The current volume is 500 MB, so the theoretical manual-backup ceiling is 250 MB. Actual used space was not measured in this session. Backups are incremental / Copy-on-Write and incur incremental storage charges. See https://docs.railway.com/volumes/backups.
