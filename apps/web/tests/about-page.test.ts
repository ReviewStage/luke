// @vitest-environment jsdom
import assert from "node:assert/strict";
import { MARK_PROVIDER, PROVIDER_MARK_SIZE, ProviderMark } from "@luke/ui";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { test } from "vitest";
import { AboutPage } from "../src/AboutPage";

/**
 * The About page as the prerender writes it: one title, a heading per founder,
 * and each founder's profiles named for whom they belong to. The site's chrome
 * is site-chrome.test.ts's.
 */

/** The page's main as the prerender writes it. */
function main(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(createElement(AboutPage));
  const region = root.querySelector("main");
  assert.ok(region !== null);
  return region;
}

test("the page is titled About, with a heading under it for each founder", () => {
  const headings = Array.from(main().querySelectorAll("h1, h2, h3, h4, h5, h6"));
  assert.deepEqual(
    headings.map((heading) => `${heading.tagName} ${heading.textContent}`),
    ["H1 About", "H3 Charles Pan", "H3 Dean Stratakos"],
  );
});

test("each founder's profiles open in a new tab, named for the founder", () => {
  const links = Array.from(main().querySelectorAll("a"));
  assert.deepEqual(
    links.map((link) => `${link.getAttribute("aria-label")} -> ${link.getAttribute("href")}`),
    [
      "Charles Pan on LinkedIn -> https://www.linkedin.com/in/charleslpan/",
      "Charles Pan on X -> https://x.com/ceefryingpan",
      "Dean Stratakos on LinkedIn -> https://www.linkedin.com/in/dean-stratakos/",
      "Dean Stratakos on X -> https://x.com/DeanStratakos",
    ],
  );
  for (const link of links) assert.equal(link.getAttribute("target"), "_blank");
});

test("each founder's LinkedIn and X links draw their marks through ProviderMark", () => {
  const [linkedin, x] = [MARK_PROVIDER.LINKEDIN, MARK_PROVIDER.X].map((provider) =>
    renderToStaticMarkup(createElement(ProviderMark, { provider, size: PROVIDER_MARK_SIZE.ICON })),
  );
  const drawn = Array.from(main().querySelectorAll("a")).map(
    (link) => [link.getAttribute("aria-label"), link.querySelector("svg")?.outerHTML] as const,
  );
  assert.deepEqual(drawn, [
    ["Charles Pan on LinkedIn", linkedin],
    ["Charles Pan on X", x],
    ["Dean Stratakos on LinkedIn", linkedin],
    ["Dean Stratakos on X", x],
  ]);
});
