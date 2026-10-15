// shoot.mjs -- screenshots scenes through one headless Chrome over the DevTools protocol.
//
// Usage: node shoot.mjs <jobs.json | scene:variant:theme:WxH ...>
// Each job writes shots/<scene>--<variant>--<theme>.png; console errors are printed.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 9333;
const chrome = spawn(
  "google-chrome",
  ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((each) => each.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("chrome never answered");
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  } else if (msg.method === "Runtime.exceptionThrown") {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Runtime.enable");
await send("Page.enable");

const jobs = process.argv.slice(2).map((arg) => {
  const [scene, variant, theme, size] = arg.split(":");
  const [w, h] = (size ?? "1280x820").split("x").map(Number);
  return { scene, variant, theme, w, h };
});
await fs.mkdir(path.join(here, "shots"), { recursive: true });
for (const job of jobs) {
  errors.length = 0;
  await send("Emulation.setDeviceMetricsOverride", { width: job.w, height: job.h, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://localhost:4747/scene.html?s=${job.scene}&v=${job.variant}&t=${job.theme}` });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await sleep(100);
    const answer = await send("Runtime.evaluate", { expression: "document.body?.dataset.ready === 'true'", returnByValue: true });
    ready = answer.result?.result?.value === true;
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(here, "shots", `${job.scene}--${job.variant}--${job.theme}.png`);
  await fs.writeFile(file, Buffer.from(shot.result.data, "base64"));
  const noisy = errors.filter((e) => !/Not in the show|act refused/i.test(e));
  console.log(`${ready ? "ok " : "NOT READY"} ${path.basename(file)}${noisy.length ? `\n  ! ${noisy.slice(0, 4).join("\n  ! ").slice(0, 1500)}` : ""}`);
}
ws.close();
chrome.kill();
