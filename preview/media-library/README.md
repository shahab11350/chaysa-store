# CHAYSA Media Preview

Standalone, isolated preview of the CHAYSA media-library upload flow.

## Render configuration
- Service type: Web Service
- Source: public repository `shahab11350/chaysa-store`
- Branch: `experiment/media-library-2026-11-17`
- Root Directory: `preview/media-library`
- Build Command: `npm install`
- Start Command: `npm start`
- Instance plan: Free
- Health Check Path: `/api/health`

## Required environment variables
- `ADMIN_PASSWORD`: unique preview-only password, at least 16 characters.
- `SESSION_SECRET`: random preview-only secret (at least 32 random bytes encoded as hex).

Do not add production tokens, production passwords, or production data.

The free instance uses ephemeral storage. Uploaded media and its index are temporary and can be lost on sleep, restart, or redeploy. This service is for testing only, not production.
