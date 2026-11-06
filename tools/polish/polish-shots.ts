import { type ChildProcess, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { flattenPng, type Rgb } from "./png.ts";
import { READY_SCRIPT } from "./ready.ts";
import {
  CLIENT,
  type Client,
  drawsOn,
  PLACES,
  pressedOn,
  SCENES,
  type Scene,
  STEP,
  type Step,
} from "./scenes.ts";
import { PIN_SCROLL_FADES_SCRIPT, scrollScript } from "./scroll.ts";
import { type Frame, sizedScript } from "./viewport.ts";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DESKTOP_ROOT = path.join(REPOSITORY_ROOT, "apps", "desktop");
const WEB_ROOT = path.join(REPOSITORY_ROOT, "apps", "web");
const CATALOG_ROOT = path.join(REPOSITORY_ROOT, "apps", "catalog");
const DEFAULT_OUT = path.join(REPOSITORY_ROOT, "artifacts", "polish", "app");

const TARGET = { ...CLIENT, CATALOG: "catalog" } as const;
type Target = (typeof TARGET)[keyof typeof TARGET];
const TARGETS: readonly Target[] = Object.values(TARGET);

const THEME = { LIGHT: "light", DARK: "dark" } as const;
type Theme = (typeof THEME)[keyof typeof THEME];
const THEMES: readonly Theme[] = Object.values(THEME);

const SIZE = { WIDE: "wide", LEAST: "least", NARROW: "narrow" } as const;
type Size = (typeof SIZE)[keyof typeof SIZE];
const SIZES: readonly Size[] = Object.values(SIZE);

const WIDE_FRAME: Frame = { width: 1280, height: 840, zoom: 1, phone: false };
const LEAST_FRAME: Frame = { width: 760, height: 520, zoom: 1, phone: false };
const PHONE_FRAME: Frame = { width: 390, height: 844, zoom: 1, phone: true };
const ZOOMED_FRAME: Frame = { ...LEAST_FRAME, zoom: 1.25 };

const FRAMES: Readonly<Record<Target, Readonly<Record<Size, Frame>>>> = {
  [TARGET.DESKTOP]: { wide: WIDE_FRAME, least: LEAST_FRAME, narrow: ZOOMED_FRAME },
  [TARGET.WEB]: { wide: WIDE_FRAME, least: LEAST_FRAME, narrow: PHONE_FRAME },
  [TARGET.CATALOG]: { wide: WIDE_FRAME, least: LEAST_FRAME, narrow: PHONE_FRAME },
};

const DEFAULT_JOBS = 3;
const FIRST_LOAD_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 5_000;
const LOAD_SETTLE_MS = 1_200;
const STEP_SETTLE_MS = 400;
const STAGE_SELECTOR = ".app-stage";
const RECORDED_SCRIPT = `!document.querySelector(".catalog-example").textContent.includes("Recording a stand-in video")`;
const READING_TIMEOUT_MS = 10_000;
const PANEL_PAGE = "/index.html";
const RESIZE_TIMEOUT_MS = 5_000;
const RESIZE_TRIES = 2;
const EXIT_TIMEOUT_MS = 10_000;
const GROUND_SCRIPT = `(() => {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;width:1px;height:1px;background-color:var(--ui-color-sidebar, var(--ui-color-ground, #fff))";
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const paint = canvas.getContext("2d");
  paint.fillStyle = "#fff";
  paint.fillRect(0, 0, 1, 1);
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
  return { red, green, blue };
})()`;
const HIDE_CARET_SCRIPT = `document.head.append(Object.assign(document.createElement("style"), { textContent: "*, *::before, *::after { caret-color: transparent !important; }" }))`;

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
  --ui-loop-motion: paused !important;
  --ui-wait-motion: paused !important;
  --ui-scroll-glide: auto !important;
}`;

function stillPageScript(theme: Theme): string {
  return `
(() => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(STILL_MOTION_CSS)};
  const hold = (root) => {
    if (root.getAttribute("data-ui-theme") !== ${JSON.stringify(theme)}) root.setAttribute("data-ui-theme", ${JSON.stringify(theme)});
    if (!style.isConnected) root.append(style);
  };
  const lay = (root) => {
    hold(root);
    new MutationObserver(() => hold(root)).observe(root, { attributes: true, attributeFilter: ["data-ui-theme"] });
  };
  if (document.documentElement) lay(document.documentElement);
  else new MutationObserver((_, observer) => { if (document.documentElement) { observer.disconnect(); lay(document.documentElement); } }).observe(document, { childList: true });
})();`;
}

interface Shot {
  readonly target: Target;
  readonly scene: Scene;
  readonly theme: Theme;
  readonly size: Size;
}

interface ShotResult {
  readonly shot: Shot;
  readonly file: string;
  readonly problems: readonly string[];
}

interface PlaywrightLocator {
  first(): PlaywrightLocator;
  getByRole(role: string, options: Record<string, unknown>): PlaywrightLocator;
  click(options: Record<string, unknown>): Promise<void>;
  hover(options: Record<string, unknown>): Promise<void>;
  waitFor(options: Record<string, unknown>): Promise<void>;
  isVisible(): Promise<boolean>;
  screenshot(options: Record<string, unknown>): Promise<unknown>;
}
interface PlaywrightPage {
  url(): string;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForFunction(script: string, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
  evaluate<Result>(script: string): Promise<Result>;
  emulateMedia(options: Record<string, unknown>): Promise<void>;
  screenshot(options: Record<string, unknown>): Promise<unknown>;
  on(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "crash", listener: () => void): void;
  getByRole(role: string, options: Record<string, unknown>): PlaywrightLocator;
  getByText(text: string): PlaywrightLocator;
  locator(selector: string): PlaywrightLocator;
  keyboard: { press(keys: string): Promise<void>; type(text: string): Promise<void> };
}
interface PlaywrightContext {
  addInitScript(script: string): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightBrowser {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface PlaywrightHandle {
  evaluate<Arg, Result>(
    script: (value: never, arg: Arg) => Result,
    arg: Arg,
  ): Promise<Awaited<Result>>;
}
interface ElectronApplication {
  windows(): PlaywrightPage[];
  browserWindow(page: PlaywrightPage): Promise<PlaywrightHandle>;
  waitForEvent(event: "window", options: Record<string, unknown>): Promise<PlaywrightPage>;
  evaluate<Arg>(script: (electron: never, arg: Arg) => unknown, arg: Arg): Promise<unknown>;
  process(): ChildProcess;
}
interface Playwright {
  chromium: { launch(): Promise<PlaywrightBrowser> };
  _electron: { launch(options: Record<string, unknown>): Promise<ElectronApplication> };
}

interface Served {
  readonly base: string;
  readonly stop: () => Promise<void>;
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function firstLineOf(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
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

async function viteOf(appRoot: string): Promise<typeof import("vite")> {
  const require = createRequire(path.join(appRoot, "package.json"));
  return (await import(require.resolve("vite"))) as typeof import("vite");
}

async function serveWeb(): Promise<Served> {
  const { createServer } = await viteOf(WEB_ROOT);
  const server = await createServer({
    root: WEB_ROOT,
    logLevel: "warn",
    server: { port: 0, host: "127.0.0.1", strictPort: false, open: false },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined)
    throw new Error("The web client's development server did not say its address");
  return { base, stop: () => server.close() };
}

async function serveCatalog(outDir: string): Promise<Served> {
  const { build, preview } = await viteOf(CATALOG_ROOT);
  await build({ root: CATALOG_ROOT, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  const server = await preview({
    root: CATALOG_ROOT,
    logLevel: "warn",
    build: { outDir },
    preview: { port: 0, host: "127.0.0.1", open: false },
  });
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error("The catalog's preview server did not say its address");
  return { base, stop: () => server.close() };
}

async function catalogScenes(browser: PlaywrightBrowser, base: string): Promise<readonly Scene[]> {
  const context = await browser.newContext({ viewport: WIDE_FRAME });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector(".catalog-index a");
  const entries = await page.evaluate<{ id: string; title: string }[]>(`
    [...document.querySelectorAll(".catalog-index a")].map((link) => ({
      id: new URLSearchParams(link.getAttribute("href")).get("example"),
      title: link.textContent.trim(),
    }))`);
  await context.close();
  return entries.map(({ id, title }) => ({ id, title, place: "Catalog", profile: "" }));
}

function targetOf(
  page: PlaywrightPage,
  target: {
    role: string;
    name: string;
    exact?: boolean;
    within?: { role: string; name?: string };
  },
): PlaywrightLocator {
  const scope =
    target.within === undefined
      ? page
      : page.getByRole(target.within.role, { name: target.within.name }).first();
  return scope.getByRole(target.role, { name: target.name, exact: target.exact === true }).first();
}

async function runStep(
  page: PlaywrightPage,
  client: Client,
  step: Step,
): Promise<string | undefined> {
  const options = { timeout: STEP_TIMEOUT_MS };
  try {
    switch (step.kind) {
      case STEP.PRESS:
        await page.keyboard.press(pressedOn(step.keys, client));
        break;
      case STEP.CLICK:
        await targetOf(page, step).click(options);
        break;
      case STEP.RIGHT_CLICK:
        await targetOf(page, step).click({ ...options, button: "right" });
        break;
      case STEP.HOVER:
        await targetOf(page, step).hover(options);
        break;
      case STEP.TYPE:
        await page.keyboard.type(step.text);
        break;
      case STEP.WAIT_FOR_TEXT:
        await page.getByText(step.text).first().waitFor(options);
        break;
      case STEP.SCROLL:
        if (!(await page.evaluate<boolean>(scrollScript(step.role, step.by)))) {
          throw new Error(`No ${step.role} to scroll`);
        }
        break;
    }
    await page.waitForTimeout(STEP_SETTLE_MS);
    return undefined;
  } catch {
    return `step ${step.kind} ${JSON.stringify(step)} found nothing`;
  }
}

async function showSidebar(
  page: PlaywrightPage,
  client: Client,
  problems: string[],
): Promise<void> {
  const toggle = page.getByRole("button", { name: "Show sidebar", exact: true }).first();
  if (!(await toggle.isVisible())) return;
  const problem = await runStep(page, client, {
    kind: STEP.CLICK,
    role: "button",
    name: "Show sidebar",
  });
  if (problem !== undefined) problems.push(problem);
}

async function stageScene(
  page: PlaywrightPage,
  client: Client,
  scene: Scene,
  phone: boolean,
  problems: string[],
): Promise<void> {
  await page.waitForSelector(STAGE_SELECTOR, { timeout: READY_TIMEOUT_MS });
  await page.evaluate("document.fonts.ready.then(() => true)");
  await page.waitForTimeout(LOAD_SETTLE_MS);
  try {
    await page.waitForFunction(READY_SCRIPT, undefined, { timeout: READING_TIMEOUT_MS });
  } catch {
    problems.push("still reading when shot");
  }
  if (scene.sidebar === true && !phone) await showSidebar(page, client, problems);
  for (const step of (phone ? scene.phoneSteps : undefined) ?? scene.steps ?? []) {
    const problem = await runStep(page, client, step);
    if (problem !== undefined) problems.push(problem);
  }
}

async function desktopPage(app: ElectronApplication): Promise<PlaywrightPage> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const open = app.windows().find((page) => URL.parse(page.url())?.pathname.endsWith(PANEL_PAGE));
    if (open !== undefined) return open;
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`No ${PANEL_PAGE} window opened`);
    await app.waitForEvent("window", { timeout: left }).catch(() => undefined);
  }
}

interface DesktopLaunch {
  readonly electron: string;
  readonly worker: number;
}

async function watchDeaths(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }: never) => {
    const watched = electronApp as {
      on(event: string, listener: (...args: never[]) => void): void;
    };
    const deaths: string[] = [];
    (globalThis as { polishDeaths?: string[] }).polishDeaths = deaths;
    watched.on(
      "render-process-gone",
      (
        _event: unknown,
        contents: { getURL(): string },
        details: { reason: string; exitCode: number },
      ) =>
        deaths.push(
          `${contents.getURL().split("/").pop()} renderer went: ${details.reason} (exit ${details.exitCode})`,
        ),
    );
    watched.on(
      "child-process-gone",
      (_event: unknown, details: { type: string; reason: string; exitCode: number }) =>
        deaths.push(`${details.type} process went: ${details.reason} (exit ${details.exitCode})`),
    );
  }, undefined);
}

async function deathsOf(app: ElectronApplication): Promise<readonly string[]> {
  const deaths = await app
    .evaluate(() => (globalThis as { polishDeaths?: string[] }).polishDeaths ?? [], undefined)
    .catch(() => []);
  return deaths as string[];
}

async function exitsInTime(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return once(child, "exit", { signal: AbortSignal.timeout(EXIT_TIMEOUT_MS) }).then(
    () => true,
    () => child.exitCode !== null || child.signalCode !== null,
  );
}

async function endApp(app: ElectronApplication): Promise<boolean> {
  const child = app.process();
  const exited = exitsInTime(child);
  await app
    .evaluate(({ app: electronApp }: never) => {
      (electronApp as { exit(code: number): void }).exit(0);
    }, undefined)
    .catch(() => undefined);
  if (await exited) return true;
  const killed = exitsInTime(child);
  child.kill("SIGKILL");
  return killed;
}

function stateRootOf(instance: string): string {
  const appData =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(appData, `Vespin Dev ${instance}`);
}

async function sizeWindow(
  window: PlaywrightHandle,
  page: PlaywrightPage,
  frame: Frame,
): Promise<string | undefined> {
  for (let tries = 0; tries < RESIZE_TRIES; tries++) {
    await window.evaluate((open: never, arg: Frame) => {
      const sized = open as {
        setContentSize(width: number, height: number): void;
        webContents: { setZoomFactor(zoom: number): void };
      };
      sized.setContentSize(arg.width, arg.height);
      sized.webContents.setZoomFactor(arg.zoom);
    }, frame);
    const laid = await page
      .waitForFunction(sizedScript(frame), undefined, { timeout: RESIZE_TIMEOUT_MS })
      .then(
        () => true,
        () => false,
      );
    if (laid) return undefined;
  }
  return unsizedNote(page, frame);
}

async function unsizedNote(page: PlaywrightPage, frame: Frame): Promise<string | undefined> {
  if (await page.evaluate<boolean>(sizedScript(frame))) return undefined;
  const stood = await page.evaluate<string>('innerWidth + "×" + innerHeight');
  return `the page laid out at ${stood} CSS px, not ${frame.width}×${frame.height} at ${frame.zoom * 100}%`;
}

async function shootDesktop(
  playwright: Playwright,
  launch: DesktopLaunch,
  shot: Shot,
  file: string,
  problems: string[],
): Promise<void> {
  const frame = FRAMES[shot.target][shot.size];
  const linux = process.platform === "linux";
  const instance = `polish-${launch.worker}-${randomUUID().slice(0, 8)}`;
  const stateRoot = stateRootOf(instance);
  const forget = () => rmSync(stateRoot, { recursive: true, force: true });
  const app = await playwright._electron
    .launch({
      executablePath: launch.electron,
      args: [
        DESKTOP_ROOT,
        ...(linux ? ["--no-sandbox", "--disable-gpu"] : []),
        "--fixture",
        "smoke",
        "--profile",
        shot.scene.profile,
      ],
      env: { ...process.env, APP_INSTANCE: instance },
      timeout: READY_TIMEOUT_MS,
    })
    .catch((error: unknown) => {
      forget();
      throw error;
    });
  try {
    await watchDeaths(app);
    const page = await desktopPage(app);
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("crash", () => problems.push("the page crashed"));
    const window = await app.browserWindow(page);
    await app.evaluate(({ nativeTheme }: never, theme: Theme) => {
      (nativeTheme as { themeSource: string }).themeSource = theme;
    }, shot.theme);
    await page.emulateMedia({ colorScheme: shot.theme, reducedMotion: "reduce" });
    await page.evaluate(stillPageScript(shot.theme));
    await page.waitForSelector(STAGE_SELECTOR, { timeout: READY_TIMEOUT_MS });
    const unsized = await sizeWindow(window, page, frame);
    if (unsized !== undefined) problems.push(unsized);
    await stageScene(page, CLIENT.DESKTOP, shot.scene, shot.size === SIZE.NARROW, problems);
    const resized = unsized !== undefined ? undefined : await unsizedNote(page, frame);
    if (resized !== undefined) problems.push(`when shot, ${resized}`);
    await page.evaluate(HIDE_CARET_SCRIPT);
    const ground = await page.evaluate<Rgb>(GROUND_SCRIPT);
    const png = await window.evaluate(async (open: never) => {
      const captured = open as {
        webContents: {
          capturePage(
            rect: undefined,
            options: { stayHidden: boolean; stayAwake: boolean },
          ): Promise<{ toPNG(): { toString(encoding: string): string } }>;
        };
      };
      const image = await captured.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      return image.toPNG().toString("base64");
    }, undefined);
    writeFileSync(file, flattenPng(Buffer.from(png, "base64"), ground));
  } finally {
    problems.push(...(await deathsOf(app)));
    if (await endApp(app)) forget();
    else problems.push(`the app would not exit, so ${stateRoot} is left behind`);
  }
}

async function shootDesktopOnceMore(
  playwright: Playwright,
  launch: DesktopLaunch,
  shot: Shot,
  file: string,
  problems: string[],
): Promise<void> {
  const first: string[] = [];
  try {
    await shootDesktop(playwright, launch, shot, file, first);
    problems.push(...first);
  } catch (error) {
    const notes = first.length === 0 ? "" : ` (${first.join("; ")})`;
    problems.push(`first launch failed: ${firstLineOf(error)}${notes}`);
    await shootDesktop(playwright, launch, shot, file, problems);
  }
}

function webAddress(base: string, scene: Scene): string {
  return new URL(`app.html?${new URLSearchParams({ fixture: scene.profile })}`, base).toString();
}

function catalogAddress(base: string, shot: Shot): string {
  const params = new URLSearchParams({
    example: shot.scene.id,
    profile: "desktop",
    theme: shot.theme,
  });
  const frame = FRAMES[shot.target][shot.size];
  if (frame.phone) params.set("width", String(frame.width));
  return new URL(`?${params}`, base).toString();
}

async function shootBrowser(
  browser: PlaywrightBrowser,
  base: string,
  shot: Shot,
  file: string,
  problems: string[],
  firstLoad: boolean,
): Promise<void> {
  const frame = FRAMES[shot.target][shot.size];
  const phone = frame.phone && shot.target === TARGET.WEB;
  const viewport = frame.phone && !phone ? WIDE_FRAME : frame;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(frame.phone ? { hasTouch: true } : {}),
    ...(phone ? { isMobile: true } : {}),
    colorScheme: shot.theme,
    reducedMotion: "reduce",
  });
  try {
    await context.addInitScript(stillPageScript(shot.theme));
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(error.message));
    if (shot.target === TARGET.CATALOG) {
      await page.goto(catalogAddress(base, shot));
      await page.waitForSelector(".catalog-example h1");
      await page.evaluate("document.fonts.ready.then(() => true)");
      try {
        await page.waitForFunction(RECORDED_SCRIPT, undefined, { timeout: READING_TIMEOUT_MS });
      } catch {
        problems.push("still recording its stand-in when shot");
      }
      await page.waitForTimeout(STEP_SETTLE_MS);
      await page.evaluate(PIN_SCROLL_FADES_SCRIPT);
      await page
        .locator(".catalog-example")
        .screenshot({ path: file, animations: "disabled", caret: "hide" });
      return;
    }
    await page.goto(webAddress(base, shot.scene), {
      timeout: firstLoad ? FIRST_LOAD_TIMEOUT_MS : READY_TIMEOUT_MS,
    });
    await stageScene(page, CLIENT.WEB, shot.scene, phone, problems);
    await page.evaluate(PIN_SCROLL_FADES_SCRIPT);
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
}

function fileOf(shot: Shot): string {
  return path.join(shot.target, shot.scene.id, `${shot.theme}.${shot.size}.png`);
}

interface Drivers {
  readonly playwright: Playwright;
  readonly browser: PlaywrightBrowser | undefined;
  readonly electron: string | undefined;
  readonly bases: Partial<Record<Target, string>>;
}

async function work(
  drivers: Drivers,
  worker: number,
  outDir: string,
  queue: Shot[],
  results: ShotResult[],
): Promise<void> {
  for (let shot = queue.shift(); shot !== undefined; shot = queue.shift()) {
    const problems: string[] = [];
    const file = fileOf(shot);
    const absolute = path.join(outDir, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    try {
      if (shot.target === TARGET.DESKTOP) {
        const electron = drivers.electron ?? "";
        const launch = { electron, worker };
        await shootDesktopOnceMore(drivers.playwright, launch, shot, absolute, problems);
      } else {
        const firstLoad = results.length < 1;
        const base = drivers.bases[shot.target] ?? "";
        if (drivers.browser === undefined) throw new Error("No browser was launched");
        await shootBrowser(drivers.browser, base, shot, absolute, problems, firstLoad);
      }
    } catch (error) {
      problems.push(`not shot: ${firstLineOf(error)}`);
    }
    if (problems.length > 0)
      say(`${shot.target}/${shot.scene.id} ${shot.theme} ${shot.size}: ${problems.join("; ")}`);
    results.push({ shot, file, problems });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function figure(result: ShotResult | undefined, theme: Theme): string {
  if (result === undefined)
    return `<figure class="none"><figcaption>${theme}: not shot</figcaption></figure>`;
  const shot = result.problems.some((problem) => problem.startsWith("not shot"))
    ? `<div class="missing">not shot</div>`
    : `<a href="${result.file}"><img loading="lazy" src="${result.file}" alt=""></a>`;
  const notes = result.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("");
  return `<figure>${shot}<figcaption>${theme}${notes === "" ? "" : `<ul>${notes}</ul>`}</figcaption></figure>`;
}

function contactSheet(results: readonly ShotResult[], skipped: readonly Scene[]): string {
  const scenes = [...new Set(results.map((result) => result.shot.scene))];
  const places = [...PLACES, "Catalog"].filter((place) =>
    scenes.some((scene) => scene.place === place),
  );
  const sections = places.map((place) => {
    const blocks = scenes
      .filter((scene) => scene.place === place)
      .map((scene) => {
        const mine = results.filter((result) => result.shot.scene === scene);
        const rows = TARGETS.flatMap((target) =>
          SIZES.map((size) => {
            const pair = THEMES.map((theme) =>
              mine.find(
                ({ shot }) => shot.target === target && shot.size === size && shot.theme === theme,
              ),
            );
            if (pair.every((result) => result === undefined)) return "";
            const frame = FRAMES[target][size];
            const label = `${target} · ${size} · ${frame.width}×${frame.height}${frame.zoom === 1 ? "" : ` at ${frame.zoom * 100}%`}`;
            const cells = pair
              .map((result, index) => figure(result, THEMES[index] ?? THEME.LIGHT))
              .join("");
            return `<div class="row ${size}"><h4>${label}</h4><div class="pair">${cells}</div></div>`;
          }),
        ).join("");
        return `<article id="${escapeHtml(scene.id)}"><h3>${escapeHtml(scene.title)} <code>${escapeHtml(scene.profile)}</code></h3>${rows}</article>`;
      })
      .join("");
    return `<section id="place-${escapeHtml(place)}"><h2>${escapeHtml(place)}</h2>${blocks}</section>`;
  });
  const toc = places
    .map((place) => `<a href="#place-${escapeHtml(place)}">${escapeHtml(place)}</a>`)
    .join("");
  const skippedNote =
    skipped.length === 0
      ? ""
      : `<p class="note">Mac-only, not shot here: ${skipped.map((scene) => escapeHtml(scene.title)).join(", ")}.</p>`;
  const flattenedNote = results.some((result) => result.shot.target === TARGET.DESKTOP)
    ? `<p class="note">Desktop pictures are the whole window, flattened onto the theme's sidebar color (<code>--ui-color-sidebar</code>) as the app's own capture mode paints its frame: the Mac's frosted sidebar material is not in them.</p>`
    : "";
  const flagged = results.filter((result) => result.problems.length > 0).length;
  return `<!doctype html><meta charset="utf-8"><title>Polish capture</title>
<style>
body{font:14px system-ui;margin:24px;background:#f4f4f5;color:#111}
nav{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 24px}
section{margin-bottom:40px}h2{border-bottom:1px solid #ccc;padding-bottom:4px}
article{background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px 12px;margin:12px 0}
h3{margin:4px 0 8px}h3 code{font-size:12px;color:#666}h4{margin:8px 0 4px;font-weight:500;color:#555;font-size:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}
.row.narrow .pair{grid-template-columns:repeat(2,minmax(0,360px))}
figure{margin:0}img{width:100%;border:1px solid #ccc;display:block}figcaption{color:#555;font-size:12px}
figcaption ul{color:#a33;margin:2px 0;padding-left:16px}.missing{padding:24px;border:1px dashed #a33;color:#a33}
.note{color:#555}
</style>
<h1>Polish capture</h1><p class="note">${results.length} pictures of ${scenes.length} scenes; ${flagged} with a note.</p>${flattenedNote}${skippedNote}<nav>${toc}</nav>${sections.join("")}`;
}

function wantedTargets(named: readonly string[] | undefined): readonly Target[] {
  if (named === undefined) return TARGETS;
  const unknown = named.filter((name) => !TARGETS.some((target) => target === name));
  if (unknown.length > 0)
    throw new Error(`No such client: ${unknown.join(", ")} (one of ${TARGETS.join(", ")})`);
  return TARGETS.filter((target) => named.includes(target));
}

function shotsOf(
  scene: Scene,
  targets: readonly Target[],
  themes: readonly Theme[],
  sizes: readonly Size[],
): Shot[] {
  return targets.flatMap((target) =>
    sizes.flatMap((size) => themes.map((theme) => ({ target, scene, theme, size }))),
  );
}

function clientsOf(scene: Scene, wanted: readonly Target[]): readonly Client[] {
  return wanted.filter((target) => target !== TARGET.CATALOG && drawsOn(scene, target));
}

function clientsNotDrawing(scene: Scene, wanted: readonly Target[]): readonly Client[] {
  if (scene.clients === undefined) return [];
  return wanted.filter((target) => target !== TARGET.CATALOG && !drawsOn(scene, target));
}

const USAGE = `usage: polish-shots.ts [--out <dir>] [--client desktop|web|catalog]... [--scene <id>]...
                       [--theme light|dark] [--size wide|least|narrow] [--jobs <n>] [--electron <path>]`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: DEFAULT_OUT },
      client: { type: "string", multiple: true },
      scene: { type: "string", multiple: true },
      theme: { type: "string" },
      size: { type: "string" },
      jobs: { type: "string", default: String(DEFAULT_JOBS) },
      electron: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    say(USAGE);
    return;
  }
  const outDir = path.resolve(values.out);
  const jobs = Math.max(1, Number(values.jobs) || DEFAULT_JOBS);
  const targets = wantedTargets(values.client);
  const themes = THEMES.filter((theme) => values.theme === undefined || values.theme === theme);
  const sizes = SIZES.filter((size) => values.size === undefined || values.size === size);
  const wanted = values.scene;
  const named = SCENES.filter((scene) => wanted === undefined || wanted.includes(scene.id));
  const onMac = process.platform === "darwin";
  const skipped = onMac ? [] : named.filter((scene) => scene.macOnly === true);
  for (const scene of skipped) say(`skipped ${scene.id} (${scene.title}): drawn only on the Mac`);
  const scenes = named.filter((scene) => !skipped.includes(scene));
  for (const scene of scenes)
    for (const target of clientsNotDrawing(scene, targets))
      say(
        `skipped ${scene.id} (${scene.title}) on ${target}: drawn only by ${(scene.clients ?? []).join(", ")}`,
      );
  if (targets.includes(TARGET.DESKTOP) && values.electron === undefined) {
    throw new Error("The desktop is driven through --electron <path to the Electron binary>");
  }

  const playwright = loadPlaywright();
  const catalogBuild = mkdtempSync(path.join(tmpdir(), "polish-catalog-"));
  const served: Served[] = [];
  let browser: PlaywrightBrowser | undefined;
  try {
    const bases: Partial<Record<Target, string>> = {};
    const browsing = targets.includes(TARGET.WEB) || targets.includes(TARGET.CATALOG);
    browser = browsing ? await playwright.chromium.launch() : undefined;
    if (targets.includes(TARGET.WEB)) {
      const web = await serveWeb();
      served.push(web);
      bases[TARGET.WEB] = web.base;
    }
    let catalog: readonly Scene[] = [];
    if (targets.includes(TARGET.CATALOG) && browser !== undefined) {
      const server = await serveCatalog(catalogBuild);
      served.push(server);
      bases[TARGET.CATALOG] = server.base;
      const listed = await catalogScenes(browser, server.base);
      catalog = listed.filter((scene) => wanted === undefined || wanted.includes(scene.id));
    }
    const queue = [
      ...scenes.flatMap((scene) => shotsOf(scene, clientsOf(scene, targets), themes, sizes)),
      ...catalog.flatMap((scene) => shotsOf(scene, [TARGET.CATALOG], themes, sizes)),
    ];
    if (queue.length === 0) throw new Error("No scene matches");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const order = [...queue];
    const results: ShotResult[] = [];
    const drivers: Drivers = { playwright, browser, electron: values.electron, bases };
    const first = queue.findIndex((shot) => shot.target === TARGET.WEB);
    if (first >= 0) await work(drivers, 0, outDir, queue.splice(first, 1), results);
    await Promise.all(
      Array.from({ length: jobs }, (_, worker) =>
        work(drivers, worker + 1, outDir, queue, results),
      ),
    );
    const queued = order.flatMap((shot) => results.filter((result) => result.shot === shot));
    writeFileSync(path.join(outDir, "index.html"), contactSheet(queued, skipped));
    const flagged = results.filter((result) => result.problems.length > 0).length;
    const shotScenes = new Set(
      results.map((result) => `${result.shot.target}/${result.shot.scene.id}`),
    ).size;
    say(`${results.length} pictures of ${shotScenes} scenes in ${path.join(outDir, "index.html")}`);
    if (flagged > 0) say(`${flagged} picture(s) carry a note`);
  } finally {
    await browser?.close();
    for (const server of served) await server.stop();
    rmSync(catalogBuild, { recursive: true, force: true });
  }
}

await main();
