"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const STYLES={
 luxury:{label:"لوکس و رسمی",text:"با سلیقه‌ای از جنس آرامش، به دنیای عطرها و طعم‌های منتخب چایسا دعوتی. امیدواریم این همراهی برایت دل‌نشین و به‌یادماندنی باشد."},
 friendly:{label:"صمیمی و دوستانه",text:"گفتیم یک گوشه دنج از دنیای چایسا را با تو قسمت کنیم. بیا تا از عطر چای و طعم لحظه‌های خوب، کنار هم لذت ببریم."},
 art:{label:"هنری و شاعرانه",text:"گاهی یک عطر، پنجره‌ای به خاطره‌ای دور است؛ و گاهی یک فنجان، آغاز یک روایت تازه. به روایت چایسا خوش آمدی."},
 romantic:{label:"لطیف و احساسی",text:"بعضی دعوت‌ها فقط برای آمدن نیستند؛ برای شریک‌شدن در لحظه‌های قشنگ‌اند. دلم می‌خواهد عطر چای و آرامش این لحظه را با تو قسمت کنم."},
 religious:{label:"مذهبی و معنوی",text:"امیدواریم روزگارت سرشار از آرامش، تندرستی و برکت باشد. خوشحالیم که می‌توانیم گوشه‌ای از لحظه‌های خوبت را با چایسا همراه شویم."},
 mystic:{label:"عارفانه و تأمل‌برانگیز",text:"در میان شتاب روزگار، گاهی یک مکث کوتاه کافی‌ست؛ یک عطر، یک فنجان، و بازگشت به روشنایی درون. به خلوت دل‌نشین چایسا دعوتی."},
 humor:{label:"طنز و شوخ‌طبعانه",text:"ورود به چایسا ممکن است باعث لبخند، انتخاب‌های خوشمزه و دلتنگی برای یک فنجان دیگر شود! مسئولیت این اتفاقات با خودت؛ ما فقط دعوتت کردیم."}
};
const TTL=1800000;
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function clean(v,n){return String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,n);}
function buildInvitationUrl(base,s,style,ref=crypto.randomUUID()){
 const u=new URL(base);if(u.protocol!=="https:")throw Error("HTTPS required");
 u.search=new URLSearchParams({name:s.name,surname:s.surname||"",title:s.title||"",style,ref}).toString();return u.toString();
}
function buildInvitationHtml(s,style,logo){
 const st=STYLES[style];if(!st)throw Error("Unknown style");
 const guest=[s.name,s.surname].filter(Boolean).join(" ")+(s.title?" "+s.title:" عزیز");
 return [
 '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>',
 '@page{size:1000px 900px;margin:0}*{box-sizing:border-box}',
 'body{margin:0;width:1000px;height:900px;display:grid;place-items:center;background:radial-gradient(circle at 15% 10%,#e7e2cf,transparent 35%),linear-gradient(145deg,#f5f1e7,#e8eee5);font-family:Tahoma,Arial,sans-serif;color:#26372b}',
 '.card{width:820px;min-height:700px;background:#fffdf7;border:1px solid #c5a45b;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px #173b2b1c;text-align:center}',
 '.top{height:14px;background:linear-gradient(90deg,#173b2b,#c5a45b,#173b2b)}.inner{padding:48px 72px}',
 '.logo{display:block;width:230px;height:121px;object-fit:contain;margin:0 auto 12px}.kicker{margin:12px 0 18px;color:#68756b;font-size:20px}',
 'h1{margin:0;color:#173b2b;font-size:38px;line-height:1.8}.name{margin:14px 0 24px;font-size:32px;color:#b99b55;font-weight:bold;line-height:1.8}',
 '.rule{width:90px;height:2px;background:#b99b55;margin:24px auto}.message{font-size:23px;line-height:2.25;white-space:pre-line;margin:20px auto;max-width:660px}',
 '.signature{margin-top:30px;color:#173b2b;font-size:22px;font-weight:bold}.footer{padding:18px;background:#f5f1e7;color:#68756b;font-size:16px}</style><body>',
 '<main class="card"><div class="top"></div><div class="inner"><img class="logo" src="'+logo+'" alt="لوگوی چایسا">',
 '<div class="kicker">'+escapeHtml(st.label)+'</div><h1>به دنیای چایسا خوش آمدی</h1><div class="name">'+escapeHtml(guest)+'</div>',
 '<div class="rule"></div><div class="message">'+escapeHtml(st.text)+'</div><div class="signature">با مهر، چایسا</div></div>',
 '<div class="footer">این دعوت‌نامه با مهر و به‌صورت اختصاصی برای شما آماده شده است.</div></main></body></html>'
 ].join("");
}
function createInvitationBot({dataDir,rootDir,fetchImpl=fetch,env=process.env,now=()=>Date.now()}){
 const file=path.join(dataDir,"telegram-invitation-sessions.json");
 function read(){try{const x=JSON.parse(fs.readFileSync(file,"utf8"));return x&&typeof x==="object"&&!Array.isArray(x)?x:{};}catch(_){return {};}}
 function write(x){fs.mkdirSync(path.dirname(file),{recursive:true});const t=file+".tmp";fs.writeFileSync(t,JSON.stringify(x),{encoding:"utf8",mode:0o600});fs.renameSync(t,file);}
 function get(id){const x=read(),s=x[String(id)];if(!s||now()-s.updatedAt>TTL){if(s){delete x[String(id)];write(x);}return null;}return s;}
 function save(id,s){const x=read();x[String(id)]={...s,updatedAt:now()};write(x);}
 function clear(id){const x=read();delete x[String(id)];write(x);}
 async function api(method,body,form=false){if(!env.TELEGRAM_BOT_TOKEN)throw Error("Telegram is not configured");const r=await fetchImpl("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{method:"POST",...(form?{body}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});const j=await r.json();if(!r.ok||j.ok!==true)throw Error("Telegram API failed");return j;}
 async function render(html){if(!env.CLOUDFLARE_ACCOUNT_ID||!env.CLOUDFLARE_API_TOKEN)throw Error("Renderer is not configured");const u="https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+"/browser-rendering/screenshot";const r=await fetchImpl(u,{method:"POST",headers:{Authorization:"Bearer "+env.CLOUDFLARE_API_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({html,screenshot:{type:"png",fullPage:false},viewport:{width:1000,height:900,deviceScaleFactor:1}})});if(!r.ok)throw Error("Renderer failed");const b=Buffer.from(await r.arrayBuffer());if(b.length<100||b.length>10*1024*1024||b[0]!==137||b[1]!==80||b[2]!==78||b[3]!==71)throw Error("Invalid PNG");return b;}
 async function sendCard(id,s,style){const logo=fs.readFileSync(path.join(rootDir,"chaysa-logo-option4.svg")).toString("base64");const png=await render(buildInvitationHtml(s,style,"data:image/svg+xml;base64,"+logo));const url=buildInvitationUrl(env.CHAYSA_INVITATION_BASE_URL||"https://chaysa.up.railway.app/invitation.html",s,style);const f=new FormData();f.set("chat_id",String(id));f.set("photo",new Blob([png],{type:"image/png"}),"chaysa-invitation.png");f.set("caption","دعوت‌نامه اختصاصی چایسا برای "+[s.name,s.surname].filter(Boolean).join(" "));f.set("reply_markup",JSON.stringify({inline_keyboard:[[{text:"مشاهده کارت دعوت",url}]]}));await api("sendPhoto",f,true);clear(id);}
 async function handle(update){
  const cb=update&&update.callback_query,m=update&&update.message;
  if(cb){const d=String(cb.data||"");if(!d.startsWith("chaysa_inv_style:"))return false;const id=cb.message&&cb.message.chat&&cb.message.chat.id;await api("answerCallbackQuery",{callback_query_id:cb.id});const s=get(id),style=d.slice(17);if(!s||s.stage!=="style"||!STYLES[style]){await api("sendMessage",{chat_id:id,text:"زمان ساخت این دعوت‌نامه تمام شده است. برای شروع دوباره /invite را بفرست."});return true;}try{await sendCard(id,s,style);}catch(_){await api("sendMessage",{chat_id:id,text:"ساخت یا ارسال کارت تصویری موقتاً ناموفق بود. اطلاعات شما حفظ شده است؛ دوباره یکی از سبک‌ها را انتخاب کنید."});}return true;}
  if(!m||!m.chat||m.chat.type!=="private"||typeof m.text!=="string")return false;const id=m.chat.id,t=m.text.trim();
  if(t==="/invite"||t.startsWith("/invite ")){save(id,{stage:"name"});await api("sendMessage",{chat_id:id,text:"برای ساخت کارت دعوت اختصاصی، نام دریافت‌کننده را بنویس:"});return true;}
  if(t==="/cancel"){clear(id);await api("sendMessage",{chat_id:id,text:"ساخت دعوت‌نامه لغو شد."});return true;}
  const s=get(id);if(!s)return false;
  if(s.stage==="name"){if(!t||t.startsWith("/")){await api("sendMessage",{chat_id:id,text:"نام معتبر نیست؛ دوباره بنویس:"});return true;}s.name=clean(t,60);s.stage="surname";save(id,s);await api("sendMessage",{chat_id:id,text:"نام خانوادگی را بفرست؛ برای رد کردن /skip را بزن."});return true;}
  if(s.stage==="surname"){s.surname=t==="/skip"?"":clean(t,60);s.stage="title";save(id,s);await api("sendMessage",{chat_id:id,text:"خطاب دلخواه را بنویس؛ اختیاری است. برای رد کردن /skip را بزن."});return true;}
  if(s.stage==="title"){s.title=t==="/skip"?"":clean(t,40);s.stage="style";save(id,s);const keys=[["luxury","لوکس و رسمی"],["friendly","صمیمی و دوستانه"],["art","هنری و شاعرانه"],["romantic","لطیف و احساسی"],["religious","مذهبی و معنوی"],["mystic","عارفانه"],["humor","طنز و شوخ‌طبعانه"]];const rows=[];for(let i=0;i<keys.length;i+=2)rows.push(keys.slice(i,i+2).map(x=>({text:x[1],callback_data:"chaysa_inv_style:"+x[0]})));await api("sendMessage",{chat_id:id,text:"سبک کارت دعوت را انتخاب کن:",reply_markup:{inline_keyboard:rows}});return true;}
  if(s.stage==="style"){await api("sendMessage",{chat_id:id,text:"یکی از سبک‌های دکمه‌های بالا را انتخاب کن یا /cancel را بفرست."});return true;}return false;
 }
 return {handle};
}
module.exports={createInvitationBot,escapeHtml,buildInvitationUrl,buildInvitationHtml,STYLES};
