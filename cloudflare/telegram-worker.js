/**
 * CHAYSA Telegram bridge for Cloudflare Workers.
 *
 * Required Worker bindings:
 *   Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
 *            ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL,
 *            ADMIN_TELEGRAM_USERNAMES
 *   KV: CHAYSA_TELEGRAM_KV
 *
 * ADMIN_TELEGRAM_USERNAMES: comma-separated usernames without @.
 * Never commit secret values to Git.
 */
let jwksCache = null;
let jwksFetchedAt = 0;

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
};

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders,
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_PANEL_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function getJwks(env) {
  const now = Date.now();
  if (jwksCache && now - jwksFetchedAt < 3600000) return jwksCache;
  const domain = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  const response = await fetch(domain + "/cdn-cgi/access/certs");
  if (!response.ok) throw new Error("Unable to retrieve Access signing keys");
  jwksCache = await response.json();
  jwksFetchedAt = now;
  return jwksCache;
}

async function verifyAccess(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { return false; }
  if (header.alg !== "RS256" || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return false;
  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  if (claims.iss !== issuer) return false;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUD)) return false;
  if (claims.email && claims.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) return false;
  if (!claims.email) return false;

  const jwks = await getJwks(env);
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", jwk, {
    name: "RSASSA-PKCS1-v1_5", hash: "SHA-256",
  }, false, ["verify"]);
  const data = new TextEncoder().encode(parts[0] + "." + parts[1]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), data);
}

async function telegram(env, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error("Telegram API request failed");
  return result;
}

async function handleWebhook(request, env) {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  const update = await request.json();
  const message = update.message;
  if (!message?.chat?.id) return json({ ok: true });
  const username = (message.from?.username || "").replace(/^@/, "").toLowerCase();
  const allowed = (env.ADMIN_TELEGRAM_USERNAMES || "").split(",").map(x => x.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);

  if (message.text?.trim() === "/start" || message.text?.trim() === "/id") {
    if (allowed.includes(username)) {
      await env.CHAYSA_TELEGRAM_KV.put("admin:" + username, String(message.chat.id));
      await telegram(env, "sendMessage", {
        chat_id: message.chat.id,
        text: "اتصال شما به اعلان‌های مدیریتی چایسا برقرار شد. 🌿",
      });
    } else {
      await telegram(env, "sendMessage", {
        chat_id: message.chat.id,
        text: "این ربات برای دریافت اعلان‌های مدیریتی چایسا فعال است.",
      });
    }
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const origin = allowedOrigin(request, env);
      return new Response(null, { status: origin ? 204 : 403, headers: { ...corsHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
    }

    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      try { return await handleWebhook(request, env); }
      catch { return json({ ok: false }, 500); }
    }

    if (url.pathname === "/telegram/health" && request.method === "GET") {
      const origin = allowedOrigin(request, env);
      if (request.headers.get("Origin") && !origin) return json({ error: "Origin not allowed" }, 403);
      return json({ service: "CHAYSA Telegram bridge", status: "online" }, 200, origin);
    }

    if (url.pathname === "/telegram/notify" && request.method === "POST") {
      const origin = allowedOrigin(request, env);
      if (request.headers.get("Origin") && !origin) return json({ error: "Origin not allowed" }, 403);
      let authorized = false;
      try { authorized = await verifyAccess(request, env); } catch { authorized = false; }
      if (!authorized) return json({ error: "Unauthorized" }, 401, origin);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 3500) return json({ error: "Message must be 1–3500 characters" }, 400, origin);
      const usernames = (env.ADMIN_TELEGRAM_USERNAMES || "").split(",").map(x => x.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
      let sent = 0;
      for (const username of usernames) {
        const chatId = await env.CHAYSA_TELEGRAM_KV.get("admin:" + username);
        if (!chatId) continue;
        await telegram(env, "sendMessage", { chat_id: chatId, text });
        sent++;
      }
      return json({ ok: true, deliveredTo: sent }, 200, origin);
    }

    return new Response("Not found", { status: 404 });
  },
};
