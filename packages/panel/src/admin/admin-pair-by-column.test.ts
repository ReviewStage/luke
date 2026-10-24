// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AdminSection } from "./charts/stat-card.js";

/**
 * admin-pair-by-column.test.ts -- the admin's cards and charts pair up by the
 * column they stand in, never by the browser window. A viewport variant
 * (`min-[720px]:`) lays two charts side by side in a window that leaves their
 * column a third of that, so each rule names the container it reads
 * (`@min-[720px]/admin-section:`), and a section draws that container round
 * what it holds. jsdom lays nothing out, so the rules are read from the
 * sources and the container from the markup.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** Every admin source that draws markup. */
function adminSources(): { name: string; text: string }[] {
  const folder = dirname(fileURLToPath(import.meta.url));
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({ name, text: readFileSync(join(folder, name), "utf8") }));
}

test("no admin rule reads the window's width", () => {
  const viewport = /(?<![@\w-])(?:min|max)-\[[^\]]+\]:|(?<![@\w-])(?:sm|md|lg|xl|2xl):/;
  for (const { name, text } of adminSources()) {
    expect(text.match(viewport), `${name} reads the viewport`).toBeNull();
  }
});

test("a section stands round its charts as the container their pairs read", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(AdminSection, {
        title: "Why work failed",
        children: createElement("p", null, "a chart"),
      }),
    ),
  );

  const chart = container.querySelector("p");
  expect(chart?.closest(".\\@container\\/admin-section")).not.toBeNull();
});
