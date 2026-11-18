(function () {
  "use strict";
  const root = document.getElementById("chaysaResearchBank");
  if (!root) return;
  let list = null;
  let search = null;
  let summary = null;
  const status = root.querySelector("[data-health-bank-status]");
  const tabButtons = Array.from(document.querySelectorAll("[data-health-bank-tab]"));
  const guide = document.getElementById("chaysaGuide");
  const state = { tab: "botanical", query: "", queries: {}, research: null, liveProducts: [] };

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
    renderProfiles("چای", p => normalize(p.scientificName).includes("camellia"),
      [{key:"summary",label:"شناخت و فرآوری:"},{key:"evidence",label:"شواهد و محدودیت‌ها:"},{key:"safety",label:"ایمنی:"},{key:"interaction",label:"تداخل‌های گزارش‌شده:"},{key:"formCaution",label:"نکته درباره شکل فرآورده:"}]);
  }
  function renderInfusions() {
    renderProfiles("دمنوش‌ها", p => !normalize(p.scientificName).includes("camellia"),
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
    const live = state.liveProducts.filter(p => p && p.active !== false && p.name);
    const visible = state.query ? live.filter(p => matches(p)) : [];
    summary.textContent = state.query ? visible.length + " محصول مطابق جست‌وجو از " + live.length + " محصول فعال" : "برای یافتن دستور مستند، نام محصول یا شناسه آن را جست‌وجو کنید.";
    visible.forEach(product => {
      const item = card(product.name, product.category || "محصول فعال");
      if (product.sku) addLine(item, "شناسه:", product.sku);
      addLine(item, "وضعیت دستور آماده‌سازی:", "دستور اختصاصی و تأییدشده سازنده برای این محصول در بانک فعلی ثبت نشده است.");
      addLine(item, "", "دما، زمان، نسبت آب به محصول و دفعات دم‌آوری بدون مدرک سازنده حدس زده نمی‌شود.");
      list.append(item);
    });
    if (state.query && !visible.length) empty("محصول فعالی با این نام یا شناسه پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", "برای هر محصول، دستور دقیق باید از برچسب رسمی یا راهنمای سازنده همان محصول دریافت شود. بانک فعلی هنوز دستور اختصاصی تأییدشده همه محصولات را ندارد."));
  }
  function renderQaBank() {
    if (!state.query) {
      summary.textContent = "برای یافتن منابع مرتبط با پرسش خود، عبارت موردنظر را جست‌وجو کنید.";
      empty("جست‌وجوی این بخش، پرونده‌های گیاهی، منابع علمی و کتاب‌های ثبت‌شده در بانک داخلی را بررسی می‌کند.");
      list.append(make("p", "health-bank-inline-note", "پس از جست‌وجو می‌توانید پرسش خود را در فرم همین بخش ثبت کنید. این بخش پاسخ پزشکی یا تشخیص ارائه نمی‌کند."));
      return;
    }
    const profilesVisible = profiles().filter(matches);
    const sourcesVisible = (state.research.sources || []).filter(matches);
    const booksVisible = (state.research.bookBibliography || []).filter(matches);
    summary.textContent = profilesVisible.length + " پرونده گیاهی، " + sourcesVisible.length + " منبع علمی و " + booksVisible.length + " کتاب/مرجع مرتبط";
    if (profilesVisible.length) {
      list.append(make("h3", "health-bank-group-title", "پرونده‌های گیاهی مرتبط"));
      profilesVisible.forEach(profile => {
        const item = card(profile.commonName || profile.scientificName, "پرونده مرجع");
        addLine(item, "نام علمی:", profile.scientificName);
        addLine(item, "خلاصه:", profile.summary);
        appendSourceRefs(item, profile.sourceIds, sourceMap());
        list.append(item);
      });
    }
    if (sourcesVisible.length) {
      list.append(make("h3", "health-bank-group-title", "منابع علمی مرتبط"));
      sourcesVisible.forEach(source => {
        const item = card(source.title, source.publisher);
        addLine(item, "دامنه منبع:", (source.supportsFa || source.supports || []).join("؛ "));
        addLink(item, "بازکردن منبع اصلی", source.url);
        list.append(item);
      });
    }
    if (booksVisible.length) {
      list.append(make("h3", "health-bank-group-title", "کتاب‌ها و مراجع مرتبط"));
      booksVisible.forEach(book => {
        const item = card(book.title, book.language || "مرجع");
        addLine(item, "نویسنده:", book.author);
        addLine(item, "ناشر:", book.publisher);
        addLink(item, "مشاهده رکورد کتاب‌شناختی", book.catalogueUrl);
        list.append(item);
      });
    }
    if (!profilesVisible.length && !sourcesVisible.length && !booksVisible.length)
      empty(state.query ? "مورد مرتبطی در بانک فعلی پیدا نشد." : "برای جست‌وجوی منابع مرتبط با پرسش خود، عبارت موردنظر را وارد کنید.");
    list.append(make("p", "health-bank-inline-note", "این جست‌وجو فقط منابع و پرونده‌های ثبت‌شده در بانک داخلی را پیدا می‌کند؛ پاسخ پزشکی یا تشخیص ارائه نمی‌شود."));
  }
  function activatePanel(tab) {
    const panels = Array.from(root.querySelectorAll("[data-health-section-panel]"));
    panels.forEach(panel => { panel.hidden = panel.dataset.healthSectionPanel !== tab; });
    const active = panels.find(panel => panel.dataset.healthSectionPanel === tab);
    if (!active) return;
    list = active.querySelector("[data-health-bank-list]");
    summary = active.querySelector("[data-health-bank-summary]");
    search = active.querySelector("[data-health-bank-search]");
    state.query = state.queries[tab] || "";
    search.value = state.query;
  }
  function render() {
    if (!state.research) return;
    const headings = {
      botanical:"دانشنامه گیاهان دارویی", tea:"دنیای چای", infusions:"دنیای دمنوش‌ها",
      properties:"خواص و کاربردها", compounds:"ترکیبات و مواد مؤثره",
      preparation:"روش مصرف و آماده‌سازی", safety:"موارد احتیاط و ایمنی",
      products:"راهنمای انتخاب محصولات چایسا", sources:"کتابخانه منابع و مقالات"
    };
    const heading = document.getElementById("healthBankTitle");
    if (heading) heading.textContent = headings[state.tab] || "بانک موضوعی سلامت چایسا";
    list.replaceChildren();
    tabButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.healthBankTab === state.tab)));
    if (state.tab === "botanical") renderProfiles("دانشنامه گیاهان", () => true,
      [{key:"summary",label:"معرفی:"},{key:"evidence",label:"شواهد:"},{key:"safety",label:"ایمنی:"},{key:"interaction",label:"تداخل‌ها:"},{key:"formCaution",label:"محدودیت تعمیم:"}]);
    else if (state.tab === "tea") renderTea();
    else if (state.tab === "infusions") renderInfusions();
    else if (state.tab === "properties") renderProperties();
    else if (state.tab === "compounds") renderCompounds();
    else if (state.tab === "preparation") renderPreparation();
    else if (state.tab === "qa") renderQaBank();
    else if (state.tab === "safety") renderSafety();
    else if (state.tab === "products") renderProducts();
    else if (state.tab === "sources") renderSources();
  }
  function sectionKeywords(tab) {
    const research = state.research || {};
    const profiles = research.botanicalProfiles || [];
    const products = state.liveProducts.filter(item => item && item.active !== false);
    const sources = research.sources || [];
    const books = research.bookBibliography || [];
    let values = [];
    const profileNames = profiles.flatMap(item => [item.commonName, item.scientificName]);
    const productNames = products.map(item => item.name);
    const sourceNames = sources.map(item => item.title);
    const bookNames = books.map(item => item.title);
    if (tab === "botanical") values = profileNames;
    else if (tab === "tea") values = profiles.filter(item => normalize(item.scientificName).includes("camellia")).flatMap(item => [item.commonName, item.scientificName]);
    else if (tab === "infusions") values = profiles.filter(item => !normalize(item.scientificName).includes("camellia")).flatMap(item => [item.commonName, item.scientificName]);
    else if (tab === "properties") values = profiles.flatMap(item => [item.commonName, item.summary, item.evidence]);
    else if (tab === "compounds") values = sourceNames.filter(value => /ترکیب|فیتوشیمی|کافئین|پلی|chemical|constituent/i.test(value)).concat(profileNames);
    else if (tab === "preparation" || tab === "products") values = productNames;
    else if (tab === "safety") values = profiles.flatMap(item => [item.commonName, item.safety, item.interaction]).concat((research.generalSafetyRules || []));
    else if (tab === "qa") values = profileNames.concat(sourceNames, bookNames);
    else if (tab === "sources") values = sourceNames.concat(bookNames);
    const seen = new Set();
    return values.map(value => String(value || "").trim()).filter(value => {
      const key = normalize(value);
      if (!key || key.length < 2 || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 18);
  }
  function addSearchTools() {
    root.querySelectorAll("[data-health-bank-search]").forEach(input => {
      if (input.parentElement.querySelector(".health-bank-search-tools")) return;
      const tab = input.dataset.healthBankSearch;
      const tools = make("div", "health-bank-search-tools");
      const submit = make("button", "", "جست‌وجو");
      submit.type = "button";
      submit.addEventListener("click", () => {
        state.queries[tab] = normalize(input.value);
        if (state.tab === tab) { state.query = state.queries[tab]; render(); }
      });
      const drawer = make("details", "health-keyword-drawer");
      const summaryNode = make("summary", "", "انتخاب کلیدواژه ▾");
      const options = make("div", "health-keyword-options");
      options.setAttribute("aria-label", "کلیدواژه‌های پیشنهادی");
      drawer.append(summaryNode, options);
      tools.append(submit, drawer);
      input.insertAdjacentElement("afterend", tools);
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit.click();
        }
      });
      drawer.addEventListener("toggle", () => {
        if (!drawer.open || drawer.dataset.loaded === "true") return;
        if (!state.research) {
          options.replaceChildren(make("p", "", "در حال دریافت کلیدواژه‌های این بخش…"));
          return;
        }
        options.replaceChildren();
        sectionKeywords(tab).forEach(keyword => {
          const choice = make("button", "", keyword);
          choice.type = "button";
          choice.addEventListener("click", () => {
            input.value = keyword;
            state.queries[tab] = normalize(keyword);
            state.query = state.queries[tab];
            drawer.open = false;
            input.focus();
          });
          options.append(choice);
        });
        if (!options.childElementCount) options.append(make("p", "", "کلیدواژه‌ای برای این بخش ثبت نشده است."));
        drawer.dataset.loaded = "true";
      });
    });
  }
  const requestedSection = new URLSearchParams(window.location.search).get("section");
  const validTabs = new Set(tabButtons.map(button => button.dataset.healthBankTab));
  const isSectionPage = validTabs.has(requestedSection);
  if (isSectionPage) {
    state.tab = requestedSection;
    document.body.classList.add("health-section-page");
    const back = document.getElementById("healthPageBack");
    if (back) { back.href = "/health-advisor.html"; back.textContent = "بازگشت به فهرست بخش‌ها"; }
    root.hidden = false;
  }
  tabButtons.forEach(button => button.addEventListener("click", () => {
    const tab = button.dataset.healthBankTab;
    window.location.href = "/health-advisor.html?section=" + encodeURIComponent(tab);
  }));
  root.querySelectorAll("[data-health-bank-search]").forEach(input => input.addEventListener("input", () => {
    const tab = input.dataset.healthBankSearch;
    state.queries[tab] = normalize(input.value);
  }));
  activatePanel(state.tab);
  addSearchTools();
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
    activatePanel(state.tab);
    const activeCount = products.filter(p => p && p.active !== false).length;
    const inactiveCount = products.filter(p => p && p.active === false).length;
    status.textContent = "بانک پژوهشی در وضعیت پیش‌نویس و اعتبارسنجی است؛ " + activeCount +
      " محصول فعال در فهرست زنده و " + inactiveCount + " محصول غیرفعال خارج از نمایش مشتری. این داده‌ها پاسخ پزشکی تأییدشده نیستند.";
    addSearchTools();
    render();
    if (state.tab === "qa" && isSectionPage) {
      const question = document.getElementById("chaysaGuideQuestion");
      if (question) question.focus({ preventScroll: true });
    }
  }).catch(error => {
    status.textContent = (error && error.message) || "بارگذاری بانک پژوهشی انجام نشد.";
    summary.textContent = "اطلاعات فعلاً بارگذاری نشده است.";
    empty("بانک در دسترس نیست؛ لطفاً بعداً دوباره تلاش کنید.");
  });
})();