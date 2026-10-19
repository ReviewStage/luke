// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@luke/panel/testing/match-media";
import "@luke/panel/testing/resize-observer";
import { ACT_KIND } from "@luke/host/acts";
import { askAct } from "@luke/panel/act";
import { THEME } from "@luke/settings";
import { Dialog } from "@luke/ui";
import tokens from "@luke/ui/tokens.css?inline";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService } from "./support/fake-service";

/**
 * The web app drawn in the account's Theme setting, as the desktop is: the
 * root wears the theme the setting resolves to, follows the machine's
 * appearance under System (the setting's default) and only then, says its
 * ground to the browser's chrome, keeps the choice for the next load's
 * first frame, and draws an overlay portalled into the page in the same
 * theme. One mount, because the panel's state read is the tab's once.
 */

/** The site palette's two grounds (`@luke/ui`'s `palettes.css`), which the chrome is tinted with. */
const GROUND = { light: "#fbfbfa", dark: "#08090b" } as const;

/** The query a machine's dark appearance answers. */
const MACHINE_DARK = "(prefers-color-scheme: dark)";

let app: WebApp | undefined;
let laid: HTMLStyleElement | undefined;
let machineDark = false;
const flipped = new Set<EventListenerOrEventListenerObject>();

/** The machine's appearance turning dark or light, said to every query listening for it. */
function machineTurns(dark: boolean): void {
  machineDark = dark;
  for (const changed of flipped) {
    const event = new Event("change");
    if ("handleEvent" in changed) changed.handleEvent(event);
    else changed(event);
  }
}

beforeAll(() => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        get matches() {
          return query === MACHINE_DARK && machineDark;
        },
        media: query,
        onchange: null,
        addEventListener: (_type: string, changed: EventListenerOrEventListenerObject) => {
          if (query === MACHINE_DARK) flipped.add(changed);
        },
        removeEventListener: (_type: string, changed: EventListenerOrEventListenerObject) => {
          flipped.delete(changed);
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  );
  // The page's own tags, as app.html writes them: the profile, and the chrome's tint.
  document.documentElement.setAttribute("data-luke-profile", "web");
  document.documentElement.setAttribute("data-luke-theme", "light");
  const meta = document.head.appendChild(document.createElement("meta"));
  meta.name = "theme-color";
  meta.content = GROUND.light;
  laid = document.head.appendChild(document.createElement("style"));
  laid.textContent = tokens;
});

afterAll(async () => {
  await app?.close();
  laid?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** What the tab wears now: its root's theme, the chrome's tint, and the choice kept for the next load. */
function worn() {
  return {
    theme: document.documentElement.getAttribute("data-luke-theme"),
    chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    kept: localStorage.getItem("luke.theme"),
  };
}

/** Writes the Theme setting as its row in Settings does. */
async function chooseTheme(theme: (typeof THEME)[keyof typeof THEME]): Promise<void> {
  await askAct(ACT_KIND.SETTING_UPDATE, { field: "theme", value: theme });
}

test("the tab wears the account's theme, follows the machine under System, and an overlay wears it too", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  app = await mountWebApp(root, { httpClient: fakeService({ signedIn: false }).layer });
  assert.ok(app !== undefined, "the host stands");

  // System, the setting's default, on a light machine.
  await vi.waitFor(() =>
    assert.deepEqual(worn(), { theme: "light", chrome: GROUND.light, kept: THEME.SYSTEM }),
  );
  machineTurns(true);
  assert.deepEqual(worn(), { theme: "dark", chrome: GROUND.dark, kept: THEME.SYSTEM });

  // Light chosen on the dark machine: the choice wins.
  await chooseTheme(THEME.LIGHT);
  await vi.waitFor(() =>
    assert.deepEqual(worn(), { theme: "light", chrome: GROUND.light, kept: THEME.LIGHT }),
  );

  // Dark chosen, and the machine turning light under it changes nothing.
  await chooseTheme(THEME.DARK);
  await vi.waitFor(() =>
    assert.deepEqual(worn(), { theme: "dark", chrome: GROUND.dark, kept: THEME.DARK }),
  );
  machineTurns(false);
  assert.deepEqual(worn(), { theme: "dark", chrome: GROUND.dark, kept: THEME.DARK });

  // An overlay portalled into the page is drawn in the tab's theme.
  const host = document.body.appendChild(document.createElement("div"));
  const overlay = createRoot(host);
  overlay.render(
    createElement(Dialog, { title: "Rename", onDismiss: () => undefined, children: "Words" }),
  );
  const card = await vi.waitFor(() => {
    const drawnCard = document.body.querySelector('[role="dialog"]');
    assert.ok(drawnCard !== null && !host.contains(drawnCard), "the dialog is portalled out");
    return drawnCard;
  });
  const drawn = getComputedStyle(card);
  assert.equal(drawn.getPropertyValue("color-scheme").trim(), "dark");
  assert.equal(drawn.getPropertyValue("--luke-color-ground").trim(), GROUND.dark);
  overlay.unmount();
});
