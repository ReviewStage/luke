// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SettingsRow } from "@luke/ui";
import tokens from "@luke/ui/tokens.css?inline";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * landed.test.ts -- a row the view brought the eye to is lit as every place
 * landed on is (`@luke/ui/landed`): a wash that stands, then fades on the
 * motion tokens. Under reduced motion it is still lit, statically, for the
 * same stand, and only the fade is dropped, so a person jumped to a row
 * still sees where they landed. jsdom answers no media query, plays no
 * motion and resolves no `var()`, so the sheets are laid
 * (`testing/container-width.ts`), the motion tokens laid over them as the
 * window has them, the tokens' reduced-motion block over those where the
 * machine asks for it, and the light's timing is read as a browser reads it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The tokens' answer to reduced motion, the rules inside its media block. */
const REDUCED_MOTION = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/u;

/** A CSS time in milliseconds. */
const TIME = /^([\d.]+)(ms|s)$/u;

const roots: Root[] = [];
const laid: HTMLStyleElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const sheet of laid.splice(0)) sheet.remove();
  document.body.replaceChildren();
});

/** Lays `css` into the document, after what is laid. */
function lay(css: string): void {
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = css;
  laid.push(sheet);
}

/**
 * Lays the window's sheets with its motion tokens as the window has them,
 * since the sheets are laid held still, and the tokens' reduced motion
 * over them where `reduced`.
 */
function layMotion(reduced: boolean): void {
  laid.push(layContainersAt({}));
  lay(tokens);
  if (reduced)
    lay(REDUCED_MOTION.exec(tokens)?.[1] ?? assert.fail("the tokens answer reduced motion"));
}

/** A settings row drawn, landed on or not. */
function row(landed: boolean): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(SettingsRow, { label: "react-best-practices", landed })));
  return (
    container.querySelector<HTMLElement>(".luke-settings-row") ?? assert.fail("a row is drawn")
  );
}

/** `value` with every `var()` in it read as it stands at `element`. */
function resolved(element: Element, value: string): string {
  const style = getComputedStyle(element);
  return value
    .replace(/var\((--[\w-]+)\)/gu, (_, name: string) =>
      resolved(element, style.getPropertyValue(name).trim()),
    )
    .replace(/\s+/gu, " ")
    .trim();
}

/** How a place's light plays: its name, its fade and its stand in milliseconds, and its fill. */
function lightOf(element: Element): {
  name: string;
  fade: number;
  stand: number;
  fill: string;
} {
  const light = getComputedStyle(element).getPropertyValue("--luke-landed-light");
  assert.notEqual(light.trim(), "", "the place wears a light");
  const parts = resolved(element, light)
    .replace(/\([^)]*\)/gu, "")
    .split(" ");
  const [fade, stand] = parts.flatMap((part) => {
    const time = TIME.exec(part);
    return time === null ? [] : [Number(time[1]) * (time[2] === "s" ? 1000 : 1)];
  });
  return { name: parts[0] ?? "", fade: fade ?? 0, stand: stand ?? 0, fill: parts.at(-1) ?? "" };
}

test("a landed row is lit: a wash that stands, then fades on the motion tokens", () => {
  layMotion(false);
  const lit = row(true);

  assert.equal(
    lit.getAttribute("data-landed"),
    "within",
    "a row flush in its card is lit inside it",
  );
  const light = lightOf(lit);
  assert.equal(light.name, "luke-landed");
  assert.ok(light.stand > 0, "the wash stands before it fades");
  assert.ok(light.fade > 1, "the wash fades");
  assert.equal(light.fill, "both", "the wash is lit from the moment the row lands");

  assert.equal(row(false).hasAttribute("data-landed"), false, "a row not landed on is not lit");
});

test("under reduced motion a landed row is still lit, statically, for the same stand", () => {
  layMotion(false);
  const moving = lightOf(row(true));
  for (const sheet of laid.splice(0)) sheet.remove();
  document.body.replaceChildren();

  layMotion(true);
  const still = lightOf(row(true));
  assert.equal(still.stand, moving.stand, "the wash stands as long as it does in motion");
  assert.ok(still.stand > 0, "the row is marked");
  assert.ok(still.fade <= 1, "the wash leaves at once rather than fading");
  assert.equal(still.fill, "both", "the wash is lit through its stand, still");
});
