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
    const payload = entry.body ? JSON.parse(entry.body) : {};
    const isOrderInvoice = String(payload.text || "").startsWith("فاکتور سفارش چایسا");
    const failedOrderRecipients = String(process.env.TELEGRAM_MOCK_FAIL_ORDER_CHAT_IDS || "").split(",").map(x => x.trim());
    const failOrderDelivery = isOrderInvoice && failedOrderRecipients.includes(String(payload.chat_id));
    return new Response(JSON.stringify({
      ok: !failOrderDelivery,
      result: !failOrderDelivery && String(url).endsWith("/sendMessage")
        ? { message_id: 1 }
        : true
    }), {
      status: failOrderDelivery ? 400 : 200,
      headers: { "content-type": "application/json" }
    });
  }
  return originalFetch(input, init);
};
