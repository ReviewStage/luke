// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, useState } from "react";
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
import { AgentTabView } from "./agent-tab";
import { useAgentComposer } from "./use-agent-composer";

/**
 * The message box under an agent's transcript: one card that reads the
 * same whatever the agent is doing, one button that is Send or Stop, Enter
 * to send, a send that stands in the transcript at once and is reconciled
 * with the service's row, and Retry under the card carrying the failed
 * send's key again. The stylesheet's part is held as a contract, since
 * jsdom computes no cascade: a textarea reset to the panel's font with no
 * border of the browser's on base.css, and the button's colours on the
 * sheet the build bundles, where the reset sits in a layer under the
 * utilities so the arrow is drawn a colour apart from its disc.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const PLAN: CodingAgentMessage = {
  id: "m-plan",
  role: "user",
  parts: [{ type: "text", text: "# Teammate invitations\n\nInvite a teammate by email." }],
};

const RUNNING_AGENT = { agent: { ...AGENT, status: CODING_AGENT_STATUS.RUNNING } } as const;

const PLACEHOLDER = "Message the agent…";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A row of the developer's as the service writes one. */
function row(id: string, text: string): CodingAgentMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

interface Standing {
  status: CodingAgentStatus;
  messages: readonly CodingAgentMessage[];
}

/** One message sent, held until the test answers it. */
interface Sent {
  text: string;
  clientKey: string;
  answer: (answer: CodingAgentAgentAnswer) => void;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

const ignore = () => undefined;

/**
 * The tab mounted over a scripted service: every message sent is held
 * until the test answers it, every status the answer moved is written
 * down, and the transcript is whatever the test says the service holds.
 */
function mount(initial: Standing) {
  const sends: Sent[] = [];
  const statuses: CodingAgentStatus[] = [];
  let stops = 0;
  let restand: ((next: (was: Standing) => Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState(initial);
    restand = setHeld;
    const composer = useAgentComposer({
      agentId: AGENT_ID,
      messages: held.messages,
      send: (_agentId, text, clientKey) =>
        new Promise((answer) => {
          sends.push({ text, clientKey, answer });
        }),
      onStatus: (_agentId, status) => {
        statuses.push(status);
        setHeld((was) => ({ ...was, status }));
      },
    });
    return createElement(AgentTabView, {
      agent: { ...AGENT, status: held.status },
      models: undefined,
      transcript: { messages: held.messages, reading: false, failed: false, onRetry: ignore },
      composer,
      published: undefined,
      doors: { openGitHub: ignore, copy: ignore },
      onStop: () => {
        stops += 1;
        return Promise.resolve();
      },
      openGitHub: ignore,
      copyText: () => Promise.resolve(),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  const field = (): HTMLTextAreaElement => {
    const found = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(found, "the box is drawn");
    return found;
  };
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`.agent-composer button[aria-label="${label}"]`);
  return {
    container,
    sends,
    statuses,
    stops: () => stops,
    field,
    /** Types the words into the box, as a keyboard would. */
    type: (text: string) => {
      const box = field();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      assert.ok(setter);
      act(() => {
        setter.call(box, text);
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    /** One key pressed in the box; whether the box left its default to the browser. */
    key: (init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      act(() => {
        field().dispatchEvent(event);
      });
      return !event.defaultPrevented;
    },
    answer: async (index: number, answer: CodingAgentAgentAnswer) => {
      const sent = sends[index];
      assert.ok(sent, `message ${index} was sent`);
      await act(async () => {
        sent.answer(answer);
        await Promise.resolve();
      });
      await settle();
    },
    stand: async (next: Partial<Standing>) => {
      act(() => restand?.((was) => ({ ...was, ...next })));
      await settle();
    },
    /** The developer's bubbles in the transcript, by their words. */
    bubbles: () =>
      [...container.querySelectorAll('[role="log"] .is-user')].map((each) => each.textContent),
    /** The one button at the card's right: its name and whether it takes a press; none drawn reads as none. */
    control: () => {
      const buttons = [...container.querySelectorAll<HTMLButtonElement>(".agent-composer button")];
      const [one] = buttons.filter((each) => each.textContent !== "Retry");
      assert.equal(buttons.filter((each) => each.textContent !== "Retry").length, 1);
      if (one === undefined) return undefined;
      // A button that takes no press says so to assistive technology as well.
      assert.equal(one.getAttribute("aria-disabled") === "true", one.disabled);
      return { label: one.getAttribute("aria-label"), disabled: one.disabled, type: one.type };
    },
    send: () => button("Send"),
    stop: () => button("Stop"),
    note: () => container.querySelector('[role="alert"]')?.textContent ?? undefined,
    retry: () => container.querySelector<HTMLButtonElement>('[role="alert"] button'),
  };
}

test("the box reads the same running or idle: one placeholder, no hint, no queue, and no menu; Enter sends under a fresh key and Shift+Enter is the browser's new line", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  const same = () => {
    assert.equal(tab.field().placeholder, PLACEHOLDER);
    assert.equal(tab.container.querySelector(".agent-composer-hint"), null);
    assert.equal(tab.container.querySelector("[data-queued-id]"), null);
    assert.equal(tab.container.querySelector('[role="menu"], [aria-haspopup="menu"]'), null);
    assert.equal(tab.container.querySelectorAll(".agent-composer textarea").length, 1);
  };
  same();
  tab.type("Also expire them after a week.");

  // Shift+Enter is left to the browser, which is a new line; nothing goes.
  assert.equal(tab.key({ key: "Enter", shiftKey: true }), true);
  assert.equal(tab.sends.length, 0);

  assert.equal(tab.key({ key: "Enter" }), false);
  assert.deepEqual(
    tab.sends.map(({ text }) => text),
    ["Also expire them after a week."],
  );
  assert.match(tab.sends[0]?.clientKey ?? "", UUID);
  await tab.answer(0, RUNNING_AGENT);

  // Idle, the box is the same box, and a modified Enter has no meaning of its own: it sends.
  await tab.stand({ status: CODING_AGENT_STATUS.COMPLETED });
  same();
  tab.type("And the docs.");
  assert.equal(tab.key({ key: "Enter", altKey: true }), false);
  assert.equal(tab.sends.length, 2);
  assert.equal(tab.sends[1]?.text, "And the docs.");
  assert.notEqual(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
  await tab.stand({ status: CODING_AGENT_STATUS.STARTING });
  same();
});

test("the one button is Send with words, disabled with none while the agent is idle or starting, and Stop with none while a turn runs; Stop stops the agent, and Enter on an empty box does nothing", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
  tab.type("Also handle the empty case.");
  assert.deepEqual(tab.control(), { label: "Send", disabled: false, type: "submit" });
  tab.type("");
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });

  await tab.stand({ status: CODING_AGENT_STATUS.RUNNING });
  assert.deepEqual(tab.control(), { label: "Stop", disabled: false, type: "button" });
  assert.equal(tab.key({ key: "Enter" }), false);
  assert.equal(tab.sends.length, 0);
  assert.equal(tab.stops(), 0);
  tab.type("Push what you have.");
  assert.deepEqual(tab.control(), { label: "Send", disabled: false, type: "submit" });
  tab.type("");
  const stop = tab.stop();
  assert.ok(stop);
  await act(async () => {
    stop.click();
    await Promise.resolve();
  });
  assert.equal(tab.stops(), 1);
  assert.equal(tab.container.querySelector("header button"), null);

  // A starting agent has no turn the service could cancel yet, so Stop waits for one.
  await tab.stand({ status: CODING_AGENT_STATUS.STARTING });
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
});

test("a send stands in the transcript at once as the developer's line and holds the box; the service's answer moves the status and frees it, and the service's own row takes the line's place", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  tab.type("Also expire them after a week.");
  tab.key({ key: "Enter" });
  assert.equal(tab.field().value, "");
  assert.equal(tab.field().disabled, true);
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);

  await tab.answer(0, RUNNING_AGENT);
  assert.equal(tab.field().disabled, false);
  assert.deepEqual(tab.statuses, [CODING_AGENT_STATUS.RUNNING]);
  assert.deepEqual(tab.control(), { label: "Stop", disabled: false, type: "button" });

  // The service's own row for the line arrives, and takes the line's place: one bubble, not two.
  await tab.stand({ messages: [PLAN, row("m-1", "Also expire them after a week.")] });
  assert.deepEqual(tab.bubbles(), ["Also expire them after a week."]);
});

test("a message that did not go comes back into the box with why under the card and Retry, which sends it again under the same key; an edit is a new message under a new key; an agent ended for good keeps the box, disabled, with the reason and no Retry", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Then add tests.");
  tab.key({ key: "Enter" });
  assert.deepEqual(tab.bubbles(), ["Then add tests."]);

  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
  assert.equal(tab.field().value, "Then add tests.");
  assert.equal(tab.field().disabled, false);
  assert.deepEqual(tab.bubbles(), []);
  assert.match(tab.note() ?? "", /still starting/u);

  const retry = tab.retry();
  assert.ok(retry);
  act(() => retry.click());
  assert.deepEqual(
    tab.sends.map(({ text }) => text),
    ["Then add tests.", "Then add tests."],
  );
  assert.equal(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
  assert.equal(tab.note(), undefined);

  // Editing the words is a new message: Retry goes with the edit, and the edit goes under a key of its own.
  await tab.answer(1, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.match(tab.note() ?? "", /didn't hear back/u);
  tab.type("Then add tests and docs.");
  assert.equal(tab.note(), undefined);
  assert.equal(tab.retry(), null);
  tab.key({ key: "Enter" });
  assert.equal(tab.sends[2]?.text, "Then add tests and docs.");
  assert.notEqual(tab.sends[2]?.clientKey, tab.sends[0]?.clientKey);

  await tab.answer(2, { failure: CODING_AGENT_CALL_FAILURE.AGENT_RETIRED });
  assert.equal(tab.field().placeholder, PLACEHOLDER);
  assert.equal(tab.field().disabled, true);
  assert.match(tab.note() ?? "", /ended for good/u);
  assert.equal(tab.retry(), null);
  assert.deepEqual(tab.control(), { label: "Send", disabled: true, type: "submit" });
});

test("a send whose answer was lost and whose row has since landed is read back by that row when Retry sends it again under the same key, so the line is drawn once", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(tab.bubbles(), []);
  // The service had taken the words after all: its row lands before Retry is pressed.
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  const retry = tab.retry();
  assert.ok(retry);
  act(() => retry.click());
  assert.equal(tab.sends[1]?.clientKey, tab.sends[0]?.clientKey);
  // The service answers the repeat with nothing new written: the row that stands is the line's.
  await tab.answer(1, RUNNING_AGENT);
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  assert.equal(tab.field().value, "");
});

test("a send whose row lands while its request is still out, and whose answer is then lost, is read as taken: the box stays clear, nothing says Retry, and the line is drawn once", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(tab.bubbles(), ["Add tests."]);
  assert.equal(tab.field().value, "");
  assert.equal(tab.field().disabled, false);
  assert.equal(tab.note(), undefined);
  assert.equal(tab.retry(), null);
});

test("two lines of the same words sent before either is read back are read back one row at a time, across pages", async () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.answer(0, RUNNING_AGENT);
  tab.type("Add tests.");
  tab.key({ key: "Enter" });
  await tab.answer(1, RUNNING_AGENT);
  assert.deepEqual(tab.bubbles(), ["Add tests.", "Add tests."]);

  // The first row lands on its own page: one line is read back, the other still stands.
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests.", "Add tests."]);
  await tab.stand({ messages: [PLAN, row("m-1", "Add tests."), row("m-2", "Add tests.")] });
  assert.deepEqual(tab.bubbles(), ["Add tests.", "Add tests."]);
});

test("the box takes focus as the tab opens unless the developer is typing elsewhere, Escape leaves it, and an empty box sends nothing", () => {
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(document.activeElement, tab.field());
  tab.key({ key: "Escape" });
  assert.notEqual(document.activeElement, tab.field());
  tab.type("   ");
  assert.equal(tab.key({ key: "Enter" }), false);
  assert.deepEqual(tab.sends, []);

  const editor = document.createElement("input");
  document.body.append(editor);
  editor.focus();
  const other = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.equal(document.activeElement, editor);
  assert.notEqual(document.activeElement, other.field());
});

test("the stylesheet resets a textarea to the panel's font with no border and no surface of the browser's, since Tailwind's preflight is left out, so the box is the card's and never a monospace well", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "styles", "base.css"), "utf8");
  const rule = cssRules(css).find((each) => each.selectors.includes("textarea"));
  assert.ok(rule, "base.css resets the textarea element");
  assert.equal(rule.layer, "base");
  const reset: readonly (readonly [property: string, value: string])[] = [
    ["font", "inherit"],
    ["border", "0"],
    ["background", "none"],
    ["color", "inherit"],
  ];
  for (const [property, expected] of reset) {
    assert.equal(rule.declarations.get(property), expected, property);
  }
  // Nothing of the box's own names a font: the field is the panel's font by the reset alone.
  const tab = mount({ status: CODING_AGENT_STATUS.RUNNING, messages: [PLAN] });
  assert.doesNotMatch(tab.field().className, /font-mono|font-\[/u);
  assert.equal(tab.container.querySelector("form.agent-composer-form")?.tagName, "FORM");
});

/** A selector that styles every element of a kind, which only a reset may: a type or the universal selector, bare or with a pseudo-class. */
const RESET_SELECTOR = /^(?:\*|[a-z]+)(?::[a-z-]+)?$/u;

/** The custom properties the sheet sets at the root, which a utility's `var()` resolves through. */
function rootProperties(rules: readonly CssRule[]): ReadonlyMap<string, string> {
  const properties = new Map<string, string>();
  for (const rule of rules) {
    if (
      !rule.selectors.some((selector) =>
        selector.split(",").some((each) => each.trim() === ":root"),
      )
    )
      continue;
    for (const [property, value] of rule.declarations) {
      if (property.startsWith("--")) properties.set(property, value);
    }
  }
  return properties;
}

/** A value with every `var()` replaced by what the root sets it to, so two tokens compare as the colours they are. */
function resolved(value: string, root: ReadonlyMap<string, string>): string {
  let out = value;
  for (let round = 0; round < 8 && out.includes("var("); round += 1) {
    out = out.replace(
      /var\((--[\w-]+)(?:,\s*([^)]*))?\)/gu,
      (whole, name: string, fallback?: string) => root.get(name) ?? fallback ?? whole,
    );
  }
  return out;
}

/** A resolved length in pixels at the root's 16px, for a utility's `rem` or `calc(rem * n)`. */
function pixels(value: string): number {
  const length = (text: string): number | undefined => {
    const px = /^([\d.]+)px$/u.exec(text);
    if (px?.[1] !== undefined) return Number(px[1]);
    const rem = /^([\d.]+)rem$/u.exec(text);
    if (rem?.[1] !== undefined) return Number(rem[1]) * 16;
    return undefined;
  };
  const direct = length(value.trim());
  if (direct !== undefined) return direct;
  const product = /^calc\(\s*(\S+)\s*\*\s*([\d.]+)\s*\)$/u.exec(value.trim());
  const unit = product?.[1] === undefined ? undefined : length(product[1]);
  assert.ok(product?.[2] !== undefined && unit !== undefined, `a length: ${value}`);
  return unit * Number(product[2]);
}

/** What the button's own classes settle a property to in its state: a `:disabled` variant over the plain utility while disabled, the plain utility alone otherwise. */
function settled(own: readonly OwnDeclaration[], property: string, disabled: boolean): string {
  const of = (variant: boolean) =>
    own.filter(
      (each) => each.property === property && each.selector.includes(":disabled") === variant,
    );
  const [winner] = [...(disabled ? of(true) : []), ...of(false)];
  assert.ok(winner, `${property} is set${disabled ? " while disabled" : ""}`);
  return winner.value;
}

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
      assert.ok(
        rank >= 0 && rank < utilities,
        `${shape} ranks under the utilities (${rule.layer ?? "no layer"})`,
      );
    }
  }
  const root = rootProperties(rules);

  const tab = mount({ status: CODING_AGENT_STATUS.COMPLETED, messages: [PLAN] });
  const buttons: { name: string; button: HTMLButtonElement }[] = [];
  // A copy of the button as it stands, since React keeps the one element across the states.
  const hold = (name: string) => {
    const button = tab.container.querySelector(".agent-composer button")?.cloneNode(true);
    assert.ok(button instanceof HTMLButtonElement, name);
    buttons.push({ name, button });
  };
  hold("dim");
  tab.type("Also handle the empty case.");
  hold("active");
  tab.type("");
  await tab.stand({ status: CODING_AGENT_STATUS.RUNNING });
  hold("stop");
  assert.deepEqual(
    buttons.map(({ button }) => button.disabled),
    [true, false, false],
  );
  assert.equal(
    new Set(buttons.map(({ button }) => button.className)).size,
    1,
    "one class list in every state",
  );

  const discs = new Map<string, string>();
  for (const { name, button } of buttons) {
    const own = ownDeclarations(rules, button);
    const disc = resolved(settled(own, "background-color", button.disabled), root);
    const ink = resolved(settled(own, "color", button.disabled), root);
    discs.set(name, disc);
    assert.doesNotMatch(disc, /var\(/u, `${name}: the disc resolves to a colour: ${disc}`);
    assert.doesNotMatch(ink, /var\(/u, `${name}: the ink resolves to a colour: ${ink}`);
    assert.notEqual(disc, ink, `${name}: the glyph is a colour apart from its disc`);
    assert.equal(settled(own, "border-radius", false), resolved("calc(infinity * 1px)", root));
    assert.equal(pixels(resolved(settled(own, "width", false), root)), 28, name);
    assert.equal(pixels(resolved(settled(own, "height", false), root)), 28, name);
    // The glyph is the button's own colour: nothing on the svg names one, and its box is not zero.
    const svg = button.querySelector("svg");
    assert.ok(svg, name);
    const glyph = ownDeclarations(rules, svg);
    assert.equal(
      glyph.find((each) => each.property === "color"),
      undefined,
      name,
    );
    assert.ok(pixels(resolved(settled(glyph, "width", false), root)) > 0, name);
    assert.ok(pixels(resolved(settled(glyph, "height", false), root)) > 0, name);
  }
  // The dim disc is a lower emphasis of its own, not the filled one seen through an opacity.
  assert.notEqual(discs.get("dim"), discs.get("active"));
  assert.equal(discs.get("stop"), discs.get("active"));
  // Nothing on the button answers a hover: a disabled button has none, and the pressed one reads as it is.
  for (const { button } of buttons) {
    assert.equal(
      ownDeclarations(rules, button).find((each) => each.selector.includes(":hover")),
      undefined,
    );
  }
});
