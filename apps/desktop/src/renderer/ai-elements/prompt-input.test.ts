// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  builtStylesheet,
  type CssRule,
  cssRules,
  layerOrder,
  type OwnDeclaration,
  ownDeclarations,
} from "#testing/css-rules";
import {
  COMPOSER_TYPE,
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputSubmitProps,
  PromptInputTextarea,
  PromptInputTools,
} from "./prompt-input";

/**
 * The one composer card both the New Plan page and the agent's message box
 * draw. Its part of the look is held as a contract on the stylesheet the
 * build bundles, since jsdom computes no cascade: the field grows with its
 * words from one line, its type is the card's one variable, the footer
 * holds the owner's slot at its left and the submit at its right, and the
 * submit is one round button whose glyph is drawn a colour apart from its
 * disc in every state, with the element resets in a layer under the
 * utilities so neither colour is the button's inherited one.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The card as an owner draws it: a controlled field, a slot at the foot's left, and the submit in the state the owner decides. */
function mount(props: {
  className?: string;
  left?: ReactNode;
  submit?: PromptInputSubmitProps;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        PromptInput,
        { className: props.className ?? "", onSubmit: () => undefined },
        createElement(PromptInputTextarea, { value: "", onChange: () => undefined }),
        createElement(
          PromptInputFooter,
          null,
          createElement(PromptInputTools, null, props.left),
          createElement(PromptInputSubmit, props.submit ?? {}),
        ),
      ),
    ),
  );
  return container;
}

/** A selector that styles every element of a kind, which only a reset may: a type or the universal selector, bare or with a pseudo-class. */
const RESET_SELECTOR = /^(?:\*|[a-z]+)(?::[a-z-]+)?$/u;

/** A token's value with every `var()` replaced by what the sheet sets it to at the root, so two tokens compare as the colours they are. */
function resolved(value: string, rules: readonly CssRule[]): string {
  const root = rules.filter((rule) => rule.selectors.includes(":root"));
  return value.replace(/var\((--[\w-]+)\)/gu, (whole, name: string) =>
    resolved(
      root.find((rule) => rule.declarations.has(name))?.declarations.get(name) ?? whole,
      rules,
    ),
  );
}

/** What an element's own classes settle a property to: a `:disabled` variant over the plain utility while disabled, the plain utility alone otherwise. */
function settled(own: readonly OwnDeclaration[], property: string, disabled = false): string {
  const of = (variant: boolean) =>
    own.filter((d) => d.property === property && d.selector.includes(":disabled") === variant);
  const [winner] = [...(disabled ? of(true) : []), ...of(false)];
  assert.ok(winner, `${property} is set${disabled ? " while disabled" : ""}`);
  return winner.value;
}

test("the field grows with its words from one line to about eight, in the type the card's one variable sets, which the hero card raises; the footer holds the owner's slot at its left and the submit at its right", async () => {
  const rules = cssRules(await builtStylesheet());
  const left = createElement("span", { className: "left-slot" }, "repository");
  const card = mount({ left });
  const field = card.querySelector("textarea");
  assert.ok(field);
  assert.equal(field.getAttribute("rows"), null, "no fixed line count");
  const own = ownDeclarations(rules, field);
  assert.equal(settled(own, "field-sizing"), "content");
  assert.equal(settled(own, "min-height"), "calc(1.45em + 24px)");
  assert.equal(settled(own, "max-height"), "calc(8 * 1.45em + 24px)");
  assert.equal(settled(own, "font-size"), "var(--composer-type)");

  // The size is one variable on the card, set by the card itself and raised by a hero owner.
  const form = card.querySelector("form");
  assert.ok(form);
  assert.equal(settled(ownDeclarations(rules, form), "--composer-type"), "13px");
  const hero = mount({ className: COMPOSER_TYPE.HERO }).querySelector("form");
  assert.ok(hero);
  assert.equal(settled(ownDeclarations(rules, hero), "--composer-type"), "17px");

  const footer = form.lastElementChild;
  assert.ok(footer);
  assert.equal(footer.firstElementChild?.querySelector(".left-slot")?.textContent, "repository");
  assert.equal(footer.lastElementChild?.tagName, "BUTTON");
});

test("the submit is one round button that never changes size or place, and the sheet draws its glyph a colour apart from its disc: filled while it takes a press, dimmed on the raised ground while it does not, with the reset in a layer under the utilities so neither colour is the button's inherited one", async () => {
  const sheet = await builtStylesheet();
  const rules = cssRules(sheet);
  const layers = layerOrder(sheet);
  const utilities = layers.indexOf("utilities");
  assert.ok(utilities >= 0, `the sheet layers its utilities: ${layers.join(", ")}`);
  // A rule for every button, or every element, sits in a layer under the utilities or it outranks every utility on one.
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!RESET_SELECTOR.test(selector) || ["html", "body"].includes(selector)) continue;
      const rank = rule.layer === undefined ? -1 : layers.indexOf(rule.layer);
      const shape = `${selector} { ${[...rule.declarations.keys()].join("; ")} }`;
      assert.ok(rank >= 0 && rank < utilities, `${shape} ranks under the utilities`);
    }
  }
  // The field is the panel's font on no border of the browser's, by the reset alone.
  const reset = rules.find((rule) => rule.selectors.includes("textarea"));
  assert.equal(reset?.declarations.get("font"), "inherit");
  assert.equal(reset?.declarations.get("border"), "0");
  const states = {
    dim: mount({ submit: { disabled: true } }),
    active: mount({}),
    stop: mount({ submit: { status: PROMPT_INPUT_STATUS.STREAMING } }),
  };
  const discs = new Map<string, string>();
  const classes = new Set<string>();
  for (const [name, card] of Object.entries(states)) {
    const button = card.querySelector("button");
    assert.ok(button, name);
    classes.add(button.className);
    assert.equal(button.getAttribute("aria-disabled") === "true", button.disabled, name);
    const own = ownDeclarations(rules, button);
    const disc = resolved(settled(own, "background-color", button.disabled), rules);
    const ink = resolved(settled(own, "color", button.disabled), rules);
    discs.set(name, disc);
    assert.doesNotMatch(disc, /var\(/u, `${name}: the disc resolves to a colour: ${disc}`);
    assert.doesNotMatch(ink, /var\(/u, `${name}: the ink resolves to a colour: ${ink}`);
    assert.notEqual(disc, ink, `${name}: the glyph is a colour apart from its disc`);
    assert.equal(settled(own, "border-radius"), "calc(infinity * 1px)");
    assert.equal(settled(own, "width"), "34px", name);
    assert.equal(settled(own, "height"), "34px", name);
    assert.equal(
      own.find((d) => d.selector.includes(":hover")),
      undefined,
      `${name}: nothing answers a hover`,
    );
    // The glyph is the button's own colour: nothing on the svg names one.
    const svg = button.querySelector("svg");
    assert.ok(svg, name);
    assert.equal(
      ownDeclarations(rules, svg).find((d) => d.property === "color"),
      undefined,
      name,
    );
  }
  assert.equal(classes.size, 1, "one class list in every state");
  // The dim disc is a lower emphasis of its own, not the filled one seen through an opacity.
  assert.notEqual(discs.get("dim"), discs.get("active"));
  assert.equal(discs.get("stop"), discs.get("active"));
  // Stop is the filled square where Send is the arrow.
  assert.ok(states.stop.querySelector("svg.fill-current"));
  assert.equal(states.active.querySelector("svg.fill-current"), null);
});
