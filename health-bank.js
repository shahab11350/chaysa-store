(function () {
  "use strict";
  const root = document.getElementById("chaysaResearchBank");
  if (!root) return;
  const list = root.querySelector("[data-health-bank-list]");
  const search = root.querySelector("[data-health-bank-search]");
  const summary = root.querySelector("[data-health-bank-summary]");
  const status = root.querySelector("[data-health-bank-status]");
  const tabButtons = Array.from(document.querySelectorAll("[data-health-bank-tab]"));
  const state = { tab: "products", query: "", research: null, liveProducts: [] };
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
  function appendEmpty(message) { list.append(make("p", "health-bank-empty", message)); }
  function renderProducts() {
    const bySku = new Map((state.research.products || []).map(p => [String(p.sku || ""), p]).filter(([sku]) => sku));
    const live = state.liveProducts.filter(p => p && p.active !== false && p.name);
    const visible = live.filter(p => matches({ ...p, research: bySku.get(String(p.sku || "")) }));
    summary.textContent = visible.length + " محصول فعال از " + live.length + " محصول فعالِ فهرست زنده";
    visible.forEach(product => {
      const record = bySku.get(String(product.sku || ""));
      const item = card(product.name, product.category || "محصول");
      if (product.sku) addLine(item, "شناسه:", product.sku);
      if (record && record.nameMentionedIngredients && record.nameMentionedIngredients.length)
        addList(item, "مواد نام‌برده‌شده در عنوان (نه ترکیب تأییدشده):", record.nameMentionedIngredients);
      addLine(item, "وضعیت پرونده:", record ? "پرونده پژوهشی اولیه ثبت شده؛ ترکیبات و مقدار مواد هنوز با برچسب رسمی/مدارک تولیدکننده تطبیق نهایی نشده است." : "برای این محصول هنوز رکورد پژوهشی اختصاصی در بانک ثبت نشده است.");
      addLine(item, "", "نام محصول به‌تنهایی ترکیب، مقدار، خواص یا ایمنی آن را اثبات نمی‌کند.");
      list.append(item);
    });
    if (!visible.length) appendEmpty("محصول فعالی با این عبارت پیدا نشد.");
  }
  function sourceMap() { return new Map((state.research.sources || []).map(source => [source.id, source])); }
  function appendSourceRefs(parent, ids, sources) {
    if (!Array.isArray(ids) || !ids.length) return;
    const box = make("div", "health-bank-refs"); box.append(make("strong", "", "منابع مرتبط:"));
    ids.forEach(id => { const source = sources.get(id); if (source) addLink(box, source.title + " — " + source.publisher, source.url); });
    if (box.querySelector("a")) parent.append(box);
  }
  function renderInteractions() {
    const sources = sourceMap(), profiles = (state.research.botanicalProfiles || []).filter(matches);
    summary.textContent = profiles.length + " پرونده مرجع گیاهی";
    profiles.forEach(profile => {
      const item = card(profile.commonName || profile.scientificName, "تداخل‌های احتمالی");
      addLine(item, "نام علمی:", profile.scientificName);
      addLine(item, "وضعیت شناسایی:", profile.identityStatus);
      addLine(item, "اطلاعات تداخل:", profile.interaction);
      addLine(item, "محدودیت تعمیم:", profile.formCaution);
      appendSourceRefs(item, profile.sourceIds, sources); list.append(item);
    });
    if (!profiles.length) appendEmpty("پرونده‌ای با این عبارت پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", state.research.disclaimer || ""));
  }
  function renderSafety() {
    const sources = sourceMap(), rules = state.research.generalSafetyRules || [];
    const visibleRules = rules.filter(matches), ruleCard = card("قواعد عمومی ایمنی", "اصول ثابت");
    visibleRules.forEach(rule => ruleCard.append(make("p", "health-bank-line", rule)));
    list.append(ruleCard);
    const profiles = (state.research.botanicalProfiles || []).filter(matches);
    profiles.forEach(profile => {
      const item = card(profile.commonName || profile.scientificName, "احتیاط و عوارض");
      addLine(item, "نام علمی:", profile.scientificName);
      addLine(item, "ملاحظات ایمنی:", profile.safety);
      addLine(item, "محدودیت شواهد:", profile.evidence);
      addLine(item, "تفاوت شکل فرآورده:", profile.formCaution);
      appendSourceRefs(item, profile.sourceIds, sources); list.append(item);
    });
    summary.textContent = visibleRules.length + " قاعده عمومی و " + profiles.length + " پرونده گیاهی";
    if (!visibleRules.length && !profiles.length) appendEmpty("موردی با این عبارت پیدا نشد.");
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
        addLine(item, "عنوان اصلی:", source.title);
        addLine(item, "نوع منبع:", source.sourceType);
        addLine(item, "خلاصه فارسی دامنه منبع:", (source.supportsFa || source.supports || []).join("؛ "));
        addLine(item, "آخرین بررسی ثبت‌شده:", source.accessedAt);
        addLink(item, "بازکردن منبع اصلی", source.url); list.append(item);
      });
    });
    list.append(make("h3", "health-bank-group-title", "کتاب‌ها و مراجع تخصصی"));
    books.forEach(book => {
      const item = card(book.title, book.language || "زبان ثبت‌شده نامشخص");
      addLine(item, "نویسنده / گردآورنده:", book.author);
      addLine(item, "ناشر:", book.publisher);
      addLine(item, "مشخصات انتشار:", book.publicationDetails);
      addList(item, "حوزه‌های موضوعی:", book.scope);
      addLine(item, "محدودیت و شیوه استفاده:", book.limitations);
      addLink(item, "مشاهده رکورد کتاب‌شناختی", book.catalogueUrl); list.append(item);
    });
    if (!sources.length && !books.length) appendEmpty("منبع یا کتابی با این عبارت پیدا نشد.");
    list.append(make("p", "health-bank-inline-note", state.research.bookBibliographyDisclaimer || ""));
  }
  function render() {
    if (!state.research) return;
    list.replaceChildren();
    tabButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.healthBankTab === state.tab)));
    if (state.tab === "products") renderProducts();
    else if (state.tab === "interactions") renderInteractions();
    else if (state.tab === "safety") renderSafety();
    else renderSources();
  }
  tabButtons.forEach(button => button.addEventListener("click", () => {
    state.tab = button.dataset.healthBankTab; state.query = normalize(search.value); render();
    root.hidden = false; root.scrollIntoView({ behavior: "smooth", block: "start" });
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
        !Array.isArray(research.bookBibliography) || !Array.isArray(products))
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
    appendEmpty("بانک در دسترس نیست؛ لطفاً بعداً دوباره تلاش کنید.");
  });
})();