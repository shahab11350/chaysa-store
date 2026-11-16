(function () {
  const root = document.getElementById("chaysaGuide");
  if (!root) return;
  const categoryBox = document.getElementById("chaysaGuideCategories");
  const promptBox = document.getElementById("chaysaGuidePrompts");
  const form = document.getElementById("chaysaGuideForm");
  const product = document.getElementById("chaysaGuideProduct");
  const medicine = document.getElementById("chaysaGuideMedicine");
  const medicineLabel = document.getElementById("chaysaGuideMedicineLabel");
  const question = document.getElementById("chaysaGuideQuestion");
  const status = document.getElementById("chaysaGuideStatus");
  const answer = document.getElementById("chaysaGuideAnswer");
  const healthNotice = document.getElementById("chaysaGuideHealthNotice");
  const prepare = document.getElementById("chaysaGuidePrepare");
  let data = null;
  let category = "products";

  function clearResult() {
    answer.hidden = true;
    answer.removeAttribute("href");
    healthNotice.hidden = true;
    status.textContent = "";
  }
  function selectCategory(id) {
    category = id;
    clearResult();
    categoryBox.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.category === id));
    });
    const safety = id === "safety";
    const showProduct = id === "products" || id === "safety";
    product.hidden = !showProduct;
    product.previousElementSibling.hidden = !showProduct;
    medicine.hidden = !safety;
    medicineLabel.hidden = !safety;
    renderPrompts();
  }
  function renderPrompts() {
    promptBox.replaceChildren();
    if (!data) return;
    data.questionBank.filter(function (item) { return item.category === category; }).forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chaysa-guide-prompt";
      button.textContent = item.label;
      button.addEventListener("click", function () {
        question.value = item.prompt;
        clearResult();
        question.focus();
      });
      promptBox.appendChild(button);
    });
  }
  function render() {
    categoryBox.replaceChildren();
    data.categories.forEach(function (item) {
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
    healthNotice.textContent = data.healthNotice || "";
    selectCategory(category);
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

  [question, medicine, product].forEach(function (field) {
    field.addEventListener("input", clearResult);
    field.addEventListener("change", clearResult);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearResult();
    if (!question.value.trim()) {
      status.textContent = "پرسش خود را وارد کنید.";
      return;
    }
    if ((category === "products" || category === "safety") && !product.value) {
      status.textContent = "ابتدا محصول موردنظر را انتخاب کنید.";
      return;
    }
    if (category === "safety" && !medicine.value.trim()) {
      status.textContent = "نام دارو را در فیلد جداگانه وارد کنید.";
      medicine.focus();
      return;
    }
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
          category: category,
          question: question.value.trim(),
          productSku: product.value,
          medicine: medicine.value.trim()
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "بررسی پرسش انجام نشد.");
      if (!result.allowed || !result.ok) {
        status.textContent = result.message || "این پرسش در محدوده راهنمای چایسا نیست.";
        return;
      }
      const target = new URL(result.url);
      if (target.protocol !== "https:" || target.hostname !== "www.google.com" || target.pathname !== "/search") {
        throw new Error("نشانی جست‌وجو معتبر نیست.");
      }
      answer.href = target.toString();
      answer.hidden = false;
      if (result.notice) {
        healthNotice.textContent = result.notice + (result.rule ? " " + result.rule : "");
        healthNotice.hidden = false;
      }
      status.style.color = "#24613d";
      status.textContent = "پرسش در محدوده راهنمای چایساست. برای مشاهده نتایج، دکمه زیر را بزنید.";
    } catch (error) {
      status.style.color = "#a33";
      status.textContent = error && error.message ? error.message : "ارتباط با راهنما برقرار نشد.";
    } finally {
      prepare.disabled = false;
      prepare.textContent = "بررسی و آماده‌سازی پرسش";
    }
  });
})();