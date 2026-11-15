export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {
      status, headers: { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", ...extra }
    });
    const cookie = request.headers.get("Cookie") || "";
    const token = (cookie.match(/(?:^|;\s*)chaysa_admin=([^;]+)/) || [])[1];
    const secret = env.ADMIN_PASSWORD;
    async function sign(value) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
      return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
    }
    const hex = b => [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
    async function valid() {
      if (!token || !secret) return false;
      const [exp, sig] = token.split(".");
      if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
      return hex(await sign(exp)) === sig;
    }
    async function getProducts() {
      const stored = env.CHSY_PRODUCTS ? await env.CHSY_PRODUCTS.get("products", "json") : null;
      if (stored !== null) return Array.isArray(stored) ? stored : [];
      const seedResponse = await env.ASSETS.fetch(new Request(new URL("/products-seed.json", request.url)));
      if (seedResponse.ok) {
        const seed = await seedResponse.json().catch(() => []);
        return Array.isArray(seed) ? seed : [];
      }
      return [];
    }
    const ownerKey = "owner-data-v1";
    const recoveryUsedKey = "owner-recovery-used-v1";
    const passwordHashKey = "owner-password-hash-v1";
    const equalSecret = (a,b) => {
      if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
      let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return diff === 0;
    };
    async function hashPassword(password, saltHex) {
      const salt = saltHex ? Uint8Array.from(saltHex.match(/.{2}/g).map(x=>parseInt(x,16))) : crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:310000,hash:"SHA-256"},key,256);
      return {salt:[...salt].map(x=>x.toString(16).padStart(2,"0")).join(""),hash:hex(new Uint8Array(bits))};
    }
    async function passwordMatches(password) {
      const saved = await env.CHSY_PRODUCTS.get(passwordHashKey, "json");
      if (saved && saved.salt && saved.hash) {
        const candidate = await hashPassword(password, saved.salt);
        return equalSecret(candidate.hash, saved.hash);
      }
      return !!secret && equalSecret(password, secret);
    }
    const defaultOwnerData = {orders:[], invoices:[], messages:[]};
    async function getOwnerData() {
      const stored = await env.CHSY_PRODUCTS.get(ownerKey, "json");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaultOwnerData;
      return {
        orders: Array.isArray(stored.orders) ? stored.orders : [],
        invoices: Array.isArray(stored.invoices) ? stored.invoices : [],
        messages: Array.isArray(stored.messages) ? stored.messages : []
      };
    }
    if (url.pathname === "/api/products" && request.method === "GET") {
      const products = await getProducts();
      return json(products.filter(p => p && p.active !== false));
    }
    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return json({error:"درخواست نامعتبر است."},403);
      if (!env.CHSY_PRODUCTS) return json({error:"فضای ذخیره‌سازی مرکزی تنظیم نشده است."},503);
      const body = await request.json().catch(()=>({}));
      if (!await passwordMatches(body.password)) return json({error:"رمز عبور نادرست است."},401);
      const exp = String(Date.now()+8*60*60*1000), value = exp+"."+hex(await sign(exp));
      return json({ok:true},200,{"Set-Cookie":"chaysa_admin="+value+"; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800"});
    }
    if (url.pathname === "/api/admin/recover" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return json({error:"درخواست نامعتبر است."},403);
      if (!env.CHSY_PRODUCTS) return json({error:"فضای ذخیره‌سازی مرکزی تنظیم نشده است."},503);
      const recoverySecret = env.OWNER_RECOVERY_CODE;
      if (!recoverySecret) return json({error:"کد بازیابی هنوز توسط مالک تنظیم نشده است."},503);
      if (await env.CHSY_PRODUCTS.get(recoveryUsedKey)) return json({error:"کد بازیابی قبلاً استفاده شده و باطل است."},403);
      const body = await request.json().catch(()=>({}));
      if (!equalSecret(body.recoveryCode, recoverySecret)) return json({error:"کد بازیابی معتبر نیست."},403);
      if (typeof body.newPassword !== "string" || body.newPassword.length < 12 || body.newPassword.length > 128) return json({error:"رمز جدید باید بین ۱۲ تا ۱۲۸ نویسه باشد."},400);
      const hashed = await hashPassword(body.newPassword);
      await env.CHSY_PRODUCTS.put(passwordHashKey, JSON.stringify(hashed));
      await env.CHSY_PRODUCTS.put(recoveryUsedKey, "used");
      return json({ok:true});
    }
    if (url.pathname === "/api/admin/logout" && request.method === "POST") {
      return json({ok:true},200,{"Set-Cookie":"chaysa_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
    }
    if (url.pathname.startsWith("/api/admin/")) {
      if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({error:"درخواست نامعتبر است."},403);
      if (!(await valid())) return json({error:"ابتدا وارد پنل مدیریت شوید."},401);
      if (!env.CHSY_PRODUCTS) return json({error:"فضای ذخیره‌سازی مرکزی تنظیم نشده است."},503);
      if (url.pathname === "/api/admin/products" && request.method === "GET") return json(await getProducts());
      if (url.pathname === "/api/admin/products" && request.method === "PUT") {
        const raw = await request.text();
        if (raw.length > 900000) return json({error:"حجم اطلاعات بیش از حد مجاز است."},413);
        let items; try { items=JSON.parse(raw); } catch { return json({error:"ساختار اطلاعات معتبر نیست."},400); }
        if (!Array.isArray(items) || items.length > 1000) return json({error:"فهرست محصولات معتبر نیست."},400);
        await env.CHSY_PRODUCTS.put("products",JSON.stringify(items));
        return json({ok:true});
      }
      if (url.pathname === "/api/admin/owner-data" && request.method === "GET") return json(await getOwnerData());
      if (url.pathname === "/api/admin/owner-data" && request.method === "PUT") {
        const raw = await request.text();
        if (raw.length > 900000) return json({error:"حجم اطلاعات بیش از حد مجاز است."},413);
        let body; try { body=JSON.parse(raw); } catch { return json({error:"ساختار اطلاعات معتبر نیست."},400); }
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            !Array.isArray(body.orders) || !Array.isArray(body.invoices) || !Array.isArray(body.messages) ||
            body.orders.length>5000 || body.invoices.length>5000 || body.messages.length>1000) {
          return json({error:"ساختار اطلاعات پنل معتبر نیست."},400);
        }
        await env.CHSY_PRODUCTS.put(ownerKey,JSON.stringify({
          orders:body.orders, invoices:body.invoices, messages:body.messages
        }));
        return json({ok:true});
      }
      if (url.pathname === "/api/admin/upload" && request.method === "POST") {
        if (!env.CHSY_IMAGES) return json({error:"فضای ذخیره عکس‌ها تنظیم نشده است."},503);
        const form = await request.formData(), file = form.get("image");
        if (!file || !file.type.startsWith("image/") || file.size > 5*1024*1024) return json({error:"فقط عکس تا ۵ مگابایت مجاز است."},400);
        const key = crypto.randomUUID()+"-"+file.name.replace(/[^\w.-]/g,"_");
        await env.CHSY_IMAGES.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
        return json({url:"/media/"+key});
      }
    }
    if (url.pathname.startsWith("/media/") && env.CHSY_IMAGES) {
      const obj = await env.CHSY_IMAGES.get(url.pathname.slice(7));
      return obj ? new Response(obj.body,{headers:{"Content-Type":obj.httpMetadata?.contentType||"application/octet-stream","Cache-Control":"public, max-age=31536000"}}) : new Response("Not found",{status:404});
    }
    return env.ASSETS.fetch(request);
  }
};