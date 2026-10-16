import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Button } from "../button/button.js";
import { Inline } from "../layout/layout.js";
import { AVATAR_SIZE, Avatar } from "./avatar.js";

/**
 * avatar.browser.test.ts -- a picture, a letter, a picture that failed, and
 * a blank name all stand in one box per size; the letter stands until the
 * picture loads and comes back where it fails; and the disc names its person
 * to a reader once, at a contrast every hue holds on every surface.
 */

/** A synthetic picture drawn in place, so the test reaches no network. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#c8553d"/></svg>',
)}`;

/** An address whose bytes are no picture. */
const BROKEN = "data:image/png;base64,AAAA";

function discs(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".luke-avatar")];
}

/** Waits until every picture has loaded and every broken one has been given up. */
async function settled(container: HTMLElement): Promise<void> {
  await expect
    .poll(() =>
      [...container.querySelectorAll("img")].every(
        (picture) => picture.getAttribute("data-loaded") === "true",
      ),
    )
    .toBe(true);
}

test("a picture, a letter, a failed picture, and a blank name stand in one box per size, each larger than the last", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      Object.values(AVATAR_SIZE).map((size) =>
        createElement(Inline, {
          key: size,
          children: [
            createElement(Avatar, { key: "picture", name: "Ada Lovelace", src: PICTURE, size }),
            createElement(Avatar, { key: "letter", name: "Ada Lovelace", size }),
            createElement(Avatar, { key: "failed", name: "Ada Lovelace", src: BROKEN, size }),
            createElement(Avatar, { key: "blank", name: " ", size }),
          ],
        }),
      ),
    ),
  );
  await settled(container);
  const rows = [...container.querySelectorAll(".luke-inline")];
  let previous = 0;
  for (const row of rows) {
    const boxes = discs(row).map((disc) => disc.getBoundingClientRect());
    const [first] = boxes;
    if (first === undefined) throw new Error("not drawn");
    for (const box of boxes) {
      expect(box.width).toBe(first.width);
      expect(box.height).toBe(first.width);
      expect(box.top).toBe(first.top);
    }
    expect(first.width).toBeGreaterThan(previous);
    previous = first.width;
  }
});

test("the letter stands until the picture loads, and stands again where the picture fails", async () => {
  const { container } = await mount(
    createElement(
      Inline,
      null,
      createElement(Avatar, { name: "ada", src: PICTURE }),
      createElement(Avatar, { name: "ada", src: BROKEN }),
      createElement(Avatar, { name: "ada" }),
    ),
  );
  await settled(container);
  const [loaded, failed, lettered] = discs(container);
  expect(loaded?.textContent).toBe("");
  expect(loaded?.querySelector("img")?.naturalWidth).toBeGreaterThan(0);
  expect(failed?.textContent).toBe("A");
  expect(failed?.querySelector("img")).toBeNull();
  expect(lettered?.textContent).toBe("A");
});

/** A disc whose picture a button takes away and gives back. */
function Toggled({ src }: { src: string }): React.JSX.Element {
  const [given, setGiven] = useState(true);
  return createElement(
    "div",
    null,
    createElement(Avatar, given ? { name: "ada", src } : { name: "ada" }),
    createElement(Button, { onClick: () => setGiven(!given), children: "Toggle picture" }),
  );
}

test("a picture that failed is asked for again once its address is taken away and given back", async () => {
  let failures = 0;
  const counted = (event: Event): void => {
    if (event.target instanceof HTMLImageElement) failures += 1;
  };
  // An image's error does not bubble, so it is counted on its way down.
  document.addEventListener("error", counted, true);
  try {
    await mount(createElement(Toggled, { src: BROKEN }));
    await expect.poll(() => failures).toBe(1);
    const toggle = page.getByRole("button", { name: "Toggle picture" });
    await toggle.click();
    await toggle.click();
    await expect.poll(() => failures).toBe(2);
  } finally {
    document.removeEventListener("error", counted, true);
  }
});

test("a name with no character to draw stands as the figure, said to nobody", async () => {
  const { container } = await mount(createElement(Avatar, { name: "  " }));
  const [disc] = discs(container);
  expect(disc?.querySelector("svg")).not.toBeNull();
  expect(disc?.getAttribute("aria-hidden")).toBe("true");
});

test("the disc names its person to a reader, and a decorative one beside the name says nothing", async () => {
  const { container } = await mount(
    createElement(
      "p",
      null,
      createElement(Avatar, { name: "Grace Hopper" }),
      createElement(Avatar, { name: "Ada Lovelace", decorative: true }),
      "Ada Lovelace",
    ),
  );
  await expect.element(page.getByRole("img", { name: "Grace Hopper" })).toBeInTheDocument();
  expect(page.getByRole("img", { name: "Ada Lovelace" }).elements()).toEqual([]);
  expect(await accessibilityViolations(container)).toEqual([]);
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`every hue holds its letter at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    // Ids one character long hash to each of the six hues in turn.
    const { container } = await mount(
      createElement(
        Inline,
        null,
        ["1", "2", "3", "4", "5", "6"].map((id) =>
          createElement(Avatar, { key: id, id, name: `Person ${id}`, size: AVATAR_SIZE.CARD }),
        ),
      ),
      surface,
    );
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}
