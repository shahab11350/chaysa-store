(function () {
  "use strict";
  const root = document.getElementById("chaysaResearchBank");
  if (!root) return;
  const list = root.querySelector("[data-health-bank-list]");
  const search = root.querySelector("[data-health-bank-search]");
  const summary = root.querySelector("[data-health-bank-summary]");
  const status = root.querySelector("[data-health-bank-status]");
  const tabButtons = Array.from(document.querySelectorAll("[data-health-bank-tab]"));
  const guide = document.getElementById("chaysaGuide");
  const state = { tab: "botanical", query: "", research: null, liveProducts: [] };

  function normalize(value) {
    return String(value || "").toLocaleLowerCase("fa").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
      .replace(/[\u200c\u200f\u200e]/g, " ").replace(/\s+/g, " ").trim();
  }
  function make(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; }
    catch (_) { return ""; }
  }
  function addLink(parent, label, href) {
    const url = safeUrl(href); if (!url) return;
    const a = make("a", "health-bank-link", label || "مشاهده منبع");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; parent.appendChild(a);
  }
  function addLine(card, label, value) {
    if (value === undefined || value === null || value === "") return;
    const p = make("p", "health-bank-line");
    if (label) p.append(make("strong", "", label + " "));
    p.append(document.createTextNode(String(value))); card.appendChild(p);
  }
  function addList(card, label, values) {
    if (!Array.isArray(values) || !values.length) return;
    const wrap = make("div", "health-bank-detail"); wrap.append(make("strong", "", label));
    const ul = make("ul"); values.forEach(value => ul.append(make("li", "", value)));
    wrap.append(ul); card.append(wrap);
  }
  function card(title, kind) {
    const node = make("article", "health-bank-card"); node.append(make("h3", "", title));
    if (kind) node.append(make("span", "health-bank-tag", kind)); return node;
  }
  function matches(record) { return !state.query || normalize(JSON.stringify(record)).includes(state.query); }
  function empty(message) { list.append(make("p", "health-bank-empty", message)); }
  function sourceMap() { return new Map((state.research.sources || []).map(source => [source.id, source])); }
  function appendSourceRefs(parent, ids, sources) {
    if (!Array.isArray(ids) || !ids.length) return;
    const box = make("div", "health-bank-refs"); box.append(make("strong", "", "منابع مرتبط:"));
    ids.forEach(id => { const source = sources.get(id); if (source) addLink(box, source.title + " — " + source.publisher, source.url); });
    if (box.querySelector("a")) parent.append(box);
  }
  function profiles() { return state.research.botanicalProfiles || []; }
  function renderProfiles(title, selector, fields) {
    const sources = sourceMap();
    const visible = profiles().filter(selector).filter(matches);
    summary.textContent = visible.length + " پرونده از " + profiles().filter(selector).length + " پرونده مرجع";
    visible.forEach(profile => {
      const item = card(profile.commonName || profile.scientificName, profile.identityStatus || "پرونده مرجع گیاهی");
      addLine(item, "نام علمی:", profile.scientificName);
      fields.forEach(field => addLine(item, field.label, profile[field.key]));
      appendSourceRefs(item, profile.sourceIds, sources);
      list.append(item);
    });
    if (!visible.length) empty("پرونده‌ای با این عبارت در بانک فعلی پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", state.research.disclaimer || ""));
  }
  function renderProducts() {
    const bySku = new Map((state.research.products || []).map(p => [String(p.sku || ""), p]).filter(([sku]) => sku));
    const live = state.liveProducts.filter(p => p && p.active !== false && p.name);
    const visible = live.filter(p => matches({ ...p, research: bySku.get(String(p.sku || "")) }));
    summary.textContent = visible.length + " محصول فعال از " + live.length + " محصول فعالِ فهرست زنده";
    visible.forEach(product => {
      const record = bySku.get(String(product.sku || ""));
      const item = card(product.name, product.category || "محصول");
      if (product.sku) addLine(item, "شناسه:", product.sku);
      if (record && record.nameMentionedIngredients?.length)
        addList(item, "مواد نام‌برده‌شده در عنوان (نه ترکیب تأییدشده):", record.nameMentionedIngredients);
      addLine(item, "وضعیت پرونده:", record ? "پرونده پژوهشی اولیه ثبت شده؛ ترکیبات و مقدار مواد هنوز با برچسب رسمی/مدارک تولیدکننده تطبیق نهایی نشده است." : "برای این محصول هنوز رکورد پژوهشی اختصاصی در بانک ثبت نشده است.");
      addLine(item, "", record?.nameInterpretationWarning || "نام محصول به‌تنهایی ترکیب، مقدار، خواص یا ایمنی آن را اثبات نمی‌کند.");
      if (record?.missingEvidence?.length) addList(item, "مدارک و اطلاعات موردنیاز برای تکمیل پرونده:", record.missingEvidence);
      list.append(item);
    });
    if (!visible.length) empty("محصول فعالی با این عبارت پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", "فهرست محصولات در هر بار بارگذاری از کاتالوگ زنده دریافت می‌شود؛ محصول غیرفعال در نمایش مشتری نشان داده نمی‌شود."));
  }
  function renderSafety() {
    const sources = sourceMap(), rules = state.research.generalSafetyRules || [];
    const visibleRules = rules.filter(matches), profilesVisible = profiles().filter(matches);
    if (visibleRules.length) {
      const item = card("قواعد عمومی ایمنی", "اصول پایه");
      visibleRules.forEach(rule => item.append(make("p", "health-bank-line", rule)));
      list.append(item);
    }
    profilesVisible.forEach(profile => {
      const item = card(profile.commonName || profile.scientificName, "ملاحظات ایمنی");
      addLine(item, "نام علمی:", profile.scientificName);
      addLine(item, "ملاحظات ایمنی:", profile.safety);
      addLine(item, "محدودیت شواهد:", profile.evidence);
      addLine(item, "تفاوت شکل فرآورده:", profile.formCaution);
      appendSourceRefs(item, profile.sourceIds, sources); list.append(item);
    });
    summary.textContent = visibleRules.length + " قاعده عمومی و " + profilesVisible.length + " پرونده گیاهی";
    if (!visibleRules.length && !profilesVisible.length) empty("موردی با این عبارت پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", state.research.disclaimer || ""));
  }
  function renderSources() {
    const sources = (state.research.sources || []).filter(matches);
    const books = (state.research.bookBibliography || []).filter(matches);
    summary.textContent = sources.length + " منبع علمی و " + books.length + " کتاب و مرجع";
    const local = sources.filter(s => String(s.id || "").startsWith("S-IR-") || String(s.sourceType || "").includes("iranian"));
    const international = sources.filter(s => !local.includes(s));
    [["منابع بین‌المللی", international], ["منابع و مراکز علمی ایران", local]].forEach(([heading, rows]) => {
      if (!rows.length) return;
      list.append(make("h3", "health-bank-group-title", heading));
      rows.forEach(source => {
        const item = card(source.title, source.publisher);
        addLine(item, "عنوان اصلی:", source.originalTitle);
        addLine(item, "نوع منبع:", source.sourceType);
        addLine(item, "خلاصه دامنه منبع:", (source.supportsFa || source.supports || []).join("؛ "));
        addLine(item, "آخرین بررسی ثبت‌شده:", source.accessedAt);
        addLink(item, "بازکردن منبع اصلی", source.url); list.append(item);
      });
    });
    if (books.length) list.append(make("h3", "health-bank-group-title", "کتاب‌ها و مراجع تخصصی"));
    books.forEach(book => {
      const item = card(book.title, book.language || "زبان ثبت‌شده نامشخص");
      addLine(item, "نویسنده / گردآورنده:", book.author);
      addLine(item, "ناشر:", book.publisher);
      addLine(item, "مشخصات انتشار:", book.publicationDetails);
      addList(item, "حوزه‌های موضوعی:", book.scope);
      addLine(item, "محدودیت و شیوه استفاده:", book.limitations);
      addLink(item, "مشاهده رکورد کتاب‌شناختی", book.catalogueUrl); list.append(item);
    });
    if (!sources.length && !books.length) empty("منبع یا کتابی با این عبارت پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", state.research.bookBibliographyDisclaimer || ""));
  }
  function renderTea() {
    renderProfiles("چای", p => normalize(p.scientificName).includes("camellia") || normalize(p.commonName).includes("چای"),
      [{key:"summary",label:"شناخت و فرآوری:"},{key:"evidence",label:"شواهد و محدودیت‌ها:"},{key:"safety",label:"ایمنی:"},{key:"interaction",label:"تداخل‌های گزارش‌شده:"},{key:"formCaution",label:"نکته درباره شکل فرآورده:"}]);
  }
  function renderInfusions() {
    renderProfiles("دمنوش‌ها", p => !(normalize(p.scientificName).includes("camellia") || normalize(p.commonName).includes("چای")),
      [{key:"summary",label:"شناخت گیاه:"},{key:"evidence",label:"شواهد و محدودیت‌ها:"},{key:"safety",label:"ایمنی:"},{key:"interaction",label:"تداخل‌های گزارش‌شده:"},{key:"formCaution",label:"نکته درباره شکل فرآورده:"}]);
  }
  function renderProperties() {
    renderProfiles("خواص و کاربردها", () => true,
      [{key:"summary",label:"اطلاعات علمی:"},{key:"evidence",label:"وضعیت شواهد:"},{key:"formCaution",label:"محدودیت تعمیم:"}]);
  }
  function renderCompounds() {
    const sources = (state.research.sources || []).filter(s => matches(s) &&
      /ترکیب|فیتوشیمی|مواد مؤثره|کافئین|پلی.fenol|polyphenol|chemical|constituent/i.test(JSON.stringify(s)));
    const items = profiles().filter(matches);
    summary.textContent = items.length + " پرونده گیاهی؛ " + sources.length + " منبع مرتبط با ترکیبات";
    items.forEach(profile => {
      const item = card(profile.commonName || profile.scientificName, "شناخت علمی، نه آنالیز محصول");
      addLine(item, "نام علمی:", profile.scientificName);
      addLine(item, "اطلاعات ثبت‌شده:", profile.summary);
      addLine(item, "محدودیت:", "این اطلاعات عمومی درباره گیاه/ماده است؛ ترکیب و مقدار واقعی هیچ SKU چایسا را بدون برچسب رسمی یا آزمون آزمایشگاهی اثبات نمی‌کند.");
      appendSourceRefs(item, profile.sourceIds, sourceMap()); list.append(item);
    });
    if (!items.length) empty("پرونده‌ای با این عبارت پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", "بانک فعلی آنالیز آزمایشگاهی یا درصد مواد مؤثره محصولات چایسا را در اختیار ندارد. اطلاعات ترکیبات باید با اسناد تولیدکننده یا آزمون معتبر تکمیل شود."));
  }
  function renderPreparation() {
    const gaps = (state.research.researchGaps || []).filter(g => /دم‌آوری|آماده|دما|زمان|نسبت آب|روش مصرف/i.test(g));
    const item = card("روش آماده‌سازی و مصرف", "وضعیت مستندات");
    addLine(item, "", "برای هر محصول، دستور دقیق باید از برچسب رسمی یا راهنمای سازنده همان محصول گرفته شود. دما، زمان، نسبت آب به محصول و دفعات دم‌آوری را نمی‌توان از نام گیاه یا محصول حدس زد.");
    addLine(item, "وضعیت فعلی:", "دستور اختصاصی و تأییدشده سازنده برای همه محصولات در بانک ثبت نشده است.");
    addList(item, "اطلاعاتی که باید از سازنده دریافت شود:", ["دمای مناسب آب", "زمان دم‌آوری", "نسبت آب به مقدار محصول", "تعداد دفعات قابل دم‌آوری", "محدودیت نگهداری پس از آماده‌سازی"]);
    list.append(item);
    if (gaps.length) addList(list, "شکاف‌های ثبت‌شده پژوهش:", gaps);
    summary.textContent = "راهنمای عمومی و شکاف‌های اطلاعاتی؛ دستور اختصاصی محصول هنوز نیازمند مدرک است";
  }
  function render() {
    if (!state.research) return;
    list.replaceChildren();
    tabButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.healthBankTab === state.tab)));
    if (state.tab === "botanical") renderProfiles("دانشنامه گیاهان", () => true,
      [{key:"summary",label:"معرفی:"},{key:"evidence",label:"شواهد:"},{key:"safety",label:"ایمنی:"},{key:"interaction",label:"تداخل‌ها:"},{key:"formCaution",label:"محدودیت تعمیم:"}]);
    else if (state.tab === "tea") renderTea();
    else if (state.tab === "infusions") renderInfusions();
    else if (state.tab === "properties") renderProperties();
    else if (state.tab === "compounds") renderCompounds();
    else if (state.tab === "preparation") renderPreparation();
    else if (state.tab === "safety") renderSafety();
    else if (state.tab === "products") renderProducts();
    else if (state.tab === "sources") renderSources();
  }
  tabButtons.forEach(button => button.addEventListener("click", () => {
    const tab = button.dataset.healthBankTab;
    if (tab === "qa") {
      if (guide) guide.scrollIntoView({ behavior: "smooth", block: "start" });
      const question = document.getElementById("chaysaGuideQuestion");
      if (question) question.focus({ preventScroll: true });
      return;
    }
    state.tab = tab;
    state.query = normalize(search.value);
    render();
    root.hidden = false;
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  search.addEventListener("input", () => { state.query = normalize(search.value); render(); });
  Promise.all([
    fetch("/data/health/health-product-research.json", { cache: "no-store", credentials: "same-origin" }).then(r => {
      if (!r.ok) throw new Error("بانک پژوهشی در دسترس نیست."); return r.json();
    }),
    fetch("/api/products", { cache: "no-store", credentials: "same-origin" }).then(r => {
      if (!r.ok) throw new Error("فهرست زنده محصولات در دسترس نیست."); return r.json();
    })
  ]).then(([research, products]) => {
    if (!research || !Array.isArray(research.products) || !Array.isArray(research.sources) ||
        !Array.isArray(research.bookBibliography) || !Array.isArray(research.botanicalProfiles) || !Array.isArray(products))
      throw new Error("ساختار بانک پژوهشی معتبر نیست.");
    state.research = research; state.liveProducts = products;
    const activeCount = products.filter(p => p && p.active !== false).length;
    const inactiveCount = products.filter(p => p && p.active === false).length;
    status.textContent = "بانک پژوهشی در وضعیت پیش‌نویس و اعتبارسنجی است؛ " + activeCount +
      " محصول فعال در فهرست زنده و " + inactiveCount + " محصول غیرفعال خارج از نمایش مشتری. این داده‌ها پاسخ پزشکی تأییدشده نیستند.";
    render();
  }).catch(error => {
    status.textContent = (error && error.message) || "بارگذاری بانک پژوهشی انجام نشد.";
    summary.textContent = "اطلاعات فعلاً بارگذاری نشده است.";
    empty("بانک در دسترس نیست؛ لطفاً بعداً دوباره تلاش کنید.");
  });
})();