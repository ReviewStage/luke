// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ConversationPanel } from "./conversation-panel";
import { CONVERSATION_SEARCH_INPUT_ID, searchConversation } from "./conversation-search";
import { CONVERSATION_MESSAGE_ATTRIBUTE, conversationSearchEntries } from "./conversation-turns";
import {
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";

type PanelProps = Parameters<typeof ConversationPanel>[0];

const GROUPS = fixtureConversationTurns();

/** The query the tests type, and the message its first shown result names: the newest group's oldest. */
const QUERY = "session";

const FIRST_HIT = searchConversation(conversationSearchEntries(GROUPS), QUERY)?.groups[0]?.[0];

if (FIRST_HIT === undefined) throw new Error("The fixtures hold no match for the test's query.");

/**
 * A stand-in for the browser's own frame schedule, `focus-seek.test.ts`'s
 * own: nothing runs until a test says a frame passed, so the landing's seek
 * is read off its own bookkeeping rather than a timer's.
 */
function frames() {
  const pending = new Map<number, () => void>();
  let next = 1;
  window.requestAnimationFrame = (callback) => {
    const handle = next++;
    pending.set(handle, () => callback(0));
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    pending.delete(handle);
  };
  return {
    /** Runs whatever the last frame asked for, and answers whether anything did. */
    tick(): boolean {
      const entry = [...pending.entries()].at(-1);
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1]();
      return true;
    },
  };
}

/**
 * jsdom lays nothing out, so what the landing reads and does is stood in
 * for: an element is drawn visibly unless it stands in the thread behind the
 * results and the asker cares about visibility, as the engine would answer
 * for `visibility: hidden`; and each scroll into view is recorded rather than
 * performed, with whether the row still stood behind the results when it
 * was asked for.
 */
function drawn() {
  const scrolled: {
    element: Element;
    options: boolean | ScrollIntoViewOptions | undefined;
    behind: boolean;
  }[] = [];
  HTMLElement.prototype.checkVisibility = function checkVisibility(
    this: HTMLElement,
    options?: CheckVisibilityOptions,
  ) {
    return !(options?.visibilityProperty === true && this.closest("[data-behind-results]"));
  };
  Element.prototype.scrollIntoView = function scrollIntoView(
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ) {
    scrolled.push({
      element: this,
      options,
      behind: this.closest("[data-behind-results]") !== null,
    });
  };
  return scrolled;
}

/**
 * jsdom lays nothing out, so the scroller's measure is stood in for: a
 * fixed height of thread in a fixed view, and a scroll position each element
 * keeps for itself, so a scroller that is drawn anew starts at its top the
 * way a real one does.
 */
function laidOut(scrollHeight: number, clientHeight: number) {
  const positions = new WeakMap<Element, number>();
  const measure = { scrollHeight, clientHeight };
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return positions.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        positions.set(this, value);
      },
    },
    scrollHeight: { configurable: true, get: () => measure.scrollHeight },
    clientHeight: { configurable: true, get: () => measure.clientHeight },
  });
  return measure;
}

function scroller(container: ParentNode): HTMLDivElement {
  const element = container.querySelector(".conversation-scroll:not(.conversation-search-scroll)");
  assert.ok(element instanceof HTMLDivElement, "the thread's scroller is drawn");
  return element;
}

function scrollTo(element: HTMLDivElement, scrollTop: number): void {
  act(() => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll"));
  });
}

function panelProps(extra: Partial<PanelProps> = {}): PanelProps {
  return {
    view: { groups: GROUPS, settled: true },
    roster: FIXTURE_ROSTER,
    now: FIXTURE_NOW,
    searchOpen: true,
    ...extra,
  };
}

function mount(props: PanelProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (next: PanelProps) => {
    act(() => {
      root.render(createElement(ConversationPanel, next));
    });
  };
  render(props);
  return { container, render };
}

function field(container: ParentNode): HTMLInputElement {
  const input = container.querySelector(`#${CONVERSATION_SEARCH_INPUT_ID}`);
  assert.ok(input instanceof HTMLInputElement, "the search field is drawn");
  return input;
}

/**
 * Types a value the way a keyboard does, past React's own value tracking:
 * the engine's setter puts the value on the node without telling React, so
 * the input event that follows is read as a change rather than an echo.
 */
function type(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The presses over the result rows, in the order the rows are drawn. */
function results(container: ParentNode): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll(".conversation-search-results .conversation-words-press"),
  ].filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
}

/** The thread's list while the thread stands forward; nothing while the results stand in its place. */
function thread(container: ParentNode): Element | null {
  return container.querySelector(
    ".conversation-thread:not([data-behind-results]) ol.conversation-list:not(.conversation-search-results)",
  );
}

function jumpToBottom(container: ParentNode): Element | null {
  return container.querySelector(".conversation-jump-to-bottom");
}

function landedRows(container: ParentNode): Element[] {
  return [...container.querySelectorAll('[data-search-landed="true"]')];
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the field stands at the head of the thread while the search is open, and a query puts the results in the thread's place", () => {
  const closed = mount(panelProps({ searchOpen: false }));
  assert.equal(closed.container.querySelector(`#${CONVERSATION_SEARCH_INPUT_ID}`), null);
  const { container } = mount(panelProps());
  const input = field(container);
  // The field and everything it draws stand inside the one subtree the recording blocks.
  const blocked = container.querySelector(".ph-no-capture");
  assert.ok(blocked?.contains(input));
  assert.ok(thread(container));
  assert.equal(results(container).length, 0);
  type(input, QUERY);
  const rows = results(container);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((row) => blocked?.contains(row)));
  assert.equal(thread(container), null);
  assert.match(container.querySelector(".session-search-count")?.textContent ?? "", /^\d+ of \d+$/);
  type(input, "zeta");
  assert.equal(results(container).length, 0);
  assert.equal(container.querySelector(".session-search-count")?.textContent, "No matches");
  assert.ok(container.querySelector(".empty-state")?.textContent?.includes("No messages match"));
});

test("pressing a result brings the thread back with the words marked, lands on the message, and scrolls it to the middle of the view", () => {
  const schedule = frames();
  const scrolled = drawn();
  const engaged: boolean[] = [];
  const { container } = mount(panelProps({ onSearchEngaged: (value) => engaged.push(value) }));
  const input = field(container);
  type(input, QUERY);
  const [first] = results(container);
  assert.ok(first);
  act(() => {
    first.click();
  });
  // The thread is back, every match marked, and the named message's rows wear the landing.
  assert.ok(thread(container));
  assert.equal(results(container).length, 0);
  assert.ok(container.querySelectorAll("mark.row-match").length >= 1);
  const landed = landedRows(container);
  assert.ok(landed.length >= 1);
  assert.ok(
    landed.every((row) => row.getAttribute(CONVERSATION_MESSAGE_ATTRIBUTE) === FIRST_HIT.messageId),
  );
  // The query stays in the field, so the marks say what they mark.
  assert.equal(input.value, QUERY);
  // The seek waits out the swap frame by frame — the thread stands hidden
  // behind the results at the moment of the press, and a row measured there
  // would be centred in a box the reader is not looking at — then brings the
  // first of the message's rows to the middle of the thread that came forward.
  assert.equal(scrolled.length, 0, "nothing is scrolled while the thread stands behind");
  for (let frame = 0; frame < 60 && scrolled.length === 0; frame += 1) schedule.tick();
  assert.equal(scrolled.length, 1);
  assert.equal(scrolled[0]?.behind, false);
  assert.deepEqual(scrolled[0]?.options, { block: "center", inline: "nearest" });
  assert.equal(
    scrolled[0]?.element.getAttribute(CONVERSATION_MESSAGE_ATTRIBUTE),
    FIRST_HIT.messageId,
  );
  // The caret back in the field is a request to see the results again.
  act(() => {
    input.focus();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  assert.ok(engaged.includes(true));
  assert.ok(results(container).length >= 2);
  assert.equal(thread(container), null);
});

test("Enter in the field lands on the first result, the way a find field's Enter goes to the first match", () => {
  frames();
  drawn();
  const { container } = mount(panelProps());
  const input = field(container);
  press(input, "Enter");
  assert.ok(thread(container), "Enter over no search changes nothing");
  type(input, QUERY);
  act(() => {
    input.focus();
  });
  press(input, "Enter");
  assert.ok(thread(container));
  const landed = landedRows(container);
  assert.ok(landed.length >= 1);
  assert.equal(landed[0]?.getAttribute(CONVERSATION_MESSAGE_ATTRIBUTE), FIRST_HIT.messageId);
  // Enter leaves the field as a pressed row would, so the caret placed back
  // in it is what brings the results back.
  assert.notEqual(document.activeElement, input);
  act(() => {
    input.focus();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  assert.equal(thread(container), null);
  assert.ok(results(container).length >= 1);
});

test("Escape clears a held query first and closes an empty field, and the panel drops a query the render it finds the field closed", () => {
  const closes: number[] = [];
  const { container, render } = mount(panelProps({ onSearchClose: () => closes.push(1) }));
  const input = field(container);
  type(input, QUERY);
  assert.equal(thread(container), null);
  press(input, "Escape");
  assert.equal(input.value, "");
  assert.ok(thread(container));
  assert.equal(closes.length, 0);
  press(input, "Escape");
  assert.equal(closes.length, 1);
  // A query does not outlive the field it was typed in.
  type(input, "prompt");
  assert.equal(results(container).length >= 1, true);
  render(panelProps({ searchOpen: false, onSearchClose: () => closes.push(1) }));
  assert.equal(container.querySelector(`#${CONVERSATION_SEARCH_INPUT_ID}`), null);
  assert.ok(thread(container));
  assert.equal(container.querySelectorAll("mark.row-match").length, 0);
  render(panelProps({ searchOpen: true, onSearchClose: () => closes.push(1) }));
  assert.equal(field(container).value, "");
  assert.ok(thread(container));
});

test("the thread keeps the reader's place behind the results, and a landing lets the tail go", () => {
  frames();
  drawn();
  laidOut(1000, 300);
  const { container } = mount(panelProps());
  const input = field(container);
  const box = scroller(container);
  // A follower, on the tail, is still there when the results leave.
  scrollTo(box, 700);
  assert.equal(jumpToBottom(container), null);
  type(input, QUERY);
  assert.equal(thread(container), null, "the results stand in the thread's place");
  assert.equal(scroller(container), box, "the thread stands behind them, its scroller the same");
  assert.equal(box.closest(".conversation-thread")?.getAttribute("data-behind-results"), "true");
  press(input, "Escape");
  assert.ok(thread(container));
  assert.equal(scroller(container), box);
  // Still on the tail: the thread pins a follower there on every paint, and
  // the stub's tail is the whole height, since it clamps nothing.
  assert.ok(box.scrollTop >= 700);
  assert.equal(jumpToBottom(container), null);
  // A reader who had scrolled up is where they were, with the way down still offered.
  scrollTo(box, 120);
  assert.ok(jumpToBottom(container));
  type(input, QUERY);
  press(input, "Escape");
  assert.equal(box.scrollTop, 120);
  assert.ok(jumpToBottom(container));
  // A landing is the reader's own place: the tail is let go of, so nothing
  // but the seek moves the scroller, and the way back down is offered.
  scrollTo(box, 700);
  assert.equal(jumpToBottom(container), null);
  type(input, QUERY);
  const stood = box.scrollTop;
  const [result] = results(container);
  assert.ok(result);
  act(() => {
    result.click();
  });
  assert.equal(scroller(container), box);
  assert.equal(box.scrollTop, stood);
  assert.ok(jumpToBottom(container));
});

test("the landing's own scroll is not the reader's: a message landed on near the tail is not followed off by the next line said", () => {
  const schedule = frames();
  drawn();
  laidOut(1000, 300);
  // A landing that brings the row to the tail, the way a real one does for the
  // newest message: the scroller moves and raises its scroll event.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    const box = this.closest(".conversation-scroll");
    if (!(box instanceof HTMLDivElement)) return;
    box.scrollTop = 700;
    box.dispatchEvent(new Event("scroll"));
  };
  const { container } = mount(panelProps());
  const input = field(container);
  type(input, QUERY);
  const [result] = results(container);
  assert.ok(result);
  act(() => {
    result.click();
  });
  for (let frame = 0; frame < 60 && scroller(container).scrollTop !== 700; frame += 1) {
    act(() => {
      schedule.tick();
    });
  }
  assert.equal(scroller(container).scrollTop, 700);
  // The landing's scroll changed nothing about following: the way down is still offered.
  assert.ok(container.querySelector(".conversation-jump-to-bottom"));
  // A frame later the landing has said all it will; the reader's own scroll to the tail follows it again.
  act(() => {
    schedule.tick();
  });
  scrollTo(scroller(container), 700);
  assert.equal(container.querySelector(".conversation-jump-to-bottom"), null);
});

test("a press that closes a result's open menu is the menu's dismiss, not the words' press", () => {
  frames();
  drawn();
  const { container } = mount(panelProps({ onOfferRatingFeedback: () => undefined }));
  const input = field(container);
  type(input, QUERY);
  const menu = container.querySelector(".conversation-search-results .conversation-menu");
  assert.ok(menu instanceof HTMLElement, "a rated result carries the thread's menu");
  // The press and the menu share the words' ground: the bubble, or the own-judgment body.
  const press = menu
    .closest(".conversation-bubble, .conversation-action-body")
    ?.querySelector(".conversation-words-press");
  assert.ok(press instanceof HTMLButtonElement);
  // The platform says the sheet opened; the row wears it.
  act(() => {
    menu.dispatchEvent(
      Object.assign(new Event("toggle"), { oldState: "closed", newState: "open" }),
    );
  });
  assert.equal(menu.getAttribute("data-open"), "true");
  // A pointer falling on the row while the sheet stands is its dismiss: the
  // platform closes the sheet on the lift, and the click that follows lands nothing.
  act(() => {
    press.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    menu.dispatchEvent(
      Object.assign(new Event("toggle"), { oldState: "open", newState: "closed" }),
    );
    press.click();
  });
  assert.equal(menu.getAttribute("data-open"), null);
  assert.equal(thread(container), null, "the results still stand");
  // The next press, with no sheet standing, is the row's own.
  act(() => {
    press.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    press.click();
  });
  assert.ok(thread(container));
});

test("the paging anchor stands through the results, so the next line said does not move a landed reader", () => {
  const schedule = frames();
  drawn();
  const measure = laidOut(1000, 300);
  const { container, render } = mount(panelProps());
  const input = field(container);
  type(input, QUERY);
  const [result] = results(container);
  assert.ok(result);
  act(() => {
    result.click();
  });
  for (let frame = 0; frame < 60; frame += 1) {
    act(() => {
      schedule.tick();
    });
  }
  const landedScroller = scroller(container);
  const stood = landedScroller.scrollTop;
  // The thread grows at its tail by a line still being said. The rows above
  // the reader did not move, so neither may the reader.
  measure.scrollHeight = 1300;
  render(
    panelProps({
      live: [
        { entry: { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "One more line." }, at: undefined },
      ],
    }),
  );
  assert.equal(scroller(container), landedScroller);
  assert.equal(landedScroller.scrollTop, stood);
});

test("a landing that brings the reader to the head asks for older turns, as the reader's own scroll there would", () => {
  const schedule = frames();
  drawn();
  laidOut(1000, 300);
  // A landing on the thread's first row: the scroller goes to the head and says so.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    const box = this.closest(".conversation-scroll");
    if (!(box instanceof HTMLDivElement)) return;
    box.scrollTop = 0;
    box.dispatchEvent(new Event("scroll"));
  };
  const asked: number[] = [];
  const { container, render } = mount(panelProps());
  const input = field(container);
  // The reader stands away from the head when older turns come to stand, so nothing asks yet.
  scrollTo(scroller(container), 700);
  const paging = panelProps({
    view: { groups: GROUPS, settled: true, hasOlder: true },
    onLoadOlder: () => {
      asked.push(1);
      return Promise.resolve(false);
    },
  });
  render(paging);
  assert.equal(asked.length, 0);
  type(input, QUERY);
  const [result] = results(container);
  assert.ok(result);
  act(() => {
    result.click();
  });
  for (let frame = 0; frame < 60 && asked.length === 0; frame += 1) {
    act(() => {
      schedule.tick();
    });
  }
  assert.equal(asked.length, 1);
});

test("opening the search keeps a follower on the tail, though the pill takes its room from the thread", () => {
  const measure = laidOut(1000, 300);
  const { container, render } = mount(panelProps({ searchOpen: false }));
  const box = scroller(container);
  scrollTo(box, 700);
  assert.equal(jumpToBottom(container), null);
  // The pill opens above the thread and the thread's view shrinks by its
  // height: a follower is pinned to the tail again, not left short of it.
  measure.clientHeight = 260;
  render(panelProps({ searchOpen: true }));
  assert.equal(box.scrollTop, 1000);
  assert.equal(jumpToBottom(container), null);
});
