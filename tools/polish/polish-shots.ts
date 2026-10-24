/**
 * polish-shots.ts -- shoots every scene of the polish manifest in both themes at three window sizes, on the desktop app, the web client and the catalog, and lays the pictures out on one contact sheet.
 *
 * Run it through `tools/polish/polish.sh`, which builds what it drives and
 * stands up a display on Linux (`--help` lists the flags). Each scene of
 * `scenes.ts` is drawn by:
 *
 * - the desktop app, Electron driven by Playwright's `_electron`, one launch
 *   per picture as `scripts/evidence.sh` launches one per capture, on the
 *   scene's fixture profile (`--fixture smoke --profile <profile>`);
 * - the web client in Chromium, served by its own development server, which
 *   alone reads a profile off the address (`?fixture=`, `web-fixture.ts`).
 *
 * The catalog is shot beside them, every example its index lists, over its
 * own addresses as `apps/catalog/scripts/shoot.ts` shoots it.
 *
 * Every picture is taken in light and in dark, with `data-luke-theme` held on
 * the root and the machine's appearance emulated to match, at the three sizes
 * the window is checked at: wide, the window Luke opens in (1280×840,
 * `DESKTOP_WINDOW` in `apps/desktop/src/main/window/panel-manager.ts`); the
 * least window (760×520); and narrow, which is the phone layout on the web
 * (390 wide) and the least window at 125% zoom on the desktop (608 CSS px).
 *
 * Note that it drives the app as `pnpm start` runs it, not the signed bundle
 * `pnpm package:dir` makes, because that bundle's Node inspector fuse is
 * burnt off (`electron-builder-config.mjs`) and Playwright attaches through
 * the inspector. Each worker runs as a named instance (`LUKE_INSTANCE`), so
 * it holds a lock and a state folder of its own and never replaces the Luke
 * a developer has open. The motion tokens are zeroed as a capture run
 * zeroes them, so a picture lands on the steady state. It is not a test:
 * nothing is compared, no golden is kept, no CI job runs it, and nothing it
 * writes is committed. Playwright is not a dependency of the workspace: it
 * is found beside the script, or in the global npm folder.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
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
  WINDOW,
} from "./scenes.ts";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DESKTOP_ROOT = path.join(REPOSITORY_ROOT, "apps", "desktop");
const WEB_ROOT = path.join(REPOSITORY_ROOT, "apps", "web");
const CATALOG_ROOT = path.join(REPOSITORY_ROOT, "apps", "catalog");
const DEFAULT_OUT = path.join(REPOSITORY_ROOT, "artifacts", "polish", "app");

/** Everything this shoots: the two clients of a scene, and the catalog. */
const TARGET = { ...CLIENT, CATALOG: "catalog" } as const;
type Target = (typeof TARGET)[keyof typeof TARGET];
const TARGETS: readonly Target[] = Object.values(TARGET);

// `@luke/ui`'s THEME, less `system`, which a plain node script cannot import.
const THEME = { LIGHT: "light", DARK: "dark" } as const;
type Theme = (typeof THEME)[keyof typeof THEME];
const THEMES: readonly Theme[] = Object.values(THEME);

const SIZE = { WIDE: "wide", LEAST: "least", NARROW: "narrow" } as const;
type Size = (typeof SIZE)[keyof typeof SIZE];
const SIZES: readonly Size[] = Object.values(SIZE);

/** A window or viewport, the zoom it is drawn at, and whether a finger works it. */
interface Frame {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly phone: boolean;
}

// DESKTOP_WINDOW's opening and least sizes, which the desktop and the catalog share.
const WIDE_FRAME: Frame = { width: 1280, height: 840, zoom: 1, phone: false };
const LEAST_FRAME: Frame = { width: 760, height: 520, zoom: 1, phone: false };
// A phone: the width the catalog's own phone frame draws at, its screen a modern phone's height.
const PHONE_FRAME: Frame = { width: 390, height: 844, zoom: 1, phone: true };
// The least window at 125% zoom, which leaves 608 CSS px: the desktop's own way to the narrow layout.
const ZOOMED_FRAME: Frame = { ...LEAST_FRAME, zoom: 1.25 };

const FRAMES: Readonly<Record<Target, Readonly<Record<Size, Frame>>>> = {
  [TARGET.DESKTOP]: { wide: WIDE_FRAME, least: LEAST_FRAME, narrow: ZOOMED_FRAME },
  [TARGET.WEB]: { wide: WIDE_FRAME, least: LEAST_FRAME, narrow: PHONE_FRAME },
  [TARGET.CATALOG]: { wide: WIDE_FRAME, least: LEAST_FRAME, narrow: PHONE_FRAME },
};

const DEFAULT_JOBS = 3;
// The longest the first page waits on the web client's development server compiling it.
const FIRST_LOAD_TIMEOUT_MS = 180_000;
// The longest a window waits to draw its stage, and a step to find its element.
const READY_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 5_000;
// Time for the fixture's data to land after the stage draws, and for a step's answer to settle.
const LOAD_SETTLE_MS = 1_200;
const STEP_SETTLE_MS = 400;
// The element every panel window draws once its state has arrived (`packages/panel/src/app.tsx`).
const STAGE_SELECTOR = ".app-stage";
// The video player's example draws only this line until its stand-in is recorded, some frames on (`apps/catalog/src/examples/video-player.tsx`).
const RECORDED_SCRIPT = `!document.querySelector(".catalog-example").textContent.includes("Recording a stand-in video")`;
// How long a scene waits for its skeletons and spinners to give way before it is shot anyway, with a note.
const READING_TIMEOUT_MS = 10_000;
// The desktop's renderer pages, by what their address ends with.
const WINDOW_PAGE = { [WINDOW.PANEL]: "/index.html", [WINDOW.CALL]: "/call.html" } as const;

/** The capture run's zeroing of motion, laid on the root and the body, over whatever the token sheets say. */
const STILL_MOTION_CSS = `
:root, body {
  --luke-duration-shape: 0s !important;
  --luke-duration-exit: 0s !important;
  --luke-duration-quick: 0s !important;
  --luke-duration-fast: 0s !important;
  --luke-duration-hover: 0s !important;
  --luke-duration-pane: 0s !important;
  --luke-row-stagger: 0s !important;
  --luke-late-delay: 0s !important;
  --luke-hint-delay: 0s !important;
  --luke-settle-delay: 0s !important;
  --luke-loop-motion: paused !important;
  --luke-wait-motion: paused !important;
  --luke-face-motion: paused !important;
  --luke-scroll-glide: auto !important;
}`;

/** A page script that lays the still motion and holds `theme` on the root, whatever the app wears there after. */
function stillPageScript(theme: Theme): string {
  return `
(() => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(STILL_MOTION_CSS)};
  const hold = (root) => {
    if (root.getAttribute("data-luke-theme") !== ${JSON.stringify(theme)}) root.setAttribute("data-luke-theme", ${JSON.stringify(theme)});
    if (!style.isConnected) root.append(style);
  };
  const lay = (root) => {
    hold(root);
    new MutationObserver(() => hold(root)).observe(root, { attributes: true, attributeFilter: ["data-luke-theme"] });
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

// Playwright's surface this script touches, typed here because the package is not installed beside it.
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
interface ElectronApplication {
  windows(): PlaywrightPage[];
  waitForEvent(event: "window", options: Record<string, unknown>): Promise<PlaywrightPage>;
  evaluate<Arg>(script: (electron: never, arg: Arg) => unknown, arg: Arg): Promise<unknown>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(): Promise<PlaywrightBrowser> };
  _electron: { launch(options: Record<string, unknown>): Promise<ElectronApplication> };
}

/** A development server this run stood up: its address and how to stop it. */
interface Served {
  readonly base: string;
  readonly stop: () => Promise<void>;
}

/** One line to the terminal. */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Playwright, from beside this script or from the global npm folder. */
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

/** Vite as the app at `appRoot` resolves it, since this folder is no workspace of its own. */
async function viteOf(appRoot: string): Promise<typeof import("vite")> {
  const require = createRequire(path.join(appRoot, "package.json"));
  return (await import(require.resolve("vite"))) as typeof import("vite");
}

/** The web client's development server, the one build that reads a fixture profile off the address. */
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

/** The catalog, built into `outDir` and served. */
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

/** The examples the catalog's index lists, in its order, as scenes of one place. */
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

/** The element a step names, by its whole name where it asks, within its landmark where it names one. */
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

/** Runs `step` on `page`, `client`'s, answering what went wrong, or nothing. */
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
    }
    await page.waitForTimeout(STEP_SETTLE_MS);
    return undefined;
  } catch {
    return `step ${step.kind} ${JSON.stringify(step)} found nothing`;
  }
}

/** Floats the sidebar open where the window has folded it away, which its toggle offers as "Show sidebar" and only then; a pinned sidebar offers "Hide sidebar", so nothing is pressed. */
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

/** Waits for the panel's stage and its fonts, then runs the scene's steps, answering their problems. A scene that steps into the sidebar has it shown first, except in the phone's layout, whose drawer its own steps open. */
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

/** The desktop page that draws `scene`'s window, waiting for it to open. */
async function desktopPage(app: ElectronApplication, scene: Scene): Promise<PlaywrightPage> {
  const suffix = WINDOW_PAGE[scene.window ?? WINDOW.PANEL];
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const open = app.windows().find((page) => page.url().endsWith(suffix));
    if (open !== undefined) return open;
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`No ${suffix} window opened`);
    await app.waitForEvent("window", { timeout: left }).catch(() => undefined);
  }
}

/** Options of a desktop launch: the Electron binary, and the worker it runs as. */
interface DesktopLaunch {
  readonly electron: string;
  readonly worker: number;
}

/** One desktop picture: a launch on the scene's profile, sized, themed and staged, then shot. */
async function shootDesktop(
  playwright: Playwright,
  launch: DesktopLaunch,
  shot: Shot,
  file: string,
  problems: string[],
): Promise<void> {
  const frame = FRAMES[shot.target][shot.size];
  const linux = process.platform === "linux";
  const app = await playwright._electron.launch({
    executablePath: launch.electron,
    args: [
      DESKTOP_ROOT,
      // Note that Linux runs as an unprivileged user under xvfb, with no GPU and no setuid sandbox helper.
      ...(linux ? ["--no-sandbox", "--disable-gpu"] : []),
      "--fixture",
      "smoke",
      "--profile",
      shot.scene.profile,
    ],
    env: { ...process.env, LUKE_INSTANCE: `polish-${launch.worker}` },
    timeout: READY_TIMEOUT_MS,
  });
  try {
    const page = await desktopPage(app, shot.scene);
    page.on("pageerror", (error) => problems.push(error.message));
    // The panel's window takes the size and the machine's appearance, the call window the appearance alone,
    // since it is fitted to its card; the page holds the theme on its root.
    await app.evaluate(
      (
        { BrowserWindow, nativeTheme }: never,
        arg: { theme: Theme; frame: Frame | undefined; suffix: string },
      ) => {
        const electron = { BrowserWindow, nativeTheme } as {
          BrowserWindow: {
            getAllWindows(): {
              webContents: { getURL(): string; setZoomFactor(zoom: number): void };
              setSize(width: number, height: number): void;
            }[];
          };
          nativeTheme: { themeSource: string };
        };
        electron.nativeTheme.themeSource = arg.theme;
        const window = electron.BrowserWindow.getAllWindows().find((open) =>
          open.webContents.getURL().endsWith(arg.suffix),
        );
        if (window === undefined || arg.frame === undefined) return;
        window.setSize(arg.frame.width, arg.frame.height);
        window.webContents.setZoomFactor(arg.frame.zoom);
      },
      {
        theme: shot.theme,
        frame: shot.scene.window === WINDOW.CALL ? undefined : frame,
        suffix: WINDOW_PAGE[shot.scene.window ?? WINDOW.PANEL],
      },
    );
    await page.emulateMedia({ colorScheme: shot.theme, reducedMotion: "reduce" });
    await page.evaluate(stillPageScript(shot.theme));
    if (shot.scene.window === WINDOW.CALL) await page.waitForTimeout(LOAD_SETTLE_MS);
    // Note that the zoomed size's 608 CSS px is under the panel's narrow line (`shell-room.ts`), so it draws the phone's layout.
    else await stageScene(page, CLIENT.DESKTOP, shot.scene, shot.size === SIZE.NARROW, problems);
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  } finally {
    await app.close();
  }
}

/** The web client's address for `scene`. */
function webAddress(base: string, scene: Scene): string {
  return new URL(`app.html?${new URLSearchParams({ fixture: scene.profile })}`, base).toString();
}

/** The catalog's address for one example, as `apps/catalog/src/catalog.tsx` reads it. */
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

/** One browser picture, the web client's or the catalog's, on a context of its own. */
async function shootBrowser(
  browser: PlaywrightBrowser,
  base: string,
  shot: Shot,
  file: string,
  problems: string[],
  firstLoad: boolean,
): Promise<void> {
  const frame = FRAMES[shot.target][shot.size];
  // The catalog frames a phone itself on a wide page, so only the web client is shot on one.
  const phone = frame.phone && shot.target === TARGET.WEB;
  const viewport = frame.phone && !phone ? WIDE_FRAME : frame;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    // A finger works either phone, as the catalog's own shoot gives its phone frame.
    ...(frame.phone ? { hasTouch: true } : {}),
    // Note that the phone is shot at one device pixel per CSS pixel, because an emulated scale
    // gives the page a devicePixelRatio its device-pixel resize boxes do not share, and the
    // terminal's WebGL screen, which sizes its canvas from that box, then draws nothing.
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
      await page
        .locator(".catalog-example")
        .screenshot({ path: file, animations: "disabled", caret: "hide" });
      return;
    }
    await page.goto(webAddress(base, shot.scene), {
      timeout: firstLoad ? FIRST_LOAD_TIMEOUT_MS : READY_TIMEOUT_MS,
    });
    await stageScene(page, CLIENT.WEB, shot.scene, phone, problems);
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
}

/** A picture's path under the out folder. */
function fileOf(shot: Shot): string {
  return path.join(shot.target, shot.scene.id, `${shot.theme}.${shot.size}.png`);
}

/** What one worker is handed: what it drives each target with. */
interface Drivers {
  readonly playwright: Playwright;
  readonly browser: PlaywrightBrowser | undefined;
  readonly electron: string | undefined;
  readonly bases: Partial<Record<Target, string>>;
}

/** Takes the next shot off `queue` until none is left. */
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
        await shootDesktop(drivers.playwright, { electron, worker }, shot, absolute, problems);
      } else {
        const firstLoad = results.length < 1;
        const base = drivers.bases[shot.target] ?? "";
        if (drivers.browser === undefined) throw new Error("No browser was launched");
        await shootBrowser(drivers.browser, base, shot, absolute, problems, firstLoad);
      }
    } catch (error) {
      problems.push(
        `not shot: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
    }
    if (problems.length > 0)
      say(`${shot.target}/${shot.scene.id} ${shot.theme} ${shot.size}: ${problems.join("; ")}`);
    results.push({ shot, file, problems });
  }
}

/** Escapes text for the contact sheet. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** One picture on the sheet: the picture, or why there is none, and its problems under it. */
function figure(result: ShotResult | undefined, theme: Theme): string {
  if (result === undefined)
    return `<figure class="none"><figcaption>${theme}: not shot</figcaption></figure>`;
  const shot = result.problems.some((problem) => problem.startsWith("not shot"))
    ? `<div class="missing">not shot</div>`
    : `<a href="${result.file}"><img loading="lazy" src="${result.file}" alt=""></a>`;
  const notes = result.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("");
  return `<figure>${shot}<figcaption>${theme}${notes === "" ? "" : `<ul>${notes}</ul>`}</figcaption></figure>`;
}

/** The contact sheet: a section per place, a block per scene, a row per client and size, light beside dark. */
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
<h1>Polish capture</h1><p class="note">${results.length} pictures of ${scenes.length} scenes; ${flagged} with a note.</p>${skippedNote}<nav>${toc}</nav>${sections.join("")}`;
}

/** The targets the flags ask for, every one where none is named. */
function wantedTargets(named: readonly string[] | undefined): readonly Target[] {
  if (named === undefined) return TARGETS;
  const unknown = named.filter((name) => !TARGETS.some((target) => target === name));
  if (unknown.length > 0)
    throw new Error(`No such client: ${unknown.join(", ")} (one of ${TARGETS.join(", ")})`);
  return TARGETS.filter((target) => named.includes(target));
}

/** A scene's shots on each of `targets`, in sheet order. */
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

/** The targets of `wanted` that draw an app scene: its clients, both where it names none. */
function clientsOf(scene: Scene, wanted: readonly Target[]): readonly Client[] {
  return wanted.filter((target) => target !== TARGET.CATALOG && drawsOn(scene, target));
}

/** The clients among `wanted` that a scene naming its clients does not draw on. */
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
  // The call window, the video tile and a Page tab draw only on the Mac.
  const onMac = process.platform === "darwin";
  const skipped = onMac ? [] : named.filter((scene) => scene.macOnly === true);
  for (const scene of skipped) say(`skipped ${scene.id} (${scene.title}): drawn only on the Mac`);
  const scenes = named.filter((scene) => !skipped.includes(scene));
  // A scene that names its clients is not drawn by the others, so a run that asks for one says so.
  for (const scene of scenes)
    for (const target of clientsNotDrawing(scene, targets))
      say(
        `skipped ${scene.id} (${scene.title}) on ${target}: drawn only by ${(scene.clients ?? []).join(", ")}`,
      );
  if (targets.includes(TARGET.DESKTOP) && values.electron === undefined) {
    throw new Error("The desktop is driven through --electron <path to the Electron binary>");
  }

  // Playwright is looked for first, so a machine without it fails before the long builds.
  const playwright = loadPlaywright();
  const catalogBuild = mkdtempSync(path.join(tmpdir(), "luke-polish-catalog-"));
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
    // The web client's first page compiles the whole panel, so it is loaded alone before the workers fan out.
    const first = queue.findIndex((shot) => shot.target === TARGET.WEB);
    if (first >= 0) await work(drivers, 0, outDir, queue.splice(first, 1), results);
    await Promise.all(
      Array.from({ length: jobs }, (_, worker) =>
        work(drivers, worker + 1, outDir, queue, results),
      ),
    );
    // The workers finish out of order, so the sheet is laid in the order queued.
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
