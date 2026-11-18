const { test, expect } = require("@playwright/test");

test("CHAYSA HEALTH research library renders correctly on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/health-advisor.html");
  await expect(page.locator(".progress")).toContainText("کتابخانه پژوهشی اولیه در دسترس است");
  await expect(page.locator(".progress")).toContainText("مسئولیت صحت آن‌ها را بر عهده نمی‌گیرد");

  await page.locator('[data-health-bank-tab="sources"]').click();
  await expect(page.locator("#chaysaResearchBank")).toBeVisible();
  await expect(page.locator("[data-health-bank-summary]")).toContainText("29 منبع علمی");
  await expect(page.locator("#chaysaResearchBank")).toContainText("صحت نهایی مطالب را تضمین نمی‌کند");

  await page.locator('[data-health-bank-tab="products"]').click();
  await expect(page.locator("[data-health-bank-summary]")).toContainText("محصول فعال");
  const hasHorizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("admin can search PubMed candidates and manually save a selected source", async ({ page }) => {
  await page.goto("/admin.html");
  await page.locator("#password").fill("chaysa-playwright-admin-password");
  await page.locator("#loginBtn").click();
  await expect(page.locator("#app")).toBeVisible();

  await page.locator('[data-view="healthResearchView"]').click();
  await expect(page.locator("#healthResearchStatus")).toContainText("پرونده ثبت‌شده");

  const queue = await page.evaluate(async () => {
    const response = await fetch("/api/admin/health-research/queue");
    return response.json();
  });
  const item = queue.items.find(row => row.catalogActive && row.sku && !row.duplicateSku);
  expect(item).toBeTruthy();

  let card = page.locator("#healthResearchItems article").filter({ hasText: item.sku }).first();
  await card.locator("input").last().fill("Zingiber officinale");
  await card.getByRole("button", { name: "جست‌وجوی رایگان در PubMed" }).click();
  await expect(card).toContainText("PubMed candidate title for integration test");

  await card.getByRole("button", { name: "افزودن به فهرست منابع" }).click();
  await expect(card.locator("textarea").last()).toHaveValue(/PubMed candidate title for integration test/);
  const saveResponsePromise = page.waitForResponse(response => response.url().includes("/api/admin/health-research/queue/") && response.request().method() === "PATCH");
  await card.getByRole("button", { name: "ذخیره پرونده پژوهشی" }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);

  card = page.locator("#healthResearchItems article").filter({ hasText: item.sku }).first();
  await expect(card.locator("textarea").last()).toHaveValue(/PubMed candidate title for integration test/);

  const pdf = Buffer.from("%PDF-1.4\\nCHAYSA TEST EVIDENCE\\n%%EOF");
  await expect(card.locator('input[type="file"]')).toHaveCount(2);
  const labelInput = card.locator('input[type="file"]').nth(0);
  await labelInput.setInputFiles({ name: "label.pdf", mimeType: "application/pdf", buffer: pdf });
  expect(await labelInput.evaluate(input => input.files.length)).toBe(1);
  expect(await labelInput.evaluate(input => input.files[0].name)).toBe("label.pdf");
  const labelResponsePromise = page.waitForResponse(response => response.url().includes("/evidence") && response.request().method() === "POST");
  await card.getByRole("button", { name: "بارگذاری مدرک برچسب" }).click();
  const labelResponse = await labelResponsePromise;
  const labelBody = await labelResponse.json();
  expect(labelResponse.status(), JSON.stringify(labelBody)).toBe(201);
  await expect(card).toContainText("مدرک برچسب · label.pdf");

  await card.locator('input[type="file"]').nth(1).setInputFiles({ name: "composition.pdf", mimeType: "application/pdf", buffer: pdf });
  const compositionResponsePromise = page.waitForResponse(response => response.url().includes("/evidence") && response.request().method() === "POST");
  await card.getByRole("button", { name: "بارگذاری مدرک ترکیبات" }).click();
  const compositionResponse = await compositionResponsePromise;
  const compositionBody = await compositionResponse.json();
  expect(compositionResponse.status(), JSON.stringify(compositionBody)).toBe(201);
  await expect(card).toContainText("مدرک ترکیبات · composition.pdf");

  await card.locator("select").nth(1).selectOption("checked");
  await card.locator("select").nth(2).selectOption("checked");
  await card.locator('input[placeholder="نام بازبین"]').fill("بازبین آزمون");
  await card.locator("select").nth(0).selectOption("approved");
  await card.getByRole("button", { name: "ذخیره پرونده پژوهشی" }).click();
  await expect(card.locator("select").nth(0)).toHaveValue("approved");
});


test("health safety search opens PubMed in the same tab and explains the research-bank status", async ({ page }) => {
  await page.route("https://pubmed.ncbi.nlm.nih.gov/**", route =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>PubMed test</title>" })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/health-advisor.html");
  await page.locator('#chaysaGuideCategories button[data-category="safety"]').click();
  await page.locator("#chaysaGuideProduct").selectOption("1401008");
  await page.locator("#chaysaGuideQuestion").fill("عوارض احتمالی این محصول چیست؟");
  await page.locator("#chaysaGuidePrepare").click();
  const resultLink = page.locator("#chaysaGuideAnswer");
  await expect(resultLink).toBeVisible();
  await expect(resultLink).toHaveAttribute("href", /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/);
  await expect(resultLink).not.toHaveAttribute("target", "_blank");
  await expect(page.locator("#chaysaGuideNotice")).toContainText("پیش‌نویس و اعتبارسنجی");
  await resultLink.click();
  await expect(page).toHaveURL(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/);
});
