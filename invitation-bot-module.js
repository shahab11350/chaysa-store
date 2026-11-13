// Chaysa invitation flow module for Cloudflare Workers
// Integration: call handleInvitationUpdate(update, env) BEFORE the existing order handler.
// Required Worker bindings:
//   TELEGRAM_BOT_TOKEN (secret)
//   INVITATION_SESSIONS (KV namespace binding)
// Do not create a second webhook for the same Telegram bot.

const SITE = "https://shahab11350.github.io/chaysa-store/invitation.html";
const STYLES = {
  luxury: { label: "لوکس و رسمی", text: "با سلیقه‌ای از جنس آرامش، به دنیای عطرها و طعم‌های منتخب چایسا دعوتی. امیدواریم این همراهی برایت دل‌نشین و به‌یادماندنی باشد." },
  friendly: { label: "صمیمی و دوستانه", text: "گفتیم یک گوشه دنج از دنیای چایسا را با تو قسمت کنیم. بیا تا از عطر چای و طعم لحظه‌های خوب، کنار هم لذت ببریم." },
  art: { label: "هنری و شاعرانه", text: "گاهی یک عطر، پنجره‌ای به خاطره‌ای دور است؛ و گاهی یک فنجان، آغاز یک روایت تازه. به روایت چایسا خوش آمدی." },
  religious: { label: "مذهبی و معنوی", text: "امیدواریم روزگارت سرشار از آرامش، تندرستی و برکت باشد. خوشحالیم که می‌توانیم گوشه‌ای از لحظه‌های خوبت را با چایسا همراه شویم." },
  mystic: { label: "عارفانه و تأمل‌برانگیز", text: "در میان شتاب روزگار، گاهی یک مکث کوتاه کافی‌ست؛ یک عطر، یک فنجان، و بازگشت به روشنایی درون. به خلوت دل‌نشین چایسا دعوتی." },
  humor: { label: "طنز و شوخ‌طبعانه", text: "ورود به چایسا ممکن است باعث لبخند، انتخاب‌های خوشمزه و دلتنگی برای یک فنجان دیگر شود! مسئولیت این اتفاقات با خودت؛ ما فقط دعوتت کردیم." }
};

async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Telegram API error: ${response.status}`);
  return response.json();
}

async function getSession(env, chatId) {
  return await env.INVITATION_SESSIONS.get(String(chatId), "json");
}
async function saveSession(env, chatId, session) {
  await env.INVITATION_SESSIONS.put(String(chatId), JSON.stringify(session), { expirationTtl: 1800 });
}
async function clearSession(env, chatId) {
  await env.INVITATION_SESSIONS.delete(String(chatId));
}
async function say(env, chatId, text, extra = {}) {
  return telegram(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

// Returns true when this update belongs to the invitation flow.
// Call before the existing order/support update handler.
export async function handleInvitationUpdate(update, env) {
  if (!env?.TELEGRAM_BOT_TOKEN || !env?.INVITATION_SESSIONS) return false;

  if (update?.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || "";
    if (!data.startsWith("chaysa_style:")) return false;
    const chatId = cb.message?.chat?.id;
    const session = await getSession(env, chatId);
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
    if (!session || session.stage !== "style") {
      await say(env, chatId, "زمان این دعوت‌نامه تمام شده است. برای شروع دوباره /invite را بفرست.");
      return true;
    }
    const style = data.slice("chaysa_style:".length);
    if (!STYLES[style]) return true;

    const params = new URLSearchParams({
      name: session.name,
      surname: session.surname || "",
      title: session.title || "",
      style,
      ref: crypto.randomUUID()
    });
    const link = `${SITE}?${params.toString()}`;
    const displayName = [session.name, session.surname].filter(Boolean).join(" ");
    const salutation = session.title ? `${displayName} ${session.title}` : displayName;
    const invitationText = `سلام ${salutation} عزیز 🌿

${STYLES[style].text}

خوشحال می‌شویم مهمان دنیای چایسا باشی:
${link}

با مهر، چایسا`;
    await clearSession(env, chatId);
    await say(env, chatId, invitationText, { disable_web_page_preview: false });
    return true;
  }

  const message = update?.message;
  if (!message?.chat?.id || typeof message.text !== "string") return false;
  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === "/invite" || text.startsWith("/invite ")) {
    await saveSession(env, chatId, { stage: "name" });
    await say(env, chatId, "برای ساخت دعوت‌نامه اختصاصی، نام شخص را بفرست:");
    return true;
  }
  if (text === "/cancel") {
    await clearSession(env, chatId);
    await say(env, chatId, "ساخت دعوت‌نامه لغو شد. برای شروع دوباره /invite را بفرست.");
    return true;
  }

  const session = await getSession(env, chatId);
  if (!session) return false;

  if (session.stage === "name") {
    if (!text || text.startsWith("/")) {
      await say(env, chatId, "لطفاً نام شخص را بنویس:");
      return true;
    }
    session.name = text.slice(0, 80);
    session.stage = "surname";
    await saveSession(env, chatId, session);
    await say(env, chatId, "نام خانوادگی را بفرست؛ اگر نمی‌خواهی وارد شود، /skip را بزن.");
    return true;
  }
  if (session.stage === "surname") {
    session.surname = text === "/skip" ? "" : text.slice(0, 80);
    session.stage = "title";
    await saveSession(env, chatId, session);
    await say(env, chatId, "خطاب دلخواه را بنویس (مثل عزیزم، جان، خواهرم)؛ اختیاری است. برای رد کردن /skip را بزن.");
    return true;
  }
  if (session.stage === "title") {
    session.title = text === "/skip" ? "" : text.slice(0, 60);
    session.stage = "style";
    await saveSession(env, chatId, session);
    const rows = [
      [{ text: "لوکس و رسمی", callback_data: "chaysa_style:luxury" }, { text: "صمیمی و دوستانه", callback_data: "chaysa_style:friendly" }],
      [{ text: "هنری و شاعرانه", callback_data: "chaysa_style:art" }, { text: "مذهبی و معنوی", callback_data: "chaysa_style:religious" }],
      [{ text: "عارفانه و تأمل‌برانگیز", callback_data: "chaysa_style:mystic" }, { text: "طنز و شوخ‌طبعانه", callback_data: "chaysa_style:humor" }]
    ];
    await say(env, chatId, "سبک دعوت‌نامه را خودت انتخاب کن:", { reply_markup: { inline_keyboard: rows } });
    return true;
  }
  if (session.stage === "style") {
    await say(env, chatId, "لطفاً یکی از شش سبک دکمه‌های بالا را انتخاب کن؛ یا برای لغو /cancel را بفرست.");
    return true;
  }
  return false;
}
