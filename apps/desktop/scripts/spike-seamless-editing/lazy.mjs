// lazy.mjs -- SPIKE: load+eval and first-mount time of the editor built as a bundle of its own (field-editor.js under /tmp/lazy). Same scratch `puppeteer-core`.

import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
for (const rate of [1, 4]) {
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const page = await browser.newPage();
    const client = await page.createCDPSession();
    await client.send("Emulation.setCPUThrottlingRate", { rate });
    await page.goto("file:///tmp/lazy/index.html");
    await page.evaluate((i) => load(i), i);
    await page.waitForFunction(() => window.results.length === 1);
    runs.push(await page.evaluate(() => window.results[0]));
    await page.close();
  }
  console.log(`cpu ${rate}x`, JSON.stringify(runs));
}
await browser.close();
