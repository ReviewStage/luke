// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
} from "@sidecar/hosted/plan-document-template";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "#shared/messages/acts";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { ToastHost } from "../toast";
import { PlanTemplateSection } from "./plan-template-page";

const CUSTOM = "## Why\n\nWhat prompted it.\n\n## Done when\n";

/** The service's template as the test's bridge holds it: the account's own, or null for the default. */
let stored: string | null = null;
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Whether the read is answered with a failure rather than the template. */
let refuseRead = false;
/** Whether a write is answered with a failure rather than the template kept. */
let refuseWrites = false;
/** Whether writes wait to be answered until the test lets them land, in order. */
let holdWrites = false;
/** The held writes' answers, each landing when called. */
let heldWrites: (() => void)[] = [];

/** A done outcome carrying one kind's own answer. */
const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

const answered = () => ({ template: stored ?? DEFAULT_PLAN_TEMPLATE, custom: stored !== null });

const failed = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The bridge, answering the page's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.PLAN_TEMPLATE_READ:
      return Promise.resolve(done(refuseRead ? failed : answered()));
    case ACT_KIND.PLAN_TEMPLATE_WRITE: {
      if (refuseWrites) return Promise.resolve(done(failed));
      const { template } = request.payload;
      const land = () => {
        stored = template;
        return done(answered());
      };
      if (!holdWrites) return Promise.resolve(land());
      return new Promise((answer) => heldWrites.push(() => answer(land())));
    }
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = null;
  sent = [];
  refuseRead = false;
  refuseWrites = false;
  holdWrites = false;
  heldWrites = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

const settled = Effect.promise(settle);

/** The page, on the atoms `registry` holds where one is given. */
async function mount(signedIn = true, registry?: AtomRegistry) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const page = createElement(PlanTemplateSection, { signedIn });
  act(() => root.render(registry === undefined ? page : onRegistry(registry, page)));
  await settle();
  return { container, root };
}

/** The page beside the window's toasts, as two roots, so the page can go while the toasts stay. */
async function mountWithToasts(registry: AtomRegistry) {
  const host = document.createElement("div");
  document.body.append(host);
  const toasts = createRoot(host);
  roots.push(toasts);
  act(() =>
    toasts.render(onRegistry(registry, createElement(Fragment, null, createElement(ToastHost)))),
  );
  return mount(true, registry);
}

const box = (page: HTMLElement) =>
  page.querySelector<HTMLTextAreaElement>("textarea") ?? assert.fail("no template box");

/** Types into the box the way React hears a keystroke: the value set, then the input event. */
function typeInto(area: HTMLTextAreaElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(area: HTMLTextAreaElement): void {
  act(() => {
    area.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
    each.textContent?.includes(text),
  );

/** The templates the page wrote, in order: the text, or null for a reset. */
const writes = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.PLAN_TEMPLATE_WRITE ? [request.payload.template] : [],
  );

test("the page reads the template as it opens and draws it in a box the recording does not capture, with no reset while it is the default", async () => {
  const { container } = await mount();

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.PLAN_TEMPLATE_READ],
  );
  assert.equal(box(container).value, DEFAULT_PLAN_TEMPLATE);
  assert.ok(box(container).closest(".ph-no-capture"), "the box stands under the recording's mask");
  assert.match(container.textContent ?? "", /New plans start as a copy of this template/u);
  assert.equal(button(container, "Reset to default"), undefined);
});

test("signed out, the page says the template needs an account and asks the service nothing", async () => {
  const { container } = await mount(false);

  assert.match(container.textContent ?? "", /Sign in to edit the template/u);
  assert.equal(container.querySelector("textarea"), null);
  assert.deepEqual(sent, []);
});

it.effect("typing saves the typed words once, a second after the last keystroke", () =>
  Effect.gen(function* () {
    const registry = yield* registryOnTestClock;
    const { container } = yield* Effect.promise(() => mount(true, registry));

    typeInto(box(container), "## Why");
    yield* TestClock.adjust(Duration.millis(600));
    typeInto(box(container), "## Why\n\nWhat prompted it.");
    yield* TestClock.adjust(Duration.millis(600));
    yield* settled;
    assert.deepEqual(writes(), [], "nothing is sent while the typing goes on");

    yield* TestClock.adjust(Duration.millis(400));
    yield* settled;
    assert.deepEqual(writes(), ["## Why\n\nWhat prompted it."]);
    assert.match(container.textContent ?? "", /Saved/u);
    assert.ok(button(container, "Reset to default"), "the account now holds its own");
  }),
);

it.effect("a save after a pause that fails is tried once, and again only on Retry", () =>
  Effect.gen(function* () {
    refuseWrites = true;
    const registry = yield* registryOnTestClock;
    const { container } = yield* Effect.promise(() => mount(true, registry));

    typeInto(box(container), CUSTOM);
    yield* TestClock.adjust(Duration.seconds(1));
    yield* settled;
    yield* settled;
    assert.deepEqual(writes(), [CUSTOM]);
    assert.match(
      container.querySelector('[role="alert"]')?.textContent ?? "",
      /could not be saved/u,
    );

    refuseWrites = false;
    act(() => button(container, "Retry")?.click());
    yield* settled;
    assert.deepEqual(writes(), [CUSTOM, CUSTOM]);
    assert.match(container.textContent ?? "", /Saved/u);
  }),
);

test("the box losing focus saves the words at once, and leaving the page saves words still waiting", async () => {
  const first = await mount();
  typeInto(box(first.container), CUSTOM);
  blur(box(first.container));
  await settle();
  assert.deepEqual(writes(), [CUSTOM]);

  const second = await mount();
  typeInto(box(second.container), `${CUSTOM}\n## Risks\n`);
  act(() => second.root.unmount());
  await settle();
  assert.deepEqual(writes(), [CUSTOM, `${CUSTOM}\n## Risks\n`]);
});

test("words typed while a save is out are saved once it answers, one write at a time", async () => {
  holdWrites = true;
  const { container } = await mount();
  typeInto(box(container), "## Why");
  blur(box(container));
  await settle();
  assert.match(container.textContent ?? "", /Saving…/u);

  typeInto(box(container), CUSTOM);
  blur(box(container));
  await settle();
  assert.deepEqual(writes(), ["## Why"], "the second waits on the first");

  act(() => heldWrites.shift()?.());
  await settle();
  assert.deepEqual(writes(), ["## Why", CUSTOM]);
  act(() => heldWrites.shift()?.());
  await settle();
  assert.equal(stored, CUSTOM);
  assert.match(container.textContent ?? "", /Saved/u);
});

test("Reset to default asks first; Cancel keeps the template, and Reset writes null and shows the default", async () => {
  stored = CUSTOM;
  const { container } = await mount();
  assert.equal(box(container).value, CUSTOM);

  act(() => button(container, "Reset to default")?.click());
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
  assert.ok(dialog, "the reset asks first");
  assert.match(dialog.textContent ?? "", /Reset plan template\?/u);
  assert.equal(document.activeElement, button(dialog, "Cancel"), "Cancel holds the focus");
  assert.ok(button(dialog, "Reset")?.classList.contains("danger-button"), "the act is red");
  act(() => button(dialog, "Cancel")?.click());
  await settle();
  assert.deepEqual(writes(), []);
  assert.equal(box(container).value, CUSTOM);

  act(() => button(container, "Reset to default")?.click());
  const asked = document.querySelector<HTMLElement>('[role="alertdialog"]');
  assert.ok(asked);
  act(() => [...asked.querySelectorAll("button")].at(-1)?.click());
  await settle();
  assert.deepEqual(writes(), [null]);
  assert.equal(box(container).value, DEFAULT_PLAN_TEMPLATE);
  assert.equal(button(container, "Reset to default"), undefined);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a reset while a save is out waits for it, so the default is what the service keeps", async () => {
  stored = CUSTOM;
  holdWrites = true;
  const { container } = await mount();
  typeInto(box(container), `${CUSTOM}\n## Risks\n`);
  blur(box(container));
  await settle();

  act(() => button(container, "Reset to default")?.click());
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
  assert.ok(dialog);
  act(() => [...dialog.querySelectorAll("button")].at(-1)?.click());
  await settle();
  assert.deepEqual(writes(), [`${CUSTOM}\n## Risks\n`], "the null waits on the save out");

  act(() => heldWrites.shift()?.());
  await settle();
  assert.deepEqual(writes(), [`${CUSTOM}\n## Risks\n`, null]);
  act(() => heldWrites.shift()?.());
  await settle();
  assert.equal(stored, null);
  assert.equal(box(container).value, DEFAULT_PLAN_TEMPLATE);
  assert.deepEqual(heldWrites, [], "nothing more is sent after the reset");
});

it.effect(
  "words left unsaved as the page goes that fail to save are said in a toast whose Retry saves them",
  () =>
    Effect.gen(function* () {
      refuseWrites = true;
      const registry = yield* registryOnTestClock;
      const { container, root } = yield* Effect.promise(() => mountWithToasts(registry));
      typeInto(box(container), CUSTOM);
      act(() => root.unmount());
      yield* settled;
      assert.match(newestToastSays() ?? "", /Your plan template could not be saved/u);

      refuseWrites = false;
      const retry = newestToastAction();
      assert.equal(retry?.textContent, "Retry");
      act(() => retry?.click());
      yield* settled;
      assert.deepEqual(writes(), [CUSTOM, CUSTOM]);
      assert.equal(stored, CUSTOM);
    }),
);

test("a read that fails says so with a Retry, which reads the template again", async () => {
  refuseRead = true;
  const { container } = await mount();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /could not be read/u);
  assert.equal(container.querySelector("textarea"), null);

  refuseRead = false;
  act(() => button(container, "Retry")?.click());
  await settle();
  assert.equal(box(container).value, DEFAULT_PLAN_TEMPLATE);
});

test("a save that fails says so with a Retry and keeps the words, and Retry saves them", async () => {
  refuseWrites = true;
  const { container } = await mount();
  typeInto(box(container), CUSTOM);
  blur(box(container));
  await settle();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /could not be saved/u);
  assert.equal(box(container).value, CUSTOM);

  refuseWrites = false;
  act(() => button(container, "Retry")?.click());
  await settle();
  assert.deepEqual(writes(), [CUSTOM, CUSTOM]);
  assert.equal(stored, CUSTOM);
  assert.equal(container.querySelector('[role="alert"]'), null);
});

test("a template past the bound says so and is never sent; back within it, it saves", async () => {
  const { container } = await mount();
  const long = "x".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS + 1);

  typeInto(box(container), long);
  blur(box(container));
  await settle();
  assert.match(
    container.querySelector('[role="alert"]')?.textContent ?? "",
    /too long to save\. Keep it to 20,000 characters/u,
  );
  act(() => roots.at(-1)?.unmount());
  await settle();
  assert.deepEqual(writes(), [], "neither the blur nor leaving sends it");

  const again = await mount();
  typeInto(box(again.container), long.slice(1));
  blur(box(again.container));
  await settle();
  assert.deepEqual(writes(), [long.slice(1)]);
  assert.equal(again.container.querySelector('[role="alert"]'), null);
});
