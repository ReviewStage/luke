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

/**
 * integration-connected.test.ts -- an integration's landing says how its
 * sign-in settled and how to go on: a connection sends the developer back to
 * Luke, every other ending sends them back to try again, and the provider's
 * name is said only where the address named one. The page runs as it does in
 * the browser, mounted on its own `#root`.
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

afterEach(() => {
  document.body.replaceChildren();
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
