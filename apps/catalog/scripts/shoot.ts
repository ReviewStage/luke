import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(APP_ROOT, "../..");
const DEFAULT_OUT = path.join(REPOSITORY_ROOT, "artifacts", "polish", "catalog");

const PROFILE = { DESKTOP: "desktop", WEB: "web" } as const;
const THEME = { DARK: "dark", LIGHT: "light" } as const;
const PROFILES = [PROFILE.DESKTOP, PROFILE.WEB] as const;
const THEMES = [THEME.DARK, THEME.LIGHT] as const;

const SIZE = { WIDE: "wide", PHONE: "phone" } as const;
const SIZES = [SIZE.WIDE, SIZE.PHONE] as const;
const WINDOW = { width: 1280, height: 900 } as const;
const PHONE_WIDTH = 390;

const DEFAULT_JOBS = 4;
const SETTLE_MS = 150;
const READY_TIMEOUT_MS = 10_000;
const RECORDING_WORDS = "Recording a stand-in video";

const STILL_MOTION_CSS = `
:root, body {
  --ui-duration-shape: 0s !important;
  --ui-duration-exit: 0s !important;
  --ui-duration-quick: 0s !important;
  --ui-duration-fast: 0s !important;
  --ui-duration-hover: 0s !important;
  --ui-duration-pane: 0s !important;
  --ui-row-stagger: 0s !important;
  --ui-late-delay: 0s !important;
  --ui-hint-delay: 0s !important;
  --ui-settle-delay: 0s !important;
  --ui-confirm-delay: 0s !important;
  --ui-flash-delay: 0s !important;
  --ui-loop-motion: paused !important;
  --ui-wait-motion: paused !important;
  --ui-scroll-glide: auto !important;
}`;

const STILL_MOTION_SCRIPT = `
(() => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(STILL_MOTION_CSS)};
  const lay = () => document.documentElement.append(style);
  if (document.documentElement) lay();
  else new MutationObserver((_, observer) => { if (document.documentElement) { observer.disconnect(); lay(); } }).observe(document, { childList: true });
})();`;

interface ExampleEntry {
  readonly id: string;
  readonly title: string;
}

interface Shot {
  readonly example: ExampleEntry;
  readonly profile: (typeof PROFILES)[number];
  readonly theme: (typeof THEMES)[number];
  readonly size: (typeof SIZES)[number];
}

interface ShotResult {
  readonly shot: Shot;
  readonly file: string;
  readonly problems: readonly string[];
}

interface PlaywrightPage {
  goto(url: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<unknown>;
  waitForFunction(script: string, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<Result>(script: string): Promise<Result>;
  on(event: "pageerror", listener: (value: never) => void): void;
  locator(selector: string): {
    screenshot(options: Record<string, unknown>): Promise<unknown>;
  };
  close(): Promise<void>;
}
interface PlaywrightContext {
  addInitScript(script: string): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
}
interface PlaywrightBrowser {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(): Promise<PlaywrightBrowser> };
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function loadPlaywright(): Playwright {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright") as Playwright;
  } catch {
    const root = spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim();
    try {
      return require(path.join(root, "playwright")) as Playwright;
    } catch {
      throw new Error(
        "Playwright is not installed: run `npm install -g playwright && playwright install chromium`",
      );
    }
  }
}

async function serveBuild(
  outDir: string,
): Promise<{ readonly base: string; readonly stop: () => Promise<void> }> {
  const { build, preview } = await import("vite");
  await build({ root: APP_ROOT, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  const server = await preview({
    root: APP_ROOT,
    logLevel: "warn",
    build: { outDir },
    preview: { port: 0, host: "127.0.0.1", open: false },
  });
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error("The catalog's preview server did not say its address");
  return { base, stop: () => server.close() };
}

function addressOf(base: string, shot: Shot): string {
  const params = new URLSearchParams({
    example: shot.example.id,
    profile: shot.profile,
    theme: shot.theme,
  });
  if (shot.size === SIZE.PHONE) params.set("width", String(PHONE_WIDTH));
  return new URL(`?${params.toString()}`, base).toString();
}

async function listExamples(
  browser: PlaywrightBrowser,
  base: string,
): Promise<readonly ExampleEntry[]> {
  const context = await browser.newContext({ viewport: WINDOW });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector(".catalog-index a");
  const entries = await page.evaluate<ExampleEntry[]>(`
    [...document.querySelectorAll(".catalog-index a")].map((link) => ({
      id: new URLSearchParams(link.getAttribute("href")).get("example"),
      title: link.textContent.trim(),
    }))`);
  await page.close();
  return entries;
}

async function shootOne(
  page: PlaywrightPage,
  base: string,
  shot: Shot,
  file: string,
  problems: string[],
): Promise<void> {
  await page.goto(addressOf(base, shot));
  await page.waitForSelector(".catalog-example h1");
  await page.evaluate("document.fonts.ready.then(() => true)");
  try {
    await page.waitForFunction(
      `!document.querySelector(".catalog-example").textContent.includes(${JSON.stringify(RECORDING_WORDS)})`,
      undefined,
      { timeout: READY_TIMEOUT_MS },
    );
  } catch {
    problems.push("still recording its stand-in when shot");
  }
  await page.waitForTimeout(SETTLE_MS);
  await page.locator(".catalog-example").screenshot({
    path: file,
    animations: "disabled",
    caret: "hide",
  });
  if (problems.length > 0) say(`${shot.example.id}: ${problems.join("; ")}`);
}

function indexPage(results: readonly ShotResult[], examples: readonly ExampleEntry[]): string {
  const rows = examples.map((example) => {
    const mine = results.filter((result) => result.shot.example.id === example.id);
    const cells = mine
      .map(
        ({ shot, file, problems }) =>
          `<figure><a href="${file}"><img loading="lazy" src="${file}" alt=""></a>` +
          `<figcaption>${shot.profile} · ${shot.theme} · ${shot.size}` +
          (problems.length > 0 ? ` <b>${problems.length} problem(s)</b>` : "") +
          `</figcaption></figure>`,
      )
      .join("");
    return `<section id="${example.id}"><h2>${example.title}</h2><div class="grid">${cells}</div></section>`;
  });
  const toc = examples.map((example) => `<a href="#${example.id}">${example.title}</a>`).join(" ");
  return `<!doctype html><meta charset="utf-8"><title>Catalog shots</title>
<style>
body{font:14px system-ui;margin:24px;background:#fff;color:#111}
nav{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
figure{margin:0}img{width:100%;border:1px solid #ccc}figcaption{color:#555;font-size:12px}
</style>
<h1>Catalog shots</h1><nav>${toc}</nav>${rows.join("")}`;
}

async function work(
  contexts: Readonly<Record<(typeof SIZES)[number], PlaywrightContext>>,
  base: string,
  outDir: string,
  queue: Shot[],
  results: ShotResult[],
): Promise<void> {
  const pages = {
    [SIZE.WIDE]: await contexts[SIZE.WIDE].newPage(),
    [SIZE.PHONE]: await contexts[SIZE.PHONE].newPage(),
  };
  const problems: string[] = [];
  for (const page of Object.values(pages)) {
    page.on("pageerror", (error: { message: string }) => problems.push(error.message));
  }
  for (let shot = queue.shift(); shot !== undefined; shot = queue.shift()) {
    problems.length = 0;
    const file = path.join(shot.example.id, `${shot.profile}.${shot.theme}.${shot.size}.png`);
    mkdirSync(path.join(outDir, shot.example.id), { recursive: true });
    await shootOne(pages[shot.size], base, shot, path.join(outDir, file), problems);
    results.push({ shot, file, problems: [...problems] });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: DEFAULT_OUT },
      base: { type: "string" },
      example: { type: "string", multiple: true },
      jobs: { type: "string", default: String(DEFAULT_JOBS) },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    say(
      "usage: shoot.ts [--out <dir>] [--base <url of a running catalog>] [--example <id>]... [--jobs <n>]",
    );
    return;
  }
  const outDir = path.resolve(values.out);
  const jobs = Math.max(1, Number(values.jobs) || DEFAULT_JOBS);
  const buildDir = mkdtempSync(path.join(tmpdir(), "catalog-"));
  let served: Awaited<ReturnType<typeof serveBuild>> | undefined;
  let browser: PlaywrightBrowser | undefined;
  try {
    const playwright = loadPlaywright();
    served = values.base === undefined ? await serveBuild(buildDir) : undefined;
    const base = values.base ?? served?.base ?? "";
    browser = await playwright.chromium.launch();
    const listed = await listExamples(browser, base);
    const wanted = values.example;
    const examples = wanted === undefined ? listed : listed.filter(({ id }) => wanted.includes(id));
    if (examples.length === 0) throw new Error("No example matches");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const contexts = {
      [SIZE.WIDE]: await browser.newContext({ viewport: WINDOW }),
      [SIZE.PHONE]: await browser.newContext({ viewport: WINDOW, hasTouch: true }),
    };
    for (const context of Object.values(contexts)) {
      await context.addInitScript(STILL_MOTION_SCRIPT);
    }
    const queue = examples.flatMap((example) =>
      PROFILES.flatMap((profile) =>
        THEMES.flatMap((theme) => SIZES.map((size) => ({ example, profile, theme, size }))),
      ),
    );
    const order = [...queue];
    const results: ShotResult[] = [];
    await Promise.all(
      Array.from({ length: jobs }, () => work(contexts, base, outDir, queue, results)),
    );
    const queued = order.flatMap((shot) => results.filter((result) => result.shot === shot));
    writeFileSync(path.join(outDir, "index.html"), indexPage(queued, examples));
    const flagged = results.filter((result) => result.problems.length > 0).length;
    say(`${order.length} shots of ${examples.length} examples in ${outDir}/index.html`);
    if (flagged > 0) say(`${flagged} shot(s) logged a page error`);
  } finally {
    await browser?.close();
    await served?.stop();
    rmSync(buildDir, { recursive: true, force: true });
  }
}

await main();
