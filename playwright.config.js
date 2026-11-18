const { defineConfig } = require("@playwright/test");
const path = require("node:path");

module.exports = defineConfig({
  testDir: "./test/browser",
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 }
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:4173/api/health",
    timeout: 30000,
    reuseExistingServer: false,
    env: {
      PORT: "4173",
      DATA_DIR: "/tmp/chaysa-health-playwright-data",
      ADMIN_PASSWORD: "chaysa-playwright-admin-password",
      NODE_OPTIONS: "--require=" + path.join(__dirname, "test/mock-telegram-fetch.js")
    }
  }
});
