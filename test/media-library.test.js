const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { readFileSync } = require("node:fs");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");
const run = promisify(execFile);

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("media library authenticates, compresses image/audio/video, lists and deletes", { timeout: 180000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chaysa-media-test-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  const port = await freePort();
  const password = "test-admin-password-only";
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PASSWORD: password,
      TELEGRAM_BOT_TOKEN: "", RUBIKA_BOT_TOKEN: "", CHAYSA_OWNER_CHAT_ID: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  let peakRssKb = 0, peakCpuPercent = 0;
  const resourceSampler = setInterval(async () => {
    try {
      const { stdout } = await run("ps", ["-eo", "pid=,ppid=,rss=,pcpu="]);
      let rss = 0, cpu = 0;
      for (const line of stdout.trim().split("\n")) {
        const values = line.trim().split(/\s+/).map(Number);
        if (values.length === 4 && (values[0] === child.pid || values[1] === child.pid)) { rss += values[2]; cpu += values[3]; }
      }
      peakRssKb = Math.max(peakRssKb, rss); peakCpuPercent = Math.max(peakCpuPercent, cpu);
    } catch (_) {}
  }, 100);
  child.stdout.on("data", chunk => { logs += chunk.toString(); });
  child.stderr.on("data", chunk => { logs += chunk.toString(); });
  const base = "http://127.0.0.1:" + port;
  async function waitReady() {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("server exited: " + logs);
      try { const response = await fetch(base + "/api/health"); if (response.ok) return; } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("server did not become ready: " + logs);
  }
  try {
    await waitReady();
    const denied = await fetch(base + "/api/admin/media");
    assert.equal(denied.status, 401, "media API must reject unauthenticated requests");
    const login = await fetch(base + "/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    assert.equal(login.status, 200, "test admin login should succeed");
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "admin session cookie should be returned");
    const headers = { cookie };

    const imagePath = path.join(root, "source.png");
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#aabbcc" } })
      .png({ compressionLevel: 0 }).toFile(imagePath);
    const audioPath = path.join(root, "source.wav");
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", audioPath]);
    const videoPath = path.join(root, "source.mpg");
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "3", "-c:v", "mpeg2video", "-b:v", "8M", videoPath]);

    const cases = [
      { file: imagePath, name: "test.png", mime: "image/png", kind: "image", outputMime: "image/webp" },
      { file: audioPath, name: "test.wav", mime: "audio/wav", kind: "audio", outputMime: "audio/mpeg" },
      { file: videoPath, name: "test.mpg", mime: "video/mp4", kind: "video", outputMime: "video/mp4" }
    ];
    const uploaded = [];
    for (const item of cases) {
      const bytes = fs.readFileSync(item.file);
      const form = new FormData();
      form.append("media", new Blob([bytes], { type: item.mime }), item.name);
      const response = await fetch(base + "/api/admin/media", { method: "POST", headers, body: form });
      const result = await response.json();
      assert.equal(response.status, 201, item.kind + " upload failed: " + JSON.stringify(result));
      assert.equal(result.kind, item.kind);
      assert.equal(result.mime, item.outputMime);
      assert.ok(result.size > 0 && result.size < result.originalSize, item.kind + " output should be smaller");
      const stored = path.join(dataDir, "media", path.basename(result.url));
      assert.ok(fs.existsSync(stored), item.kind + " output should exist in persistent media directory");
      uploaded.push(result.id);
    }

    const listed = await fetch(base + "/api/admin/media", { headers });
    assert.equal(listed.status, 200);
    const rows = await listed.json();
    assert.equal(rows.length, 3);
    for (const id of uploaded) {
      const response = await fetch(base + "/api/admin/media/" + id, { method: "DELETE", headers });
      assert.equal(response.status, 200);
    }
    const after = await (await fetch(base + "/api/admin/media", { headers })).json();
    assert.equal(after.length, 0);
    const adminHtml = readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
    const libraryHtml = readFileSync(path.join(__dirname, "..", "media-library.html"), "utf8");
    assert.match(adminHtml, /chooseProductMedia/);
    assert.match(adminHtml, /chaysa-media-selected/);
    assert.match(libraryHtml, /انتخاب برای محصول/);
    assert.ok(peakRssKb > 0, "resource sampler should observe server/ffmpeg process RSS");
    console.log("MEDIA_RESOURCE_METRICS " + JSON.stringify({ peakRssKb, peakCpuPercent }));
  } finally {
    clearInterval(resourceSampler);
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
