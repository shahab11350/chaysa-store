"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {escapeHtml,buildInvitationUrl,buildInvitationHtml,STYLES}=require("../telegram-invitation");
test("HTML-sensitive recipient characters are escaped",()=>assert.equal(escapeHtml('<img src=x onerror="x"> & \'x\''),"&lt;img src=x onerror=&quot;x&quot;&gt; &amp; &#39;x&#39;"));
test("canonical HTTPS invitation URL encodes recipient fields",()=>{const u=new URL(buildInvitationUrl("https://chaysa.up.railway.app/invitation.html",{name:"علی",surname:"رضایی",title:"جان"},"friendly","test-ref"));assert.equal(u.origin,"https://chaysa.up.railway.app");assert.equal(u.searchParams.get("name"),"علی");assert.equal(u.searchParams.get("surname"),"رضایی");assert.equal(u.searchParams.get("style"),"friendly");assert.throws(()=>buildInvitationUrl("http://example.com/a",{name:"x"},"luxury"));});
test("card HTML escapes guest text and rejects invalid styles",()=>{const h=buildInvitationHtml({name:"<script>alert(1)</script>"},"luxury","data:image/svg+xml;base64,PHN2Zy8+");assert.match(h,/&lt;script&gt;/);assert.doesNotMatch(h,/<script>alert/);assert.match(h,/data:image\/svg\+xml;base64/);assert.throws(()=>buildInvitationHtml({name:"A"},"invalid",""));assert.equal(Object.keys(STYLES).length,7);});

test("Telegram invitation sends one photo with one URL button and no raw-link fallback",async()=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
 const {createInvitationBot}=require("../telegram-invitation");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"chaysa-invite-"));
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(128)]);
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url.includes("/browser-rendering/snapshot"))return {ok:true,json:async()=>({screenshot:png.toString("base64")})};
  if(url.includes("/sendPhoto"))return {ok:true,json:async()=>({ok:true,result:{message_id:42}})};
  return {ok:true,json:async()=>({ok:true})};
 };
 const bot=createInvitationBot({dataDir:dir,rootDir:path.join(__dirname,".."),fetchImpl,env:{TELEGRAM_BOT_TOKEN:"test-token",CLOUDFLARE_ACCOUNT_ID:"account",CLOUDFLARE_API_TOKEN:"test-api-token"}});
 const msg=t=>({message:{chat:{id:123,type:"private"},text:t}});
 await bot.handle(msg("/invite"));await bot.handle(msg("آرمان"));await bot.handle(msg("رضایی"));await bot.handle(msg("جان"));
 await bot.handle({callback_query:{id:"cb1",data:"chaysa_inv_style:luxury",message:{chat:{id:123}}}});
 const photo=calls.find(x=>x.url.includes("/sendPhoto"));
 assert.ok(photo);assert.equal(photo.options.body.get("chat_id"),"123");
 const keyboard=JSON.parse(photo.options.body.get("reply_markup"));
 assert.equal(keyboard.inline_keyboard.length,1);assert.equal(keyboard.inline_keyboard[0].length,1);
 assert.equal(keyboard.inline_keyboard[0][0].text,"مشاهده کارت دعوت");
 assert.match(keyboard.inline_keyboard[0][0].url,/^https:\/\/chaysa\.up\.railway\.app\/invitation\.html\?/);
 assert.equal(photo.options.body.get("caption"),"دعوت‌نامه اختصاصی چایسا برای آرمان رضایی");
 assert.ok(!calls.some(x=>x.url.includes("/sendMessage")&&JSON.stringify(x.options.body).includes("https://chaysa.up.railway.app/invitation.html")));
 assert.equal(fs.existsSync(path.join(dir,"telegram-invitation-sessions.json")),true);
 fs.rmSync(dir,{recursive:true,force:true});
});
