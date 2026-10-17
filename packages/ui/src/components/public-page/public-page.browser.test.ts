import { createElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { PUBLIC_TITLE, PublicPage, PublicSection, type PublicTitle } from "./public-page.js";

/**
 * public-page.browser.test.ts -- the banner, the title, every section, and
 * the footer start on one gutter, centred in a wide room and the profile's
 * inset in a phone's; the banner stands still at the top of the document's
 * scroll; sections follow at one rhythm; the hero steps down on a phone;
 * long words wrap inside the column; and the page reads as a banner, a
 * main, and a footer.
 */

const WEB = surfaceAttributes(PROFILE.WEB, THEME.LIGHT);

/** Paragraphs enough to scroll a short frame. */
function lines(prefix: string, count: number): React.JSX.Element[] {
  return Array.from({ length: count }, (_, index) =>
    createElement("p", { key: index }, `${prefix} ${index + 1}`),
  );
}

/** A landing in a frame `width` wide that scrolls as a document would, 480px tall. */
function Landing({
  width = 1440,
  title = "Plan with agents.",
  titleStyle = PUBLIC_TITLE.HERO,
}: {
  width?: number;
  title?: string;
  titleStyle?: PublicTitle;
}): React.JSX.Element {
  return createElement(
    "div",
    { "data-frame": "", style: { width: `${width}px`, height: "480px", overflowY: "auto" } },
    createElement(PublicPage, {
      banner: createElement(
        "nav",
        { "aria-label": "Site" },
        createElement("a", { href: "/" }, "Luke"),
      ),
      footer: createElement("span", null, "Apache-2.0"),
      title,
      titleStyle,
      lead: "Talk a feature through and get a plan.",
      children: ["Talk", "Plan", "Hand off"].map((name) =>
        createElement(PublicSection, { key: name, title: name, children: lines(name, 8) }),
      ),
    }),
  );
}

function box(element: Element | null | undefined): DOMRect {
  expect(element).toBeTruthy();
  return element?.getBoundingClientRect() ?? new DOMRect();
}

function heading(name: string, level: number): Element {
  return page.getByRole("heading", { level, name }).element();
}

function frame(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>("[data-frame]");
  expect(element).toBeTruthy();
  return element ?? container;
}

/** Where each named thing starts, the wordmark, title, lead, a section's heading and words, and the footer. */
function starts(): number[] {
  return [
    box(page.getByRole("link", { name: "Luke" }).element()).left,
    box(heading("Plan with agents.", 1)).left,
    box(page.getByText("Talk a feature through and get a plan.").element()).left,
    box(heading("Plan", 2)).left,
    box(page.getByText("Hand off 8", { exact: true }).element()).left,
    box(page.getByText("Apache-2.0").element()).left,
  ];
}

test("the page reads as a banner, a main under one h1, sections named by their titles, and a footer", async () => {
  const { container } = await mount(createElement(Landing), WEB);
  const main = page.getByRole("main").element();
  expect(main.contains(heading("Plan with agents.", 1))).toBe(true);
  expect(
    page
      .getByRole("banner")
      .element()
      .contains(page.getByRole("link", { name: "Luke" }).element()),
  ).toBe(true);
  expect(page.getByRole("contentinfo").element().textContent).toBe("Apache-2.0");
  expect(page.getByRole("region", { name: "Plan" }).element().textContent).toContain("Plan 8");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("in a wide room the banner, the title, every section, and the footer start on one edge, centred", async () => {
  const { container } = await mount(createElement(Landing), WEB);
  const [first = Number.NaN, ...rest] = starts();
  for (const edge of rest) expect(Math.abs(edge - first)).toBeLessThanOrEqual(1);
  const room = box(frame(container));
  const column = box(page.getByRole("main").element());
  expect(Math.abs(column.left - room.left - (room.right - column.right))).toBeLessThanOrEqual(1);
  expect(column.width).toBeLessThan(room.width / 2);
});

test("in a phone's width everything starts on the profile's page inset", async () => {
  const { container } = await mount(createElement(Landing, { width: 320 }), WEB);
  const inset = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--luke-page-inset"),
  );
  for (const edge of starts()) {
    expect(Math.abs(edge - box(frame(container)).left - inset)).toBeLessThanOrEqual(1);
  }
});

test("the banner stands still at the top of the document's scroll while the page moves under it", async () => {
  const { container } = await mount(createElement(Landing), WEB);
  const banner = box(page.getByRole("banner").element());
  const last = page.getByText("Hand off 8", { exact: true });
  last.element().scrollIntoView({ block: "end" });
  await expect.element(last).toBeInViewport();
  expect(frame(container).scrollTop).toBeGreaterThan(0);
  expect(box(page.getByRole("banner").element()).toJSON()).toEqual(banner.toJSON());
  expect(box(heading("Plan with agents.", 1)).bottom).toBeLessThan(banner.top);
});

for (const width of [1440, 320]) {
  test(`at ${width}px every section follows the one before it at one rhythm`, async () => {
    await mount(createElement(Landing, { width }), WEB);
    const between = (before: string, after: string): number =>
      box(heading(after, 2)).top -
      box(page.getByText(`${before} 8`, { exact: true }).element()).bottom;
    expect(between("Talk", "Plan")).toBeGreaterThan(0);
    expect(Math.abs(between("Talk", "Plan") - between("Plan", "Hand off"))).toBeLessThanOrEqual(1);
  });
}

test("a phone sets its sections closer than a wide room does", async () => {
  const gap = (): number =>
    box(heading("Plan", 2)).top - box(page.getByText("Talk 8", { exact: true }).element()).bottom;
  const { container } = await mount(createElement(Landing), WEB);
  const wide = gap();
  container.remove();
  await mount(createElement(Landing, { width: 320 }), WEB);
  expect(gap()).toBeLessThan(wide);
});

test("the hero is set larger than a page title, and steps down in a phone's width", async () => {
  const size = (): number =>
    Number.parseFloat(getComputedStyle(heading("Plan with agents.", 1)).fontSize);
  const hero = await mount(createElement(Landing), WEB);
  const wideHero = size();
  hero.container.remove();
  const phone = await mount(createElement(Landing, { width: 320 }), WEB);
  const narrowHero = size();
  phone.container.remove();
  await mount(createElement(Landing, { titleStyle: PUBLIC_TITLE.PAGE }), WEB);
  expect(wideHero).toBeGreaterThan(size());
  expect(narrowHero).toBeLessThan(wideHero);
});

test("a word longer than a phone's column wraps inside it rather than scrolling the page sideways", async () => {
  const { container } = await mount(
    createElement(Landing, {
      width: 320,
      title: "acme-corporation-engineering-platform-workspace",
    }),
    WEB,
  );
  const room = frame(container);
  expect(room.scrollWidth).toBeLessThanOrEqual(room.clientWidth);
  expect(
    box(heading("acme-corporation-engineering-platform-workspace", 1)).right,
  ).toBeLessThanOrEqual(box(room).right);
});

test("a page with no title, banner, or footer draws only its main and its sections", async () => {
  await mount(
    createElement(PublicPage, {
      children: createElement(PublicSection, { children: lines("Line", 2) }),
    }),
    WEB,
  );
  expect(page.getByRole("heading").all().length).toBe(0);
  expect(page.getByRole("banner").all().length).toBe(0);
  expect(page.getByRole("contentinfo").all().length).toBe(0);
  expect(page.getByRole("main").element().textContent).toBe("Line 1Line 2");
});

test("a lead with no title still opens the page, above content that brings its own heading", async () => {
  await mount(
    createElement(PublicPage, {
      lead: "Read how Luke came to be.",
      children: createElement("h1", null, "About"),
    }),
    WEB,
  );
  const lead = page.getByText("Read how Luke came to be.");
  await expect.element(lead).toBeVisible();
  expect(box(heading("About", 1)).top).toBeGreaterThan(box(lead.element()).bottom);
});

test("a page that is a title alone closes as near under it as a page closes under its last section", async () => {
  const end = (last: Element): number =>
    box(page.getByRole("main").element()).bottom - box(last).bottom;
  const titled = await mount(createElement(PublicPage, { title: "About" }), WEB);
  const alone = end(heading("About", 1));
  titled.container.remove();
  await mount(
    createElement(PublicPage, {
      title: "About",
      children: createElement(PublicSection, { children: "Who we are" }),
    }),
    WEB,
  );
  expect(Math.abs(alone - end(page.getByText("Who we are").element()))).toBeLessThanOrEqual(1);
});
