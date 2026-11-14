export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": url.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
    const cookie = request.headers.get("Cookie") || "";
    const token = (cookie.match(/chaysa_admin=([^;]+)/) || [])[1];
    const secret = env.ADMIN_PASSWORD;
    async function sign(value) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign","verify"]);
      return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
    }
    const hex = b => [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
    async function valid() {
      if (!token || !secret) return false;
      const [exp, sig] = token.split(".");
      if (!exp || Number(exp) < Date.now() || !sig) return false;
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
    if (url.pathname === "/api/products" && request.method === "GET") {
      return json(await getProducts());
    }
    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      const body = await request.json().catch(()=>({}));
      if (!secret || body.password !== secret) return json({error:"رمز عبور نادرست است."}, 401);
      const exp = String(Date.now()+8*60*60*1000), value = exp+"."+hex(await sign(exp));
      return new Response(JSON.stringify({ok:true}), {headers:{...cors,"Content-Type":"application/json","Set-Cookie":"chaysa_admin="+value+"; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800"}});
    }
    if (url.pathname === "/api/admin/logout") return new Response(JSON.stringify({ok:true}), {headers:{...cors,"Content-Type":"application/json","Set-Cookie":"chaysa_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"}});
    if (url.pathname.startsWith("/api/admin/")) {
      if (!(await valid())) return json({error:"ابتدا وارد پنل مدیریت شوید."},401);
      if (!env.CHSY_PRODUCTS) return json({error:"اتصال فضای ذخیره‌سازی محصولات تنظیم نشده است."},503);
      if (url.pathname === "/api/admin/products" && request.method === "GET") return json(await getProducts());
      if (url.pathname === "/api/admin/products" && request.method === "PUT") {
        const items = await request.json();
        if (!Array.isArray(items)) return json({error:"ساختار اطلاعات معتبر نیست."},400);
        await env.CHSY_PRODUCTS.put("products", JSON.stringify(items));
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
      return obj ? new Response(obj.body,{headers:{"Content-Type":obj.httpMetadata?.contentType || "application/octet-stream","Cache-Control":"public, max-age=31536000"}}) : new Response("Not found",{status:404});
    }
    return env.ASSETS.fetch(request);
  }
};