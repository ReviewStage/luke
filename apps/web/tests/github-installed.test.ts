// @vitest-environment jsdom
import { GITHUB_INSTALL_LANDING, GITHUB_INSTALL_STATUS } from "@luke/features";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { rememberReturn } from "../src/connect-return";

/**
 * github-installed.test.ts -- the GitHub App's landing says where an
 * installation stands and what to do next: a confirmed one says the tab can
 * go, a refused one says why and how to try again, and an address whose
 * status the page does not know reads as an installation Luke could not
 * confirm. The page runs as it does in the browser, mounted on its own
 * `#root`.
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

/** What the page says, one line per element: its title and description. */
function said(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("p, h1"))
    .map((element) => element.textContent ?? "")
    .filter((words) => words !== "");
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

test("an installation says the tab can go", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.INSTALLED);

  expect(said(page)).toEqual(["Luke can see your GitHub repositories", "You can close this tab."]);
});

test("a request to an organization's owner leaves nothing to return to", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.REQUESTED);

  expect(said(page)).toEqual([
    "Your request went to your organization's owner",
    "You can close this tab.",
  ]);
});

test("an account another workspace holds says how to free it", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.ALREADY_CONNECTED);

  expect(said(page)).toEqual([
    "That GitHub account is connected to another workspace",
    "Uninstall Luke from that account on GitHub, then connect it here.",
  ]);
});

test("an expired link sends the developer back to connect again", async () => {
  const page = await openPage(GITHUB_INSTALL_STATUS.EXPIRED);

  expect(said(page)).toEqual([
    "This link to connect GitHub has expired",
    "Connect GitHub again from Luke.",
  ]);
});

test("an address with no status it knows reads as an unconfirmed installation", async () => {
  for (const status of [undefined, "mystery"]) {
    const page = await openPage(status);

    expect(said(page)).toEqual([
      "Luke could not confirm the GitHub installation",
      "Connect GitHub again from Luke.",
    ]);
  }
});

test("an installation the web app's tab left for offers the way back, with what is left to say", async () => {
  rememberReturn("/settings/workspace");

  const page = await openPage(GITHUB_INSTALL_STATUS.CONNECTED);

  expect(said(page)).toEqual([
    "GitHub is connected to your workspace",
    "Everyone in the workspace can use it.",
  ]);
  expect(
    Array.from(page.querySelectorAll("a")).map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]),
  ).toEqual([["Open Luke", "/settings/workspace"]]);
});
