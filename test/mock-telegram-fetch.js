const fs = require("node:fs");
const originalFetch = global.fetch.bind(global);

global.fetch = async function (input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  if (String(url).startsWith("https://api.telegram.org/")) {
    const entry = {
      url: String(url),
      method: init.method || "GET",
      body: typeof init.body === "string" ? init.body : ""
    };
    if (process.env.TELEGRAM_MOCK_LOG) {
      fs.appendFileSync(process.env.TELEGRAM_MOCK_LOG, JSON.stringify(entry) + "\n", "utf8");
    }
    return new Response(JSON.stringify({
      ok: true,
      result: String(url).endsWith("/sendMessage")
        ? { message_id: 1 }
        : true
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return originalFetch(input, init);
};
