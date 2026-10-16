// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { OpenPage } from "../src/OpenPage";

/**
 * The page a Luke link lands on in a browser, drawn from its own address: the
 * press hands the plan to the app in its own scheme, a press is followed by a
 * line saying what to check where nothing opened, and the way to Luke is the
 * landing page, never a download. Synthetic ids.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** The page as a browser draws it at `address`. */
function pageAt(address: string): HTMLElement {
  window.history.replaceState(null, "", address);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() => root?.render(createElement(OpenPage)));
  return container;
}

/** The link whose words are `words`, or nothing where none is drawn. */
function linkNamed(page: HTMLElement, words: string): HTMLAnchorElement | undefined {
  return Array.from(page.querySelectorAll("a")).find((link) => link.textContent === words);
}

/** Nothing opens in jsdom: a press on the scheme's link is the press alone. */
function press(link: HTMLAnchorElement): void {
  link.addEventListener("click", (event) => event.preventDefault());
  act(() => link.click());
}

test("the press opens the plan's section in the app, in the app's own scheme", () => {
  const page = pageAt(`/acme/plan/${PLAN_ID}#rollout`);

  assert.equal(
    linkNamed(page, "Open in Luke")?.getAttribute("href"),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
  );
});

test("a press is followed by a line saying what to check, which leads to the landing page", () => {
  const page = pageAt(`/acme/plan/${PLAN_ID}`);
  assert.equal(page.querySelector('[role="status"]')?.textContent, "");

  const open = linkNamed(page, "Open in Luke");
  assert.ok(open !== undefined);
  press(open);

  const line = page.querySelector('[role="status"]');
  assert.equal(line?.textContent, "Didn't open? Make sure Luke is installed and up to date.");
  assert.equal(linkNamed(page, "installed and up to date")?.getAttribute("href"), "/");
});

test("the way to Luke is the landing page, never a download, on a plan's page and on any other", () => {
  for (const address of [`/acme/plan/${PLAN_ID}`, "/acme/plans/x"]) {
    const page = pageAt(address);
    const hrefs = Array.from(page.querySelectorAll("a")).map((link) => link.getAttribute("href"));

    assert.equal(linkNamed(page, "Get Luke for Mac")?.getAttribute("href"), "/", address);
    assert.deepEqual(
      hrefs.filter((href) => href?.endsWith(".dmg")),
      [],
      address,
    );
  }
});

test("a link to an agent, an Inbox item, or an automation is named by its kind, and its press opens it in the app", () => {
  const AGENT_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  for (const [address, title] of [
    [`/acme/agent/${AGENT_ID}`, "Open this agent in Luke"],
    [`/acme/agent/${AGENT_ID}/inbox/${AGENT_ID}`, "Open this Inbox item in Luke"],
    [`/acme/automation/${AGENT_ID}`, "Open this automation in Luke"],
  ] as const) {
    const page = pageAt(address);

    assert.equal(page.querySelector("h1")?.textContent, title, address);
    assert.equal(
      linkNamed(page, "Open in Luke")?.getAttribute("href"),
      `tryluke://tryluke.dev${address}`,
      address,
    );
  }
});

test("an address naming nothing in Luke says so, and offers nothing to open", () => {
  const page = pageAt("/acme/agent/Fix%20billing");

  assert.equal(page.querySelector("h1")?.textContent, "This isn't a link to anything in Luke");
  assert.equal(linkNamed(page, "Open in Luke"), undefined);
});
