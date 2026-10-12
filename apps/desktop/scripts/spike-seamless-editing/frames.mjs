// frames.mjs -- SPIKE: the dark-mode demo frames in the spike doc. Same scratch `puppeteer-core`; reads /tmp/demo-pm and /tmp/demo-today built by measure.mjs.

import puppeteer from "puppeteer-core";

const out = "/home/vercel-sandbox/luke/.context/spike/frames";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});

async function open(dir, query = "") {
  const page = await browser.newPage();
  await page.setViewport({ width: 760, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(`file://${dir}/index.html${query}`);
  await page.waitForSelector(".plan-body");
  await sleep(300);
  return page;
}
async function pointAt(page, needle, unitText = needle, scroll = true) {
  return page.evaluate(
    (needle, unitText, scroll) => {
      const units = [
        ...document.querySelectorAll(".plan-unit-editable, .plan-assumptions, .plan-field-editor"),
      ];
      const unit = units.find((u) => u.textContent.includes(unitText)) ?? document.body;
      const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent.includes(needle)) text = walker.nextNode();
      if (scroll) text.parentElement.scrollIntoView({ block: "center" });
      const at = text.textContent.indexOf(needle);
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      const r = range.getBoundingClientRect();
      return { x: r.left + 1, y: r.top + r.height / 2 };
    },
    needle,
    unitText,
    scroll,
  );
}
const CLIP = { x: 0, y: 0, width: 760, height: 520 };
let n = 0;
const frame = (page, name) =>
  page.screenshot({ path: `${out}/${String(n++).padStart(2, "0")}-${name}.png`, clip: CLIP });

// Today, for contrast: the click opens a bordered box of raw Markdown, caret at the start.
{
  const page = await open("/tmp/demo-today");
  const p = await pointAt(page, "members wait", "Only an admin", false);
  await page.mouse.move(p.x, p.y);
  await sleep(250);
  await page.screenshot({ path: `${out}/today-hover.png`, clip: CLIP });
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  await page.screenshot({ path: `${out}/today-editing.png`, clip: CLIP });
  await page.close();
}

// The spike: hover, click (caret where the pointer was), type with a shortcut, Esc.
{
  const page = await open("/tmp/demo-pm");
  await frame(page, "read");
  const p = await pointAt(page, "members wait", "Only an admin", false);
  await page.mouse.move(p.x, p.y);
  await sleep(250);
  await frame(page, "hover");
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  await frame(page, "click");
  for (const chunk of ["**", "oft", "en*", "*", " "]) {
    await page.keyboard.type(chunk);
    await sleep(120);
    await frame(page, "type");
  }
  await page.keyboard.press("Escape");
  await sleep(1500);
  await page.mouse.move(5, 880);
  await sleep(300);
  await frame(page, "saved");
  await page.close();
}

// A rule: click into When, type, Enter walks to Then, Enter again adds an example.
{
  const page = await open("/tmp/demo-pm");
  const p = await pointAt(page, "opens the link", "Any member may invite");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  await page.keyboard.type(" from the email");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("An admin invites a guest");
  await sleep(200);
  const box = await page.evaluate(() => {
    const r = document.querySelector(".plan-field-editor").getBoundingClientRect();
    return { x: 0, y: Math.max(0, r.top - 80), width: 760, height: r.height + 160 };
  });
  await page.screenshot({ path: `${out}/rule-editing.png`, clip: box });
  await page.close();
}

// Luke rewrites the section being edited: the conflict choice under the editor.
{
  const page = await open("/tmp/demo-pm");
  const p = await pointAt(page, "Why: removal", "Model an invite");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.type(" Agreed on the call.");
  await sleep(1300);
  await page.evaluate(() =>
    window.spike.lukeWrites(
      "decisions",
      "Model an invite as its own `invitations` table after all.",
    ),
  );
  await page.keyboard.type(" More.");
  await sleep(1600);
  const box = await page.evaluate(() => {
    const r = document.querySelector(".plan-field-editor").getBoundingClientRect();
    return { x: 0, y: Math.max(0, r.top - 40), width: 760, height: r.height + 80 };
  });
  await page.screenshot({ path: `${out}/conflict.png`, clip: box });
  await page.close();
}

// The open questions: Enter makes the next question.
{
  const page = await open("/tmp/demo-pm");
  const p = await pointAt(page, "Who can withdraw");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Can an invite be resent?");
  await sleep(200);
  const box = await page.evaluate(() => {
    const r = document.querySelector(".plan-field-editor").getBoundingClientRect();
    return { x: 0, y: Math.max(0, r.top - 30), width: 760, height: r.height + 60 };
  });
  await page.screenshot({ path: `${out}/list-editing.png`, clip: box });
  await page.close();
}
await browser.close();
