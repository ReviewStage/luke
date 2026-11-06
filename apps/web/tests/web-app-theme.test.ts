// @vitest-environment jsdom
import assert from "node:assert/strict";
import "@repo/panel/testing/match-media";
import "@repo/panel/testing/resize-observer";
import { ACT_KIND } from "@repo/host/acts";
import { askAct } from "@repo/panel/act";
import { THEME } from "@repo/settings";
import tokens from "@repo/ui/tokens.css?inline";
import { afterAll, beforeAll, test, vi } from "vitest";
import { mountWebApp, type WebApp } from "../src/app/web-root";
import { fakeService } from "./support/fake-service";

const GROUND = { light: "#fffcfa", dark: "#0f0d0b" } as const;

const MACHINE_DARK = "(prefers-color-scheme: dark)";

let app: WebApp | undefined;
let laid: HTMLStyleElement | undefined;
let machineDark = false;
const flipped = new Set<EventListenerOrEventListenerObject>();

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
  document.documentElement.setAttribute("data-ui-profile", "web");
  document.documentElement.setAttribute("data-ui-theme", "light");
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

function worn() {
  return {
    theme: document.documentElement.getAttribute("data-ui-theme"),
    chrome: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    kept: localStorage.getItem("app.theme"),
  };
}

async function chooseTheme(theme: (typeof THEME)[keyof typeof THEME]): Promise<void> {
  await askAct(ACT_KIND.SETTING_UPDATE, { field: "theme", value: theme });
}

test("the tab wears the account's theme and follows the machine under System", async () => {
  const root = document.body.appendChild(document.createElement("div"));
  app = await mountWebApp(root, { httpClient: fakeService({ signedIn: false }).layer });
  assert.ok(app !== undefined, "the host stands");

  await vi.waitFor(() =>
    assert.deepEqual(worn(), { theme: "light", chrome: GROUND.light, kept: THEME.SYSTEM }),
  );
  machineTurns(true);
  assert.deepEqual(worn(), { theme: "dark", chrome: GROUND.dark, kept: THEME.SYSTEM });

  await chooseTheme(THEME.LIGHT);
  await vi.waitFor(() =>
    assert.deepEqual(worn(), { theme: "light", chrome: GROUND.light, kept: THEME.LIGHT }),
  );

  await chooseTheme(THEME.DARK);
  await vi.waitFor(() =>
    assert.deepEqual(worn(), { theme: "dark", chrome: GROUND.dark, kept: THEME.DARK }),
  );
  machineTurns(false);
  assert.deepEqual(worn(), { theme: "dark", chrome: GROUND.dark, kept: THEME.DARK });
});
