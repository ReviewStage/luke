// Records the sneak-peek page frame by frame under CDP virtual time, so the
// capture is deterministic no matter how fast the sandbox renders.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, "frames");
const FPS = 30;

const probeOnly = process.argv.includes("--probe");

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// Deterministic capture needs BeginFrame control, which only the old headless
// implementation exposes: npx @puppeteer/browsers install chrome-headless-shell@stable
const shell = process.env.CHROME_SHELL;
if (!shell) {
  throw new Error(
    "Set CHROME_SHELL to a chrome-headless-shell binary " +
      "(npx @puppeteer/browsers install chrome-headless-shell@stable)",
  );
}

const browser = await puppeteer.launch({
  executablePath: shell,
  protocolTimeout: 300000,
  args: [
    "--no-sandbox",
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--disable-lcd-text",
    // Deterministic rendering: the compositor draws only when beginFrame asks.
    "--enable-begin-frame-control",
    "--run-all-compositor-stages-before-draw",
    "--disable-new-content-rendering-timeout",
    "--disable-threaded-animation",
    "--disable-threaded-scrolling",
    "--disable-checker-imaging",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`file://${join(here, "index.html")}?capture`, { waitUntil: "networkidle0" });

const client = await page.createCDPSession();
await client.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
await page.evaluate(() => window.__start());

const durationMs = await page.evaluate(() => window.__DURATION_MS);
const frameCount = probeOnly ? 1 : Math.round((durationMs / 1000) * FPS);
const budget = 1000 / FPS;

async function advance(ms) {
  await Promise.all([
    new Promise((resolve) => client.once("Emulation.virtualTimeBudgetExpired", resolve)),
    client.send("Emulation.setVirtualTimePolicy", {
      policy: "pauseIfNetworkFetchesPending",
      budget: ms,
    }),
  ]);
}

async function captureFrame(path) {
  const { screenshotData } = await client.send("HeadlessExperimental.beginFrame", {
    screenshot: { format: "png" },
  });
  writeFileSync(path, Buffer.from(screenshotData, "base64"));
}

if (probeOnly) {
  // Sanity pass: grab widely spaced frames to confirm virtual time drives the CSS.
  const probes = [0, 1000, 2600, 5000, 8000, 12000, 17500, 21500, 25000];
  let elapsed = 0;
  for (const at of probes) {
    if (at > elapsed) {
      await advance(at - elapsed);
      elapsed = at;
    }
    await captureFrame(join(framesDir, `probe-${String(at).padStart(5, "0")}.png`));
  }
} else {
  for (let frame = 0; frame < frameCount; frame++) {
    await advance(budget);
    await captureFrame(join(framesDir, `frame-${String(frame).padStart(4, "0")}.png`));
    if (frame % 90 === 0) console.log(`frame ${frame}/${frameCount}`);
  }
}

await browser.close();
console.log("done");
