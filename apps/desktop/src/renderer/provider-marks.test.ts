// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { type MarkedProvider, ProviderMark } from "./provider-marks";
import { AccountSection } from "./settings/account-section";
import { SignInGate } from "./sign-in-gate";

/**
 * Every provider's mark as a row draws it: well-formed path data, since a
 * browser draws a path only up to its first malformed segment and leaves a
 * stray stroke where the brand should be, as Granola's once did, and its
 * artwork inside its own viewBox and filling it. Bounds are read from the
 * points each path passes through, which a curve never strays far beyond.
 * And every surface that names a provider the account signs in with or
 * connects draws that provider's one mark beside the name. Synthetic
 * accounts.
 */

/** How far, as a share of the viewBox, a mark may run past its edge or fall short of filling it. */
const SLACK = 0.02;
const FILL = 0.8;

/** How many numbers each path command takes per segment. */
const ARITY = new Map([
  ["M", 2],
  ["L", 2],
  ["T", 2],
  ["H", 1],
  ["V", 1],
  ["C", 6],
  ["S", 4],
  ["Q", 4],
  ["A", 7],
  ["Z", 0],
]);

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grow(bounds: Bounds | undefined, x: number, y: number): Bounds {
  if (bounds === undefined) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  };
}

/** The bounds of the points one path's segments end on. */
function pathBounds(d: string, start: Bounds | undefined): Bounds | undefined {
  let bounds = start;
  let [x, y, startX, startY] = [0, 0, 0, 0];
  for (const [, letter = "", args = ""] of d.matchAll(/([MLHVCSQTAZ])([^MLHVCSQTAZ]*)/gi)) {
    const command = letter.toUpperCase();
    const relative = letter !== command;
    const arity = ARITY.get(command);
    assert.ok(arity !== undefined, `unknown path command ${letter}`);
    if (command === "Z") {
      [x, y] = [startX, startY];
      continue;
    }
    const numbers = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) ?? []).map(Number);
    // Note that a browser stops drawing a path at its first malformed segment.
    assert.ok(numbers.length > 0 && numbers.length % arity === 0, `${letter}${args} is malformed`);
    for (let at = 0; at + arity <= numbers.length; at += arity) {
      const segment = numbers.slice(at, at + arity);
      const [endX = 0, endY = 0] = segment.slice(-2);
      if (command === "H") x = (relative ? x : 0) + (segment[0] ?? 0);
      else if (command === "V") y = (relative ? y : 0) + (segment[0] ?? 0);
      else [x, y] = relative ? [x + endX, y + endY] : [endX, endY];
      // A moveto's first pair starts a subpath; its others are linetos.
      if (command === "M" && at === 0) [startX, startY] = [x, y];
      bounds = grow(bounds, x, y);
    }
  }
  return bounds;
}

function markBounds(svg: Element): Bounds | undefined {
  let bounds: Bounds | undefined;
  for (const path of svg.querySelectorAll("path")) {
    bounds = pathBounds(path.getAttribute("d") ?? "", bounds);
  }
  for (const rect of svg.querySelectorAll("rect")) {
    const x = Number(rect.getAttribute("x") ?? 0);
    const y = Number(rect.getAttribute("y") ?? 0);
    bounds = grow(bounds, x, y);
    bounds = grow(
      bounds,
      x + Number(rect.getAttribute("width")),
      y + Number(rect.getAttribute("height")),
    );
  }
  return bounds;
}

const MARKED: readonly MarkedProvider[] = [...INTEGRATION_PROVIDER_LIST, ACCOUNT_PROVIDER.GOOGLE];

/** `element` drawn, as a page to query. */
function drawn(element: React.ReactElement): HTMLElement {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(element);
  return page;
}

/** The mark standing in `place`, as its markup. */
function markIn(place: Element | null | undefined): string | undefined {
  return place?.querySelector("svg.provider-mark")?.outerHTML;
}

/** The provider's own mark, as its markup. */
function markOf(provider: MarkedProvider): string {
  return drawn(createElement(ProviderMark, { provider })).innerHTML;
}

/** The Account section signed in with `provider`. */
function accountLine(provider: AccountProvider): HTMLElement {
  return drawn(
    createElement(AccountSection, {
      account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "ada@example.com", provider },
      onSignOut: () => Promise.resolve(),
      onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    }),
  );
}

test("every provider's mark lies inside its own box and fills it", () => {
  for (const provider of MARKED) {
    const markup = renderToStaticMarkup(createElement(ProviderMark, { provider }));
    const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    const [boxX = 0, boxY = 0, width = 0, height = 0] = (svg.getAttribute("viewBox") ?? "")
      .split(/[\s,]+/)
      .map(Number);
    const bounds = markBounds(svg);
    assert.ok(bounds, `${provider} draws nothing`);
    const [slackX, slackY] = [width * SLACK, height * SLACK];
    assert.ok(
      bounds.minX >= boxX - slackX &&
        bounds.minY >= boxY - slackY &&
        bounds.maxX <= boxX + width + slackX &&
        bounds.maxY <= boxY + height + slackY,
      `${provider} runs outside its viewBox`,
    );
    const filled = Math.max(
      (bounds.maxX - bounds.minX) / width,
      (bounds.maxY - bounds.minY) / height,
    );
    assert.ok(filled >= FILL, `${provider} fills ${Math.round(filled * 100)}% of its viewBox`);
  }
});

test("the sign-in buttons and the account's line each draw the provider's one mark beside its name", () => {
  const gate = drawn(
    createElement(SignInGate, {
      account: { status: ACCOUNT_STATUS.SIGNED_OUT },
      face: { play: 0 },
      onBegin: () => undefined,
      onCancel: () => undefined,
    }),
  );
  const button = (provider: AccountProvider) =>
    gate.querySelector(`button[data-provider="${provider}"]`);

  assert.equal(markIn(button(ACCOUNT_PROVIDER.GOOGLE)), markOf(ACCOUNT_PROVIDER.GOOGLE));
  assert.equal(markIn(button(ACCOUNT_PROVIDER.GITHUB)), markOf(ACCOUNT_PROVIDER.GITHUB));
  for (const provider of [ACCOUNT_PROVIDER.GOOGLE, ACCOUNT_PROVIDER.GITHUB]) {
    assert.equal(
      markIn(accountLine(provider).querySelector(".settings-copy small")),
      markOf(provider),
    );
  }
});
