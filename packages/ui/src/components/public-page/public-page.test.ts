// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PUBLIC_SECTIONS, PUBLIC_TITLE, PublicPage, PublicSection } from "./public-page.js";

/**
 * public-page.test.ts -- what a reader of a public page meets: a banner, a
 * main under the page's one `h1`, sections named by their titles, and a
 * footer, each only when the caller hands it one; and the lead, shown
 * whether or not the page has a title of its own.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const containers: HTMLElement[] = [];

/** Draws `element` into a fresh container in the document. */
async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => root.render(element));
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

/** The element a heading at `level` reading `name` is, or nothing. */
function heading(container: HTMLElement, level: number, name: string): Element | undefined {
  return [...container.querySelectorAll(`h${level}`)].find(
    (element) => element.textContent === name,
  );
}

/** The section `aria-labelledby` names `name`, as a reader finds the region. */
function region(container: HTMLElement, name: string): Element | undefined {
  return [...container.querySelectorAll("section[aria-labelledby]")].find(
    (element) =>
      document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.textContent === name,
  );
}

function landing(): ReactElement {
  return createElement(PublicPage, {
    banner: createElement(
      "nav",
      { "aria-label": "Site" },
      createElement("a", { href: "/" }, "Luke"),
    ),
    footer: createElement("span", null, "Apache-2.0"),
    title: "Plan with agents.",
    titleStyle: PUBLIC_TITLE.HERO,
    lead: "Talk a feature through and get a plan.",
    children: ["Talk", "Plan"].map((name) =>
      createElement(PublicSection, { key: name, title: name, children: `${name} body` }),
    ),
  });
}

test("the page reads as a banner, a main under its one h1, sections named by their titles, and a footer", async () => {
  const container = await render(landing());
  const main = container.querySelector("main");
  expect(container.querySelector("header")?.textContent).toBe("Luke");
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(main?.contains(heading(container, 1, "Plan with agents.") ?? null)).toBe(true);
  expect(main?.textContent).toContain("Talk a feature through and get a plan.");
  expect(region(container, "Talk")?.textContent).toBe("TalkTalk body");
  expect(heading(container, 2, "Plan")).toBeDefined();
  expect(container.querySelector("footer")?.textContent).toBe("Apache-2.0");
});

test("a section with no title is no named region and has no heading", async () => {
  const container = await render(
    createElement(PublicPage, { children: createElement(PublicSection, { children: "Acts" }) }),
  );
  expect(container.querySelector("section")?.hasAttribute("aria-labelledby")).toBe(false);
  expect(container.querySelector("h1, h2")).toBeNull();
  expect(container.querySelector("main")?.textContent).toBe("Acts");
});

test("a page with no title, banner, or footer draws only its main", async () => {
  const container = await render(createElement(PublicPage, { children: "Line" }));
  expect(container.querySelector("header")).toBeNull();
  expect(container.querySelector("footer")).toBeNull();
  expect(container.querySelector("h1")).toBeNull();
  expect(container.querySelector("main")?.textContent).toBe("Line");
});

test("a lead with no title still opens the page, before content that brings its own heading", async () => {
  const container = await render(
    createElement(PublicPage, {
      lead: "Read how Luke came to be.",
      children: createElement("h1", null, "About"),
    }),
  );
  expect(container.querySelector("main")?.textContent).toBe("Read how Luke came to be.About");
});

test("a page that is a title alone draws its title and nothing after it", async () => {
  const container = await render(createElement(PublicPage, { title: "About" }));
  expect(container.querySelector("main")?.textContent).toBe("About");
  expect(container.querySelector("main")?.lastElementChild?.textContent).toBe("About");
});

test("a page beneath another names its way back as a link before its title", async () => {
  const container = await render(
    createElement(PublicPage, {
      back: { href: "/changelog", label: "Changelog" },
      title: "Luke 2.4.0",
      sections: PUBLIC_SECTIONS.RULED,
      children: createElement(PublicSection, { children: "Notes" }),
    }),
  );
  const back = container.querySelector("main a");
  const title = heading(container, 1, "Luke 2.4.0");
  expect(back?.getAttribute("href")).toBe("/changelog");
  expect(back?.textContent).toBe("← Changelog");
  expect(back?.querySelector("[aria-hidden='true']")?.textContent).toBe("← ");
  expect(
    title !== undefined &&
      back !== null &&
      (back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  ).toBe(true);
});
