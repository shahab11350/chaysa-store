(function () {
  const root = document.getElementById("chaysaGuide");
  if (!root) return;
  const categoryBox = document.getElementById("chaysaGuideCategories");
  const promptBox = document.getElementById("chaysaGuidePrompts");
  const suggestionBox = document.getElementById("chaysaGuideSuggestions");
  const form = document.getElementById("chaysaGuideForm");
  const product = document.getElementById("chaysaGuideProduct");
  const medicine = document.getElementById("chaysaGuideMedicine");
  const medicineLabel = document.getElementById("chaysaGuideMedicineLabel");
  const question = document.getElementById("chaysaGuideQuestion");
  const status = document.getElementById("chaysaGuideStatus");
  const resultsBox = document.getElementById("chaysaGuideResults");
  const healthNotice = document.getElementById("chaysaGuideHealthNotice");
  const notice = root.querySelector("#chaysaGuideNotice") || healthNotice;
  const prepare = document.getElementById("chaysaGuidePrepare");
  const mode = root.dataset.guideMode === "health" ? "health" : "general";
  const allowedCategories = mode === "health" ? ["products", "safety"] : ["services", "custom"];
  let data = null;
  let category = mode === "health" ? "products" : "services";

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u200f\u200e]/g, " ").replace(/\s+/g, " ").trim();
  }
  function clearResult() {
    if (resultsBox) {
      resultsBox.hidden = true;
      resultsBox.replaceChildren();
    }
    if (notice) notice.hidden = true;
    status.textContent = "";
    status.style.color = "#a33";
  }

  function selectCategory(id) {
    if (!allowedCategories.includes(id)) return;
    if (category !== id && medicine) medicine.value = "";
    category = id;
    clearResult();
    categoryBox.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.category === id));
    });
    const safety = id === "safety";
    const showProduct = id === "products" || id === "safety";
    if (product) {
      product.hidden = !showProduct;
      if (product.previousElementSibling) product.previousElementSibling.hidden = !showProduct;
    }
    if (medicine) medicine.hidden = !safety;
    if (medicineLabel) medicineLabel.hidden = !safety;
    renderPrompts();
    renderSuggestions();
  }
  function renderSuggestions() {
    suggestionBox.replaceChildren();
    if (!data || !question.value.trim()) return;
    const text = normalize(question.value);
    const matches = (data.keywords || []).filter(function (item) { return allowedCategories.includes(item.category); }).filter(function (item) {
      return (item.match || []).some(function (term) { return text.includes(normalize(term)); });
    }).slice(0, 4);
    matches.forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chaysa-guide-prompt";
      button.textContent = "پیشنهاد: " + item.suggestion;
      button.addEventListener("click", function () {
        selectCategory(item.category);
        question.value = item.suggestion;
        clearResult();
        question.focus();
      });
      suggestionBox.appendChild(button);
    });
  }
  function renderPrompts() {
    promptBox.replaceChildren();
    if (!data) return;
    data.questionBank.filter(function (item) { return allowedCategories.includes(item.category) && item.category === category; }).forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chaysa-guide-prompt";
      button.textContent = item.label;
      button.addEventListener("click", function () {
        if (medicine) medicine.value = "";
        question.value = item.prompt;
        clearResult();
        question.focus();
      });
      promptBox.appendChild(button);
    });
  }
  function render() {
    categoryBox.replaceChildren();
    data.categories.filter(function (item) { return allowedCategories.includes(item.id); }).forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chaysa-guide-category";
      button.textContent = item.title;
      button.dataset.category = item.id;
      button.setAttribute("aria-pressed", "false");
      button.title = item.description || "";
      button.addEventListener("click", function () { selectCategory(item.id); });
      categoryBox.appendChild(button);
    });
    if (product) {
      product.replaceChildren();
      const first = document.createElement("option");
      first.value = "";
      first.textContent = "انتخاب محصول";
      product.appendChild(first);
      data.products.forEach(function (item) {
        const option = document.createElement("option");
        option.value = item.sku;
        option.textContent = item.name;
        product.appendChild(option);
      });
    }
    if (healthNotice) healthNotice.textContent = data.healthNotice || "";
    selectCategory(category);
    if (mode === "health") {
      root.querySelectorAll("[data-health-prompt-id]").forEach(function (button) {
        button.addEventListener("click", function () {
          const item = data.questionBank.find(function (entry) { return entry.id === button.dataset.healthPromptId; });
          if (!item || !allowedCategories.includes(item.category)) return;
          selectCategory(item.category);
          question.value = item.prompt;
          renderSuggestions();
          clearResult();
          root.scrollIntoView({behavior:"smooth", block:"start"});
          question.focus({preventScroll:true});
        });
      });
    }
  }

  fetch("/api/guide/bootstrap", { method: "GET", credentials: "same-origin", cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("دریافت اطلاعات راهنما ممکن نشد.");
      return response.json();
    })
    .then(function (result) {
      if (!result || !Array.isArray(result.categories) || !Array.isArray(result.products) || !Array.isArray(result.questionBank)) {
        throw new Error("ساختار اطلاعات راهنما معتبر نیست.");
      }
      data = result;
      render();
    })
    .catch(function () {
      status.textContent = "راهنمای چایسا در حال حاضر در دسترس نیست. لطفاً بعداً دوباره تلاش کنید.";
    });

  [question, medicine, product].filter(Boolean).forEach(function (field) {
    field.addEventListener("input", function () {
      clearResult();
      if (field === question) { if (medicine) medicine.value = ""; renderSuggestions(); }
    });
    field.addEventListener("change", function () {
      if (field === product && medicine) medicine.value = "";
      clearResult();
    });
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearResult();
    if (!question.value.trim()) {
      status.textContent = "پرسش خود را وارد کنید.";
      return;
    }
    if ((category === "products" || category === "safety") && (!product || !product.value)) {
      status.textContent = "ابتدا محصول موردنظر را انتخاب کنید.";
      return;
    }
    const requestSnapshot = {
      category: category,
      question: question.value.trim(),
      productSku: product ? product.value : "",
      medicine: medicine ? medicine.value.trim() : ""
    };
    prepare.disabled = true;
    prepare.textContent = "در حال بررسی...";
    status.textContent = "";
    try {
      const response = await fetch("/api/guide/resolve", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          category: requestSnapshot.category,
          question: requestSnapshot.question,
          productSku: requestSnapshot.productSku,
          medicine: requestSnapshot.medicine
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "بررسی پرسش انجام نشد.");
      if (category !== requestSnapshot.category || question.value.trim() !== requestSnapshot.question ||
          (product ? product.value : "") !== requestSnapshot.productSku || (medicine ? medicine.value.trim() : "") !== requestSnapshot.medicine) {
        status.textContent = "پرسش هنگام بررسی تغییر کرد؛ دوباره آن را بررسی کنید.";
        return;
      }
      if (!result.allowed || !result.ok) {
        status.textContent = result.message || "این پرسش در محدوده راهنمای چایسا نیست.";
        return;
      }
      if (result.type === "internal_knowledge") {
        if (!resultsBox) throw new Error("بخش نمایش نتایج بانک داخلی در صفحه موجود نیست.");
        const heading = document.createElement("h3");
        heading.textContent = "مطالب مرتبط از بانک داخلی چایسا";
        resultsBox.appendChild(heading);
        const policy = document.createElement("p");
        policy.className = "chaysa-guide-result-policy";
        policy.textContent = result.policy || "";
        resultsBox.appendChild(policy);
        if (!Array.isArray(result.sources) || !result.sources.length) {
          const empty = document.createElement("p");
          empty.textContent = result.message || "مطلب مرتبطی پیدا نشد.";
          resultsBox.appendChild(empty);
        } else {
          result.sources.forEach(function (source) {
            const article = document.createElement("article");
            article.className = "chaysa-guide-source";
            const title = document.createElement("h4");
            title.textContent = source.title || "منبع ترجمه‌شده";
            article.appendChild(title);
            const meta = document.createElement("p");
            meta.textContent = [source.publisher, source.originalTitle, source.id].filter(Boolean).join(" | ");
            article.appendChild(meta);
            const relevance = document.createElement("p");
            relevance.textContent = source.relevance || "";
            article.appendChild(relevance);
            (source.excerpts || []).forEach(function (excerpt) {
              const paragraph = document.createElement("p");
              paragraph.textContent = excerpt;
              article.appendChild(paragraph);
            });
            const citation = document.createElement("p");
            citation.className = "chaysa-guide-citation";
            citation.textContent = "منبع اصلی: " + (source.url || "");
            article.appendChild(citation);
            resultsBox.appendChild(article);
          });
        }
        resultsBox.hidden = false;
        resultsBox.scrollIntoView({behavior:"smooth",block:"start"});
      } else if (result.type === "service_guidance") {
        if (notice) { notice.textContent = result.message || ""; notice.hidden = false; }
      } else {
        throw new Error(result.message || "پاسخی از بانک داخلی دریافت نشد.");
      }
      status.style.color = "#24613d";
      status.textContent = result.message || "نتایج بانک داخلی آماده شد.";
    } catch (error) {
      status.style.color = "#a33";
      status.textContent = error && error.message ? error.message : "ارتباط با راهنما برقرار نشد.";
    } finally {
      prepare.disabled = false;
      prepare.textContent = "آماده‌سازی جست‌وجوی منابع";
    }
  });
})();