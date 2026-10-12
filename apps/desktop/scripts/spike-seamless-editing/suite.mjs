// suite.mjs -- SPIKE: the headless-Chrome behaviour suite over the demo page: caret, shortcuts, rules, lists, undo, paste, IME, live drafts, conflict, latency, accessibility, fidelity, replay.
// Run beside a scratch `npm i puppeteer-core` (not a dependency; copy the script next to it): node suite.mjs <demo-dir> <today|pm|tiptap|lexical|ce> <out-dir>

import fs from "node:fs";
import puppeteer from "puppeteer-core";

const [dir, mode, out] = process.argv.slice(2);
const results = { mode };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const editorParam = mode === "today" || mode === "pm" ? "" : `editor=${mode}`;

async function open(extra = "") {
  const page = await browser.newPage();
  await page.setViewport({ width: 860, height: 980, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => {
    results.errors = [...(results.errors ?? []), e.message];
  });
  const q = [editorParam, extra].filter(Boolean).join("&");
  await page.goto(`file://${dir}/index.html${q ? `?${q}` : ""}`);
  await page.waitForSelector(".plan-body");
  await sleep(300);
  return page;
}

/** The centre of the first character of `needle` inside the unit whose text includes `unitText`. */
async function pointAt(page, needle, unitText = needle) {
  return page.evaluate(
    (needle, unitText) => {
      const units = [...document.querySelectorAll(".plan-unit-editable, .plan-assumptions")];
      const unit = units.find((u) => u.textContent.includes(unitText)) ?? document.body;
      const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent.includes(needle)) text = walker.nextNode();
      if (!text) return null;
      text.parentElement.scrollIntoView({ block: "center" });
      const at = text.textContent.indexOf(needle);
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      const r = range.getBoundingClientRect();
      return { x: r.left + 1, y: r.top + r.height / 2 };
    },
    needle,
    unitText,
  );
}
const stored = (page) => page.evaluate(() => window.spike.content());
const editorText = (page) =>
  page.evaluate(() => {
    const e = document.querySelector(".plan-field-editor");
    if (!e) return null;
    const input = e.querySelector("textarea, input");
    return input ? input.value : e.innerText;
  });
const shot = (page, name) => page.screenshot({ path: `${out}/${mode}-${name}.png` });

// A. Text field: click mid-paragraph, type with a Markdown shortcut, Esc.
{
  const page = await open();
  await shot(page, "a1-read");
  const p = await pointAt(page, "members wait", "Only an admin");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await shot(page, "a2-click");
  await page.keyboard.type("**often** ");
  await sleep(150);
  await shot(page, "a3-typed");
  await page.keyboard.press("Escape");
  await sleep(1500);
  results.textEdit = (await stored(page)).fields.goal.problem;
  await shot(page, "a4-closed");
  await page.close();
}

// B. Rule: click into the first example's When, type, Enter twice for a new example, type a Given.
{
  const page = await open();
  const p = await pointAt(page, "opens the link", "Any member may invite");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  await page.keyboard.type(" from email");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("An admin invites a guest");
  await sleep(150);
  await shot(page, "b1-rule");
  await page.keyboard.press("Escape");
  await sleep(1500);
  results.ruleEdit = (await stored(page)).fields.rules[0];
  await page.close();
}

// C. A list: click the question, End, Enter, type a new one.
{
  const page = await open();
  const p = await pointAt(page, "Who can withdraw");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Can an invite be resent?");
  await sleep(150);
  await shot(page, "c1-list");
  await page.keyboard.press("Escape");
  await sleep(1500);
  results.listEdit = (await stored(page)).fields.openQuestions;
  await page.close();
}

// D. Undo and redo.
{
  const page = await open();
  const p = await pointAt(page, "teammate joins", "A member invites a teammate");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  const before = await editorText(page);
  await page.keyboard.type("xyz");
  await sleep(50);
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await sleep(100);
  const undone = await editorText(page);
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("z");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(100);
  const redone = await editorText(page);
  results.undo = {
    undoRestores: undone === before,
    redoReapplies: redone !== before && (redone ?? "").includes("xyz"),
  };
  await page.close();
}

// E. Paste a web page's HTML: a heading, bold, a table.
{
  const page = await open();
  const p = await pointAt(page, "teammate joins", "A member invites a teammate");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData(
      "text/html",
      '<h1 style="color:red">Pasted heading</h1><p>with <b>bold</b> and <span style="font-size:30px">big</span></p><table><tr><td>a</td><td>b</td></tr></table>',
    );
    dt.setData("text/plain", "Pasted heading\nwith bold and big\na b");
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await sleep(150);
  await shot(page, "e1-paste");
  await page.keyboard.press("Escape");
  await sleep(1500);
  results.paste = (await stored(page)).fields.goal.outcome;
  await page.close();
}

// F. IME: compose 日本語 through the input method, then commit.
{
  const page = await open();
  const client = await page.createCDPSession();
  const p = await pointAt(page, "teammate joins", "A member invites a teammate");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  for (const step of ["に", "にほ", "にほん", "日本"]) {
    await client.send("Input.imeSetComposition", {
      text: step,
      selectionStart: step.length,
      selectionEnd: step.length,
    });
    await sleep(40);
  }
  await client.send("Input.insertText", { text: "日本" });
  await sleep(100);
  await page.keyboard.press("Escape");
  await sleep(1500);
  results.ime = (await stored(page)).fields.goal.outcome;
  await page.close();
}

// G. Luke writes while the developer edits: live drafts into another field, then a save into the same one.
{
  const page = await open();
  const p = await pointAt(page, "Why: removal", "Model an invite");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.type(" Agreed on the call.");
  const words = "Run the invite flow end to end on staging with two accounts".split(" ");
  for (let i = 1; i <= words.length; i += 1) {
    await page.evaluate(
      (t) => window.spike.lukeDraft("verification", t),
      words.slice(0, i).join(" "),
    );
    await sleep(60);
  }
  await page.keyboard.type(" Keep it.");
  await sleep(1300);
  const held = await editorText(page);
  results.liveDraftHold = {
    editorStillHoldsTyping: (held ?? "").includes("Agreed on the call. Keep it."),
    focusInEditor: await page.evaluate(
      () => !!document.activeElement?.closest(".plan-field-editor"),
    ),
  };
  // Luke rewrites the line being edited, then the developer types on: a conflict.
  await page.evaluate(() =>
    window.spike.lukeWrites(
      "decisions",
      "Model an invite as its own `invitations` table after all.",
    ),
  );
  await page.keyboard.type(" More.");
  await sleep(1600);
  await shot(page, "g1-conflict");
  results.conflictShown = await page.evaluate(
    () => document.querySelector(".plan-field-note[role=alert]")?.textContent ?? null,
  );
  await page.close();
}

// H. Typing latency on a long plan (sixty rules, thirty-paragraph Problem, twenty-paragraph Decisions).
{
  const page = await open("long=1");
  const p = await pointAt(page, "The invite flow", "Model an invite");
  await page.mouse.click(p.x, p.y);
  await sleep(300);
  await page.evaluate(() => {
    window.__lat = [];
    document.addEventListener(
      "keydown",
      () => {
        const t0 = performance.now();
        const channel = new MessageChannel();
        channel.port1.onmessage = () => window.__lat.push(performance.now() - t0);
        requestAnimationFrame(() => channel.port2.postMessage(0));
      },
      true,
    );
  });
  const run = async () => {
    await page.evaluate(() => {
      window.__lat = [];
    });
    await page.keyboard.type("the quick brown fox jumps over the lazy dog ".repeat(3), {
      delay: 35,
    });
    await sleep(200);
    const lat = (await page.evaluate(() => window.__lat)).sort((a, b) => a - b);
    const pick = (q) =>
      Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] * 10) / 10;
    return {
      n: lat.length,
      p50: pick(0.5),
      p95: pick(0.95),
      max: Math.round(lat.at(-1) * 10) / 10,
    };
  };
  results.latency1x = await run();
  const client = await page.createCDPSession();
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  results.latency4x = await run();
  await page.close();
}

// I. Accessibility: what the editor is to a screen reader.
{
  const page = await open();
  const p = await pointAt(page, "teammate joins", "A member invites a teammate");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  const handle = await page.evaluateHandle(() => document.activeElement);
  const snap = await page.accessibility.snapshot({ root: handle, interestingOnly: false });
  results.a11y = snap
    ? {
        tag: await page.evaluate((e) => `${e.tagName}.${e.className}`, handle),
        role: snap.role,
        name: snap.name,
        multiline: snap.multiline ?? null,
      }
    : null;
  await page.close();
}

// J. Fidelity: a field written in Markdown's other spellings, one character added at its end; which lines changed?
{
  const page = await open();
  const original =
    "* one\n* two\n\n_em_ and __strong__ words,\nsoft wrapped onto a second line.\n\n1) first\n2) second\n\nA \\*literal\\* star and a [link][ref].\n\n[ref]: https://example.com";
  await page.evaluate((t) => window.spike.lukeWrites("verification", t), original);
  await sleep(5000);
  const p = await pointAt(page, "second", "soft wrapped");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await sleep(1500);
  const saved = (await stored(page)).fields.verification ?? "";
  const before = original.split("\n");
  const after = saved.split("\n");
  results.fidelity = {
    saved,
    linesChanged: after.filter((line) => !before.includes(line)).length,
    linesLost: before.filter((line) => !after.includes(line)).length,
  };
  await page.close();
}

// L. Opening a field and leaving it without typing saves nothing, for every field kind.
{
  const page = await open();
  const before = JSON.stringify(await stored(page));
  for (const [needle, unit] of [
    ["members wait", "Only an admin"],
    ["Inviting by email", "Inviting by email"],
    ["opens the link", "Any member may invite"],
    ["Who can withdraw", "Who can withdraw"],
    ["7 days", "7 days"],
    ["invite(by", "invite(by"],
  ]) {
    const p = await pointAt(page, needle, unit);
    if (p === null) continue;
    await page.mouse.click(p.x, p.y);
    await sleep(250);
    await page.keyboard.press("Escape");
    await sleep(1300);
  }
  results.openCloseSavesNothing = JSON.stringify(await stored(page)) === before;
  await page.close();
}

// M. Layout shift: how far a field's words move when its editor opens, for every field kind.
{
  const shifts = {};
  for (const [name, needle] of [
    ["text", "members wait"],
    ["bullets", "Inviting by email"],
    ["heading", "Rejected"],
    ["code", "Effect"],
    ["numbered", "Invite a teammate from"],
    ["questions", "Who can withdraw"],
    ["assumptions", "7 days"],
    ["rule", "opens the link"],
  ]) {
    const page = await open();
    const at = () =>
      page.evaluate((needle) => {
        const walker = document.createTreeWalker(
          document.querySelector(".plan-document-scroll"),
          NodeFilter.SHOW_TEXT,
        );
        let text = walker.nextNode();
        while (text && !text.textContent.includes(needle)) text = walker.nextNode();
        if (!text) return null;
        const range = document.createRange();
        const from = text.textContent.indexOf(needle);
        range.setStart(text, from);
        range.setEnd(text, from + 1);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top };
      }, needle);
    await page.evaluate((needle) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent.includes(needle)) text = walker.nextNode();
      text?.parentElement.scrollIntoView({ block: "center" });
    }, needle);
    const before = await at();
    if (before === null) continue;
    await page.mouse.click(before.x + 2, before.y + 5);
    await sleep(300);
    const after = await at();
    shifts[name] =
      after === null
        ? null
        : Math.round(Math.hypot(after.x - before.x, after.y - before.y) * 10) / 10;
    await page.close();
  }
  results.layoutShiftPx = shifts;
}

// N. The keyboard, as Notion's: one Tab stop into the document, the arrows between blocks, Return to edit, Esc back to the block.
{
  const page = await open();
  const label = () =>
    page.evaluate(
      () =>
        document.activeElement?.closest(".plan-unit-editable")?.getAttribute("aria-label") ??
        document.activeElement?.tagName ??
        null,
    );
  await page.evaluate(() => document.body.focus());
  let entered = null;
  for (let i = 0; i < 20 && entered === null; i += 1) {
    await page.keyboard.press("Tab");
    entered = await page.evaluate(() =>
      document.activeElement?.classList.contains("plan-unit-editable")
        ? document.activeElement.getAttribute("aria-label")
        : null,
    );
  }
  await page.keyboard.press("ArrowDown");
  const down = await label();
  await page.keyboard.press("ArrowUp");
  const up = await label();
  await page.keyboard.press("Tab");
  const leftDocument = await page.evaluate(
    () => !document.activeElement?.classList.contains("plan-unit-editable"),
  );
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  const back = await label();
  await page.keyboard.press("Enter");
  await sleep(300);
  const editing = await page.evaluate(
    () => !!document.querySelector(".plan-field-editor .ProseMirror-focused"),
  );
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  let sawSaving = false;
  for (let i = 0; i < 30; i += 1) {
    sawSaving ||= await page.evaluate(() => document.body.innerText.includes("Saving"));
    await sleep(50);
  }
  const afterEsc = await label();
  results.keyboard = {
    entered,
    down,
    up,
    leftDocument,
    back,
    editing,
    afterEsc,
    sawSaving,
    saved: (await stored(page)).fields.goal.problem?.endsWith("!") ?? false,
  };
  await page.close();
}

// K. Session replay: is every editable node inside a blocked subtree?
{
  const page = await open();
  const p = await pointAt(page, "teammate joins", "A member invites a teammate");
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  results.replayBlocked = await page.evaluate(() => {
    const editable = [...document.querySelectorAll("[contenteditable=true], textarea, input")];
    return editable.length > 0 && editable.every((e) => e.closest(".ph-no-capture") !== null);
  });
  await page.close();
}

await browser.close();
fs.writeFileSync(`${out}/${mode}-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
