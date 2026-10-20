// @vitest-environment jsdom
import {
  INTEGRATION_LANDING,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { rememberReturn } from "../src/connect-return";
import { appTab } from "./support/connect-app-tab";

/**
 * integration-connected.test.ts -- an integration's landing says how its
 * sign-in settled and how to go on: a connection sends the developer back to
 * Luke, every other ending sends them back to try again, and the provider's
 * name is said only where the address named one. A sign-in the web app's tab
 * handed off is answered by that tab, and the page closes where it
 * connected and stays to say why where it did not; a same-tab sign-in is
 * offered the address it left from, unless it was abandoned. The page runs
 * as it does in the browser, mounted on its own `#root`.
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

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

test("a connection names the provider and sends the developer back to Luke", async () => {
  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);

  expect(said(page)).toEqual(["Linear connected", "Return to Luke. You can close this tab."]);
});

test("every other ending sends the developer back to try again", async () => {
  const notCompleted = await landing(
    INTEGRATION_PROVIDER.NOTION,
    INTEGRATION_LANDING_STATUS.NOT_COMPLETED,
  );
  expect(said(notCompleted)).toEqual(["Notion not connected", "Return to Luke to try again."]);

  const unavailable = await landing(
    INTEGRATION_PROVIDER.NOTION,
    INTEGRATION_LANDING_STATUS.UNAVAILABLE,
  );
  expect(said(unavailable)).toEqual(["Could not connect Notion", "Return to Luke to try again."]);

  const expired = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.EXPIRED);
  expect(said(expired)).toEqual(["This link has expired", "Return to Luke to try again."]);
});

test("an address that names no provider says no name", async () => {
  const connected = await landing(undefined, INTEGRATION_LANDING_STATUS.CONNECTED);
  expect(said(connected)).toEqual(["Connected", "Return to Luke. You can close this tab."]);

  const unavailable = await landing(undefined, INTEGRATION_LANDING_STATUS.UNAVAILABLE);
  expect(said(unavailable)).toEqual(["Could not connect", "Return to Luke to try again."]);
});

test("an address with no status it knows reads as an expired link", async () => {
  for (const search of ["", "?status=mystery"]) {
    const page = await openPage(`${INTEGRATION_LANDING.PATH}${search}`);

    expect(said(page)).toEqual(["This link has expired", "Return to Luke to try again."]);
  }
});

/** The page, once the app's tab answered it and it offers the way back to the app. */
async function answered(page: HTMLElement): Promise<void> {
  await vi.waitFor(async () => {
    await act(() => new Promise((resolve) => setImmediate(resolve)));
    expect(wayBack(page)).toEqual([{ words: "Back to Luke", href: "/app" }]);
  });
}

test("a sign-in the app's tab handed off is answered by that tab, and its landing closes", async () => {
  const closed = vi.spyOn(window, "close").mockImplementation(() => undefined);
  const app = await appTab(1);

  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);

  await answered(page);
  expect(said(page)).toEqual(["Linear connected"]);
  expect(closed).toHaveBeenCalled();
  app.close();
});

test("a sign-in that did not connect stays to say so, offering the way back", async () => {
  const closed = vi.spyOn(window, "close").mockImplementation(() => undefined);
  const app = await appTab(1);

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.NOT_COMPLETED);

  await answered(page);
  expect(said(page)).toEqual(["Notion not connected"]);
  expect(closed).not.toHaveBeenCalled();
  app.close();
});

test("a landing no app tab handed off, as the Mac's, says to return to Luke", async () => {
  const app = await appTab(0);

  const page = await landing(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED);
  // The channel is given a turn to answer, which no tab does.
  await act(() => new Promise((resolve) => setImmediate(resolve)));

  expect(said(page)).toEqual(["Linear connected", "Return to Luke. You can close this tab."]);
  expect(wayBack(page)).toEqual([]);
  app.close();
});

test("a sign-in that left this tab offers the way back to where it stood", async () => {
  rememberReturn("/plan/4f0b6a0e?tab=agents");

  const page = await landing(INTEGRATION_PROVIDER.NOTION, INTEGRATION_LANDING_STATUS.NOT_COMPLETED);

  expect(said(page)).toEqual(["Notion not connected"]);
  expect(wayBack(page)).toEqual([{ words: "Back to Luke", href: "/plan/4f0b6a0e?tab=agents" }]);
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
