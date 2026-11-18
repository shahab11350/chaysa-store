const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const checkout = fs.readFileSync(path.join(root, "products.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("checkout requires a messenger username between platform and chat ID", () => {
  const platform = checkout.indexOf('class="customer-messenger"');
  const username = checkout.indexOf('class="customer-messenger-username"');
  const chatId = checkout.indexOf('class="customer-id"');
  assert.ok(platform >= 0 && username > platform && chatId > username);
  const fieldStart = checkout.lastIndexOf("<input", username);
  const fieldEnd = checkout.indexOf(">", username);
  const field = checkout.slice(fieldStart, fieldEnd + 1);
  assert.match(field, /required/);
  assert.match(field, /maxlength="65"/);
  assert.match(checkout, /آیدی تلگرام \(مثال: @chaysa\)/);
  assert.match(checkout, /آیدی روبیکا \(مثال: @chaysa\)/);
});

test("username is previewed, submitted, validated, stored and included in invoice", () => {
  assert.match(checkout, /messengerUsername:checkoutValue\("\.customer-messenger-username"\)/);
  assert.match(checkout, /\["آیدی عمومی پیام‌رسان", checkoutValue\("\.customer-messenger-username"\)/);
  assert.match(server, /"messengerUsername","messengerId"/);
  assert.ok(server.includes("if(!/^@[A-Za-z0-9_]{3,64}$/.test(customerUsername))"));
  assert.match(server, /آیدی عمومی پیام‌رسان: "\+c\.messengerUsername/);
});

test("username is not used as the message delivery destination", () => {
  assert.ok(server.includes('const chatId = String(customer.messengerId || "").trim();'));
  assert.match(server, /customer\.messengerPlatform/);
});
