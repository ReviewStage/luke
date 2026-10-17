// @vitest-environment jsdom
import { GITHUB_INSTALL_LANDING, GITHUB_INSTALL_STATUS } from "@luke/features";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";

/**
 * github-installed.test.ts -- the GitHub App's landing says where an
 * installation stands and what to do next: a confirmed one sends the
 * developer back to Luke, a refused one says why and how to try again, and
 * an address whose status the page does not know reads as an installation
 * Luke could not confirm. The page runs as it does in the browser, mounted on
 * its own `#root`.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The page with `status` on its address, or none. */
async function openPage(status?: string): Promise<HTMLElement> {
  const search =
    status === undefined
      ? ""
      : `?${new URLSearchParams({ [GITHUB_INSTALL_LANDING.STATUS_PARAM]: status })}`;
  window.history.replaceState(null, "", `${GITHUB_INSTALL_LANDING.PATH}${search}`);
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import("../src/github-installed");
  });
  return root;
}

/** What the card says, one line per element: its status word, title, and description. */
function said(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("p, h1"))
    .map((element) => element.textContent ?? "")
    .filter((words) => words !== "");
}

afterEach(() => {
  document.body.replaceChildren();
});

test("an installation sends the developer back to Luke", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.INSTALLED);

  expect(said(page)).toEqual([
    "Installed",
    "Luke can see your repositories",
    "Return to Luke. You can close this tab.",
  ]);
});

test("a request to an organization's owner leaves nothing to return to", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.REQUESTED);

  expect(said(page)).toEqual([
    "Requested",
    "Your request went to the organization's owner",
    "You can close this tab.",
  ]);
});

test("an account another workspace holds says how to connect it here", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.ALREADY_CONNECTED);

  expect(said(page)).toEqual([
    "Not connected",
    "That GitHub account is connected to another workspace",
    "One GitHub account or organization connects to one workspace. Disconnect it there first, or choose another.",
  ]);
});

test("an expired link sends the developer back to connect again", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.EXPIRED);

  expect(said(page)).toEqual([
    "Not connected",
    "This connection link has expired",
    "Return to Luke and choose Connect GitHub again.",
  ]);
});

test("an address with no status it knows reads as an unconfirmed installation", async () => {
  for (const status of [undefined, "mystery"]) {
    const page = await openPage(status);

    expect(said(page)).toEqual([
      "Not completed",
      "Luke could not confirm the installation",
      "Return to Luke and choose Connect GitHub again.",
    ]);
  }
});
