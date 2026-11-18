const { test, expect } = require("@playwright/test");

test("CHAYSA HEALTH research library renders correctly on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/health-advisor.html");

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
  await card.getByRole("button", { name: "ذخیره پرونده پژوهشی" }).click();

  card = page.locator("#healthResearchItems article").filter({ hasText: item.sku }).first();
  await expect(card.locator("textarea").last()).toHaveValue(/PubMed candidate title for integration test/);
});
