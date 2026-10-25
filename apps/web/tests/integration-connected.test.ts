// @vitest-environment jsdom
import {
  INTEGRATION_LANDING,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import { APP_HOME_LINK } from "@luke/features/link-home";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { rememberReturn } from "../src/connect-return";
import { appTab, closeAppTabs } from "./support/connect-app-tab";

/**
 * integration-connected.test.ts -- an integration's landing says how its
 * sign-in settled and how to go on: a connection says the tab can go, every
 * other ending says how to try again, and the provider's name is said only
 * where the address named one. A landing nothing answered offers Open Luke
 * for the Mac app on a Mac, and nothing elsewhere. A sign-in the web app's tab
 * handed off is answered by that tab, and by no other, and the page closes
 * where it connected and stays to say why where it did not, unless the
 * sign-in was abandoned; a same-tab sign-in is offered the address it left
 * from, unless it was abandoned. The page runs as it does in the browser,
 * mounted on its own `#root`.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The page at `address`. */
async function openPage(address: string): Promise<HTMLElement> {
  window.history.replaceState(null, "", address);
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import("../src/integration-connected");
  });
  return root;
}

/** The page for one settled sign-in, as the service's callback addresses it. */
function landing(
  provider: IntegrationProvider | undefined,
  status: IntegrationLandingStatus,
): Promise<HTMLElement> {
  return openPage(integrationLandingPath(provider, status));
}

/** What the card says, one line per element: its title and description. */
function said(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("p, h1"))
    .map((element) => element.textContent ?? "")
    .filter((words) => words !== "");
}

/** The way back the card offers, as its words and the address it goes to. */
function wayBack(page: HTMLElement): { readonly words: string; readonly href: string }[] {
  return Array.from(page.querySelectorAll("a")).map((link) => ({
    words: link.textContent ?? "",
    href: link.getAttribute("href") ?? "",
  }));
}

/** The browser saying it runs on a Mac, until `vi.unstubAllGlobals()`. */
function onMac(): void {
  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    maxTouchPoints: 0,
  });
}

afterEach(() => {
  closeAppTabs();
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a connection names the provider and sends the developer back to Luke", async () => {
  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);

  expect(said(page)).toEqual(["Linear is connected", "You can close this tab."]);
});

test("every other ending sends the developer back to try again", async () => {
  const notCompleted = await landing(
    INTEGRATION_PROVIDER.NOTION,
    INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  );
  expect(said(notCompleted)).toEqual([
    "Notion was not connected",
    "Connect Notion again from Luke.",
  ]);

  const unavailable = await landing(
    INTEGRATION_PROVIDER.NOTION,
    INTEGRATION_LANDING_STATUS.UNAVAILABLE,
  );
  expect(said(unavailable)).toEqual(["Luke could not reach Notion", "Try again in a moment."]);

  const expired = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.EXPIRED);
  expect(said(expired)).toEqual([
    "This link to connect Notion has expired",
    "Connect Notion again from Luke.",
  ]);
});

test("an address that names no provider says no name", async () => {
  const connected = await landing(undefined, INTEGRATION_LANDING_STATUS.CONNECTED);
  expect(said(connected)).toEqual(["Connected to Luke", "You can close this tab."]);

  const unavailable = await landing(undefined, INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  expect(said(unavailable)).toEqual(["Luke could not finish connecting", "Try again in a moment."]);
});

test("an address with no status it knows reads as an expired link", async () => {
  for (const search of ["", "?status=mystery"]) {
    const page = await openPage(`${INTEGRATION_LANDING.PATH}${search}`);

    expect(said(page)).toEqual(["This connection link has expired", "Connect it again from Luke."]);
  }
});

/** The page, once the app's tab answered it and it offers the way back to the app. */
async function answered(page: HTMLElement): Promise<void> {
  await vi.waitFor(async () => {
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    expect(wayBack(page)).toEqual([{ words: "Open Luke", href: "/app" }]);
  });
}

/** Gives the channel turns enough for any app tab to answer a landing, as one that answers would by then. */
async function channelTurns(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(() => new Promise((resolve) => setImmediate(resolve)));
  }
}

test("a sign-in the app's tab handed off is answered by that tab, and its landing closes", async () => {
  const closed = vi.spyOn(window, "close").mockImplementation(() => undefined);
  const app = await appTab(1);
  app.landIn(0);

  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);

  await answered(page);
  expect(closed).toHaveBeenCalled();
});

test("a sign-in that did not connect stays to say so, offering the way back", async () => {
  const closed = vi.spyOn(window, "close").mockImplementation(() => undefined);
  const app = await appTab(1);
  app.landIn(0);

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.NOT_COMPLETED);

  await answered(page);
  expect(said(page)).toEqual(["Notion was not connected", "Connect Notion again from Luke."]);
  expect(closed).not.toHaveBeenCalled();
});

test("a landing no app tab handed off offers nothing to press off a Mac, though an app tab waits on a sign-in of its own", async () => {
  await appTab(1);

  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);
  // The channel is given turns to answer, which no tab takes.
  await channelTurns();

  expect(said(page)).toEqual(["Linear is connected", "You can close this tab."]);
  expect(wayBack(page)).toEqual([]);
});

test("a landing no app tab handed off, as the Mac's, opens the Mac app on a Mac", async () => {
  onMac();
  await appTab(1);

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  await channelTurns();

  expect(wayBack(page)).toEqual([{ words: "Open Luke", href: APP_HOME_LINK }]);
});

test("a landing the app's tab answered closes back to it on a Mac too, rather than opening the Mac app", async () => {
  onMac();
  const closed = vi.spyOn(window, "close").mockImplementation(() => undefined);
  const app = await appTab(1);
  app.landIn(0);

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.NOT_COMPLETED);
  await answered(page);

  act(() => page.querySelector("a")?.click());
  expect(closed).toHaveBeenCalled();
});

test("of two app tabs, only the one that handed a sign-in off answers its landing, and the other still answers its own", async () => {
  vi.spyOn(window, "close").mockImplementation(() => undefined);
  const first = await appTab(1);
  const second = await appTab(1);

  second.landIn(0);
  const secondLanding = await landing(
    INTEGRATION_PROVIDER.LINEAR,
    INTEGRATION_LANDING_STATUS.CONNECTED,
  );
  await answered(secondLanding);

  first.landIn(0);
  const firstLanding = await landing(
    INTEGRATION_PROVIDER.NOTION,
    INTEGRATION_LANDING_STATUS.CONNECTED,
  );
  await answered(firstLanding);
});

test("an app tab with two sign-ins out answers each one's landing, whichever lands first", async () => {
  vi.spyOn(window, "close").mockImplementation(() => undefined);
  const app = await appTab(2);

  app.landIn(1);
  await answered(await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED));
  app.landIn(0);
  await answered(
    await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.NOT_COMPLETED),
  );
});

test("a sign-in whose landing comes back half an hour after it was handed off and more was abandoned, and no tab answers it", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
  const app = await appTab(1);
  now.mockReturnValue(1_760_000_000_000 + 31 * 60 * 1000);
  app.landIn(0);

  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);
  await channelTurns();

  expect(said(page)).toEqual(["Linear is connected", "You can close this tab."]);
  expect(wayBack(page)).toEqual([]);
});

test("a sign-in that left this tab offers the way back to where it stood", async () => {
  rememberReturn("/plan/4f0b6a0e?tab=agents");

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.NOT_COMPLETED);

  expect(said(page)).toEqual(["Notion was not connected", "Connect Notion again from Luke."]);
  expect(wayBack(page)).toEqual([{ words: "Open Luke", href: "/plan/4f0b6a0e?tab=agents" }]);
});

test("a connection that left this tab says nothing of closing it, since the tab is the app's own", async () => {
  rememberReturn("/plan/4f0b6a0e");

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.CONNECTED);

  expect(said(page)).toEqual(["Notion is connected"]);
  expect(wayBack(page)).toEqual([{ words: "Open Luke", href: "/plan/4f0b6a0e" }]);
});

test("an address left that is not this origin's is not offered", async () => {
  rememberReturn("//elsewhere.example/plan");

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.CONNECTED);

  expect(wayBack(page)).toEqual([]);
});

test("an address a connect left half an hour ago and more was abandoned, and is not offered", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
  rememberReturn("/plan/4f0b6a0e");
  now.mockReturnValue(1_760_000_000_000 + 31 * 60 * 1000);

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.CONNECTED);

  expect(wayBack(page)).toEqual([]);
});
