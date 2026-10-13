// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateRevisionLine,
} from "@sidecar/hosted/plan-document-template";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
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
import { builtStylesheet, cssRules } from "#testing/css-rules";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { newestToastAction, newestToastSays } from "#testing/toast";
import type { PlanEditorModule, PlanEditorProps } from "../plan-editor/contract";
import { ToastHost } from "../toast";
import { PlanTemplatePage } from "./plan-template-page";

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
/** How many times the page asked for the template's version history. */
let historyAsked = 0;
/** The template's newest revision as the service lists it; none for a template never edited. */
let newest: PlanTemplateRevisionLine | undefined;
/** Whether the history's read never answers, as a stalled service's would not. */
let stallRevisions = false;

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
    case ACT_KIND.PLAN_TEMPLATE_REVISIONS:
      if (stallRevisions) return new Promise(() => undefined);
      return Promise.resolve(done({ revisions: newest === undefined ? [] : [newest] }));
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

/**
 * The plan editor's bundle, TipTap, is tested beside it (`../plan-editor/`).
 * Here a stand-in takes its place at its one boundary, `window.lukePlanEditor`:
 * a plain box that hands over its whole text on each input, as the editor
 * does on each change, and finishes on Esc in the first section.
 */
const built: { props: PlanEditorProps; destroyed: boolean }[] = [];

const STAND_IN: PlanEditorModule = {
  mount: (host, props) => {
    const editor = { props, destroyed: false };
    built.push(editor);
    const area = document.createElement("textarea");
    area.value = props.markdown;
    area.setAttribute("aria-label", props.label);
    area.addEventListener("input", () => props.onDraft(area.value));
    area.addEventListener("keydown", (event) => {
      if (event.key === "Escape") props.onFinish(0);
    });
    host.append(area);
    if (props.focus) area.focus();
    return {
      take: (_sent, merged) => ({ base: merged, text: merged }),
      destroy: () => {
        editor.destroyed = true;
        area.remove();
      },
    };
  },
};

// Set before any page renders, since the page reads the bundle once per window.
window.lukePlanEditor = STAND_IN;

const roots: Root[] = [];

beforeEach(() => {
  stored = null;
  sent = [];
  refuseRead = false;
  refuseWrites = false;
  holdWrites = false;
  heldWrites = [];
  historyAsked = 0;
  newest = undefined;
  stallRevisions = false;
  built.length = 0;
  installScrollIntoView();
  // A document arriving is drawn at once under reduced motion, which jsdom has no answer to.
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
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
  const page = createElement(PlanTemplatePage, {
    signedIn,
    onShowHistory: () => {
      historyAsked += 1;
    },
  });
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

/** A section of the document as the keyboard selects it, by its heading. */
function block(page: ParentNode, heading: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(`[role="group"][aria-label="${heading}"]`);
  return found ?? assert.fail(`no ${heading} section`);
}

/** The headings of the sections the document draws, in order. */
const sections = (page: ParentNode) =>
  [...page.querySelectorAll<HTMLElement>('.plan-body [role="group"]')].map((each) =>
    each.getAttribute("aria-label"),
  );

/** Opens the editor by a click into a section, as the developer does. */
function clickInto(page: ParentNode, heading: string): void {
  act(() => {
    block(page, heading).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The editor open now, standing in for the plan's own. */
const box = (page: HTMLElement) =>
  page.querySelector<HTMLTextAreaElement>(".plan-document-editor textarea") ??
  assert.fail("no open editor");

/** Types into the box the way React hears a keystroke: the value set, then the input event. */
function typeInto(area: HTMLTextAreaElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Esc in the editor, which finishes the edit and saves what is left. */
function finish(area: HTMLTextAreaElement): void {
  act(() => {
    area.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

/** Opens the editor on the first section, types the whole template, and finishes, which saves it. */
async function edit(page: HTMLElement, text: string): Promise<void> {
  clickInto(page, "Context");
  typeInto(box(page), text);
  finish(box(page));
  await settle();
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

/** The reset's question, answered with its act. */
function confirmReset(page: ParentNode): void {
  act(() => button(page, "Reset to default")?.click());
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
  assert.ok(dialog, "the reset asks first");
  act(() => [...dialog.querySelectorAll("button")].at(-1)?.click());
}

/** Whether a selector reaches the element; a selector jsdom cannot parse, as a keyframe's step, reaches nothing. */
function safeMatch(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

const DEFAULT_HEADINGS = [
  "Context",
  "Goal",
  "Approach",
  "Interfaces",
  "Alternatives",
  "Hard parts",
  "Not doing",
  "Plan of attack",
  "Testing",
  "Open questions",
  "Assumptions",
];

test("the page draws the template as a plan's document under the page's own title, which is not edited, the recording kept off it, and a note with no reset while it is the default", async () => {
  const { container } = await mount();

  assert.deepEqual(
    sent.map((request) => request.kind).sort(),
    [ACT_KIND.PLAN_TEMPLATE_READ, ACT_KIND.PLAN_TEMPLATE_REVISIONS].sort(),
  );
  assert.deepEqual(sections(container), DEFAULT_HEADINGS);
  const title = container.querySelector<HTMLElement>(".plan-body .plan-title");
  assert.equal(title?.textContent, "Plan template");
  assert.equal(title?.closest('[role="group"]'), null, "the title is no block to edit");
  assert.equal(container.querySelector('[aria-label="Plan name"]'), null);
  assert.ok(container.querySelector(".plan-body")?.closest(".ph-no-capture"));
  assert.match(
    container.querySelector(".template-note")?.textContent ?? "",
    /New plans start as a copy of this template\.Editing it doesn't change existing plans\./u,
  );
  assert.equal(button(container, "Reset to default"), undefined);
  assert.equal(built.length, 0, "nothing is edited until the developer asks");
});

test("a click into a section opens the plan's own editor on the whole template, and Return on a section opens it at the section's end", async () => {
  const { container } = await mount();

  clickInto(container, "Goal");
  assert.deepEqual(
    built.map(({ props }) => [props.markdown, props.label, props.focus]),
    [[DEFAULT_PLAN_TEMPLATE, "Plan", true]],
  );
  finish(box(container));
  await settle();

  act(() => block(container, "Approach").focus());
  act(() => {
    block(container, "Approach").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  assert.deepEqual(built.at(-1)?.props.placement, { section: 2 });
  assert.deepEqual(writes(), [], "an edit that changed nothing writes nothing");
});

test("finishing an edit saves the whole template, which the document then reads, with the reset beside it", async () => {
  const { container } = await mount();

  await edit(container, CUSTOM);

  assert.deepEqual(writes(), [CUSTOM]);
  assert.equal(container.querySelector(".plan-document-editor"), null, "the editor has gone");
  assert.deepEqual(sections(container), ["Why", "Done when"]);
  assert.match(container.textContent ?? "", /Edited by you · just now/u);
  assert.ok(button(container, "Reset to default"), "the account now holds its own");
});

it.effect("typing saves the typed words once the developer pauses", () =>
  Effect.gen(function* () {
    const registry = yield* registryOnTestClock;
    const { container } = yield* Effect.promise(() => mount(true, registry));
    clickInto(container, "Context");

    typeInto(box(container), "## Why");
    yield* TestClock.adjust(Duration.millis(600));
    typeInto(box(container), CUSTOM);
    yield* TestClock.adjust(Duration.millis(600));
    yield* settled;
    assert.deepEqual(writes(), [], "nothing is sent while the typing goes on");

    yield* TestClock.adjust(Duration.seconds(1));
    yield* settled;
    assert.deepEqual(writes(), [CUSTOM]);
  }),
);

test("signed out, the page says the template needs an account and asks the service nothing", async () => {
  const { container } = await mount(false);

  assert.match(container.textContent ?? "", /Sign in to edit the template/u);
  assert.equal(container.querySelector(".plan-body"), null);
  assert.deepEqual(sent, []);
});

test("a read that fails says so with a Retry, which reads the template again", async () => {
  refuseRead = true;
  const { container } = await mount();
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /could not be read/u);
  assert.equal(container.querySelector(".plan-body"), null);

  refuseRead = false;
  act(() => button(container, "Retry")?.click());
  await settle();
  assert.deepEqual(sections(container), DEFAULT_HEADINGS);
});

test("a save that fails says so under the editor with a Retry and keeps the words, and Retry saves them", async () => {
  refuseWrites = true;
  const { container } = await mount();
  await edit(container, CUSTOM);
  assert.match(
    container.querySelector('[role="alert"]')?.textContent ?? "",
    /Not saved: the service did not answer\./u,
  );
  assert.equal(box(container).value, CUSTOM);

  refuseWrites = false;
  act(() => button(container, "Retry")?.click());
  await settle();
  assert.deepEqual(writes(), [CUSTOM, CUSTOM]);
  assert.equal(stored, CUSTOM);
});

test("a template past its bound says so and is never sent", async () => {
  const { container } = await mount();
  const long = "x".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS + 1);

  await edit(container, long);

  assert.ok(container.querySelector('.plan-document-editor [role="alert"]'), "the editor says so");
  assert.deepEqual(writes(), []);
});

test("leaving the page saves words still waiting on their pause", async () => {
  const { container, root } = await mount();
  clickInto(container, "Context");
  typeInto(box(container), CUSTOM);

  act(() => root.unmount());
  await settle();

  assert.deepEqual(writes(), [CUSTOM]);
});

it.effect(
  "words left unsaved as the page goes that fail to save are said in a toast whose Retry saves them",
  () =>
    Effect.gen(function* () {
      refuseWrites = true;
      const registry = yield* registryOnTestClock;
      const { container, root } = yield* Effect.promise(() => mountWithToasts(registry));
      clickInto(container, "Context");
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

test("Reset to default asks first; Cancel keeps the template, and Reset writes null and shows the default", async () => {
  stored = CUSTOM;
  const { container } = await mount();
  assert.deepEqual(sections(container), ["Why", "Done when"]);

  act(() => button(container, "Reset to default")?.click());
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
  assert.ok(dialog, "the reset asks first");
  assert.match(dialog.textContent ?? "", /Reset plan template\?/u);
  assert.equal(document.activeElement, button(dialog, "Cancel"), "Cancel holds the focus");
  assert.ok(button(dialog, "Reset")?.classList.contains("danger-button"), "the act is red");
  act(() => button(dialog, "Cancel")?.click());
  await settle();
  assert.deepEqual(writes(), []);

  confirmReset(container);
  await settle();
  assert.deepEqual(writes(), [null]);
  assert.deepEqual(sections(container), DEFAULT_HEADINGS);
  assert.equal(button(container, "Reset to default"), undefined);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a reset while a save is out waits for it, so the default is what the service keeps", async () => {
  stored = CUSTOM;
  holdWrites = true;
  const { container } = await mount();
  clickInto(container, "Why");
  typeInto(box(container), `${CUSTOM}\n## Risks\n`);
  finish(box(container));
  await settle();

  confirmReset(container);
  await settle();
  assert.deepEqual(writes(), [`${CUSTOM}\n## Risks\n`], "the null waits on the save out");

  act(() => heldWrites.shift()?.());
  await settle();
  assert.deepEqual(writes(), [`${CUSTOM}\n## Risks\n`, null]);
  act(() => heldWrites.shift()?.());
  await settle();
  assert.equal(stored, null);
  assert.deepEqual(sections(container), DEFAULT_HEADINGS);
});

it.effect(
  "words whose save failed while the page stood are sent again as it goes, and a toast says so when they fail again",
  () =>
    Effect.gen(function* () {
      refuseWrites = true;
      const registry = yield* registryOnTestClock;
      const { container, root } = yield* Effect.promise(() => mountWithToasts(registry));
      yield* Effect.promise(() => edit(container, CUSTOM));
      assert.deepEqual(writes(), [CUSTOM]);

      act(() => root.unmount());
      yield* settled;
      assert.deepEqual(writes(), [CUSTOM, CUSTOM]);
      assert.match(newestToastSays() ?? "", /Your plan template could not be saved/u);
    }),
);

test("words queued behind a save as the reset is asked never land after it", async () => {
  stored = CUSTOM;
  holdWrites = true;
  const { container } = await mount();
  clickInto(container, "Why");
  typeInto(box(container), `${CUSTOM}\n## Risks\n`);
  finish(box(container));
  await settle();
  typeInto(box(container), `${CUSTOM}\n## Risks\n\n## Rollout\n`);
  finish(box(container));
  await settle();

  confirmReset(container);
  await settle();
  for (let landed = 0; landed < 3; landed += 1) {
    act(() => heldWrites.shift()?.());
    await settle();
  }

  assert.deepEqual(writes(), [`${CUSTOM}\n## Risks\n`, null]);
  assert.equal(stored, null);
  assert.deepEqual(sections(container), DEFAULT_HEADINGS);
});

test("the page has no top bar: its actions, Version history and Reset to default, stand at the end of the title line, and it and the line naming the newest revision each open the template's version history", async () => {
  stored = CUSTOM;
  newest = {
    seq: 3,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 0, duringCall: false },
    startedAt: 0,
    changes: 2,
  };
  const { container } = await mount();

  assert.equal(container.querySelector(".desktop-toolbar"), null);
  const line = container.querySelector<HTMLElement>(".plan-body .plan-title-line");
  assert.equal(line?.querySelector(".plan-title")?.textContent, "Plan template");
  const actions = [...(line?.querySelectorAll("button") ?? [])];
  assert.deepEqual(
    actions.map((each) => each.getAttribute("aria-label") ?? each.textContent),
    ["Version history", "Reset to default"],
  );
  assert.ok(actions[1]?.classList.contains("bordered-button"), "a page action is bordered");
  act(() => actions[0]?.click());
  const edited = container.querySelector<HTMLButtonElement>(".plan-edit-link");
  assert.match(edited?.textContent ?? "", /^Edited by you · \d+d ago$/u);
  act(() => edited?.click());

  assert.equal(historyAsked, 2);
});

test("a template never edited has no line over it, and while it is read, no history to open", async () => {
  refuseRead = true;
  const failedRead = await mount();
  assert.equal(failedRead.container.querySelector('[aria-label="Version history"]'), null);

  refuseRead = false;
  const { container } = await mount();
  assert.equal(container.querySelector(".plan-edit-note"), null);
  assert.ok(container.querySelector('[aria-label="Version history"]'));
});

test("the template's words dissolve at the scroller's top edge as they pass under the note, through the shared top fade, once the page has left its top", async () => {
  const sheet = await builtStylesheet();
  const rules = cssRules(sheet);
  const { container } = await mount();
  const scroller = container.querySelector(".plan-document-scroll");
  assert.ok(scroller);
  // The sheet's rules whose selector reaches the scroller, in the order the sheet gives them.
  const own = (property: string) =>
    rules
      .filter((rule) => rule.selectors.some((selector) => safeMatch(scroller, selector)))
      .flatMap((rule) => {
        const value = rule.declarations.get(property);
        return value === undefined ? [] : [value];
      });

  assert.deepEqual(own("animation"), ["scroll-top-fade linear both"]);
  assert.deepEqual(own("animation-timeline"), ["scroll(self block)"]);
  assert.deepEqual(own("animation-range"), ["0 var(--scroll-fade)"]);
  const fade = /@keyframes scroll-top-fade\s*\{(?<frames>[^@]*?\}\s*)\}/u.exec(sheet)?.groups
    ?.frames;
  assert.match(
    fade ?? "",
    /to\s*\{\s*mask-image:\s*linear-gradient\(to bottom, transparent 0, #000 var\(--scroll-fade\)\)/u,
  );
});

test("a history read that never answers holds nothing back: the template is drawn and edited without its line", async () => {
  stallRevisions = true;
  const { container } = await mount();

  assert.deepEqual(sections(container), DEFAULT_HEADINGS);
  assert.equal(container.querySelector(".plan-edit-note"), null);
  await edit(container, CUSTOM);
  assert.deepEqual(writes(), [CUSTOM]);
});
