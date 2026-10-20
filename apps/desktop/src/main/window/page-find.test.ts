// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  PAGE_FIND_ACT,
  PAGE_FIND_TYPE,
  type PageFindAsk,
  pageFindAnswerSchema,
} from "@luke/features/page-find";
import { pageFrameUrl } from "@luke/features/page-frame";
import { Effect, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { pageResponse } from "./page-protocol";

/**
 * The find a page is served with, as the side panel drives it: a page served
 * by the `luke-page:` scheme, drawn in a frame of the test's window, asked to
 * search and step as the panel's find bar asks, and answering with its tally
 * and its selection. jsdom lays nothing out, so where a match stands on
 * screen is the one thing answered for it: every match below the fold, and
 * a scroll into view recorded on the element that holds it. Synthetic pages.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const PAGE_ID = "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f";

/** A page's frame as the test drives it: what it posted to the panel, an ask from the panel, and the elements scrolled into view. */
interface DrawnPage {
  readonly frame: HTMLIFrameElement;
  readonly posted: (typeof pageFindAnswerSchema.Type)[];
  readonly scrolled: string[];
  readonly ask: (ask: PageFindAsk, from?: MessageEventSource | null) => void;
}

/** The pages drawn by the test running, each cleared as it ends so no find outlives its frame. */
const drawn: DrawnPage[] = [];

afterEach(() => {
  for (const page of drawn.splice(0)) page.ask({ type: PAGE_FIND_TYPE, act: PAGE_FIND_ACT.CLEAR });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** The page's HTML as the scheme serves it. */
const served = (html: string) =>
  Effect.flatMap(
    pageResponse(pageFrameUrl({ taskId: TASK_ID, pageId: PAGE_ID, version: 1 }), () =>
      Effect.succeed({
        page: { id: PAGE_ID, title: "Funnel", version: 1, at: 1_800_000_000_000, html },
      }),
    ),
    (response) => Effect.promise(() => response.text()),
  );

/**
 * Draws the page as served in a frame, its scripts run as the frame runs
 * them, and records what it posts to the window that framed it.
 */
const draw = (html: string) => Effect.map(served(html), drawServed);

/** Reads what the page posted as the find's answer, as the panel reads it. */
const readAnswer = Schema.decodeUnknownSync(pageFindAnswerSchema);

/**
 * The prototype up `of`'s chain that defines `name` itself: one of a frame's
 * own interfaces, since jsdom gives each frame a realm of its own.
 */
function protoDefining(of: Node | AbstractRange, name: string): object {
  for (
    let proto = Object.getPrototypeOf(of);
    proto !== null;
    proto = Object.getPrototypeOf(proto)
  ) {
    if (Object.hasOwn(proto, name)) return proto;
  }
  return assert.fail(`nothing up the chain defines ${name}`);
}

/** Draws a page's HTML as served, as `draw` does. */
function drawServed(html: string): DrawnPage {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const framed = frame.contentWindow ?? assert.fail("the frame has no window");
  const page = framed.document;
  page.documentElement.innerHTML = html;
  // Note that a script written as markup never runs, so each is written again as an element.
  for (const parsedScript of [...page.querySelectorAll("script")]) {
    const script = page.createElement("script");
    script.textContent = parsedScript.textContent;
    parsedScript.replaceWith(script);
  }
  const posted: (typeof pageFindAnswerSchema.Type)[] = [];
  vi.spyOn(framed.parent, "postMessage").mockImplementation((message) => {
    posted.push(readAnswer(message));
  });
  const scrolled: string[] = [];
  // Note that jsdom lays nothing out, so each frame's own prototypes say where a match stands.
  Object.defineProperty(protoDefining(page.createRange(), "setStart"), "getBoundingClientRect", {
    value: () => DOMRect.fromRect({ x: 0, y: framed.innerHeight + 100, width: 10, height: 10 }),
    configurable: true,
  });
  Object.defineProperty(protoDefining(page.body, "getAttribute"), "scrollIntoView", {
    value(this: Element) {
      scrolled.push(this.id);
    },
  });
  const ask = (asked: PageFindAsk, from: MessageEventSource | null = framed.parent) =>
    framed.dispatchEvent(new MessageEvent("message", { data: asked, source: from }));
  const drawnPage = { frame, posted, scrolled, ask };
  drawn.push(drawnPage);
  return drawnPage;
}

/** The tallies the page posted, oldest first. */
function talliesOf(posted: readonly (typeof pageFindAnswerSchema.Type)[]) {
  return posted.flatMap((message) => ("tally" in message ? [message.tally] : []));
}

const search = (query: string): PageFindAsk => ({
  type: PAGE_FIND_TYPE,
  act: PAGE_FIND_ACT.SEARCH,
  query,
});

const step = (query: string, by: -1 | 1): PageFindAsk => ({
  type: PAGE_FIND_TYPE,
  act: PAGE_FIND_ACT.STEP,
  query,
  by,
});

const FUNNEL = [
  "<!doctype html><title>Funnel</title>",
  '<h1 id="title">Invite funnel</h1>',
  '<p id="first">Invites <b>sent</b> this week</p>',
  '<p hidden id="hidden">invites sent</p>',
  '<div style="display: none">Invites sent</div>',
  "<script>const label = 'invites sent';</script>",
  '<details><summary>More</summary><p id="folded">INVITES SENT last week</p></details>',
].join("\n");

it.effect(
  "the page is served as the agent wrote it, in the standards mode its doctype asks for, with the find ahead of it",
  () =>
    Effect.gen(function* () {
      const page = yield* served(FUNNEL);
      const parsed = new DOMParser().parseFromString(page, "text/html");

      assert.ok(page.endsWith(FUNNEL.slice("<!doctype html>".length)));
      assert.equal(parsed.compatMode, "CSS1Compat");
      assert.equal(parsed.title, "Funnel");
    }),
);

it.effect("a page whose doctype follows a comment keeps its standards mode", () =>
  Effect.gen(function* () {
    const page = yield* served(
      "<!-- generated -->\n<!DOCTYPE html><title>Funnel</title><p>Sent</p>",
    );

    assert.equal(new DOMParser().parseFromString(page, "text/html").compatMode, "CSS1Compat");
  }),
);

it.effect("markup the page leaves open does not swallow the find", () =>
  Effect.gen(function* () {
    const { ask, posted } = yield* draw("<!doctype html><p>Invites sent</p><textarea>unclosed");

    ask(search("invites sent"));

    assert.deepEqual(talliesOf(posted), [{ count: 1, at: 0 }]);
  }),
);

it.effect(
  "a match a page's scroller holds out of sight is scrolled to, though the window holds it",
  () =>
    Effect.gen(function* () {
      const { frame, ask, scrolled } = yield* draw(
        '<!doctype html><div style="overflow-y: auto"><p id="inner">Invites sent</p></div>',
      );
      const framed = frame.contentWindow ?? assert.fail();
      const page = frame.contentDocument ?? assert.fail();
      const scroller = page.querySelector("div") ?? assert.fail();
      // The match stands in the window's height, below the scroller's.
      Object.defineProperty(
        protoDefining(page.createRange(), "setStart"),
        "getBoundingClientRect",
        {
          value: () => DOMRect.fromRect({ x: 0, y: 300, width: 10, height: 10 }),
        },
      );
      scroller.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 });
      assert.ok(framed.innerHeight > 310);

      ask(search("invites sent"));

      assert.deepEqual(scrolled, ["inner"]);
    }),
);

it.effect(
  "a search tallies the query in the page's shown words, case aside and across inline elements, and brings the first into view",
  () =>
    Effect.gen(function* () {
      const { ask, posted, scrolled } = yield* draw(FUNNEL);

      ask(search("invites sent"));

      assert.deepEqual(talliesOf(posted), [{ count: 2, at: 0 }]);
      assert.deepEqual(scrolled, ["first"]);
    }),
);

it.effect(
  "a step moves through the matches and round from the last, opening the fold a match stands in",
  () =>
    Effect.gen(function* () {
      const { frame, ask, posted, scrolled } = yield* draw(FUNNEL);
      const details = frame.contentDocument?.querySelector("details") ?? assert.fail();

      ask(search("invites sent"));
      ask(step("invites sent", 1));
      assert.equal(details.open, true);
      ask(step("invites sent", 1));
      ask(step("invites sent", -1));

      assert.deepEqual(talliesOf(posted), [
        { count: 2, at: 0 },
        { count: 2, at: 1 },
        { count: 2, at: 0 },
        { count: 2, at: 1 },
      ]);
      assert.deepEqual(scrolled, ["first", "folded", "first", "folded"]);
    }),
);

it.effect("a change to the page's words tallies again, keeping to the match the find is at", () =>
  Effect.gen(function* () {
    const { frame, ask, posted, scrolled } = yield* draw(FUNNEL);
    ask(search("invites sent"));
    ask(step("invites sent", 1));

    const added = frame.contentDocument?.createElement("p") ?? assert.fail();
    added.textContent = "Invites sent today";
    frame.contentDocument?.querySelector("h1")?.after(added);
    yield* Effect.promise(() => Promise.resolve());

    assert.deepEqual(talliesOf(posted).at(-1), { count: 3, at: 2 });
    assert.deepEqual(scrolled, ["first", "folded"]);
  }),
);

it.effect("a query with the characters of a pattern is found as it is typed", () =>
  Effect.gen(function* () {
    const { ask, posted } = yield* draw(
      "<p>Spend (est.) $4.20 + tax</p><p>Spend est $4120 tax</p>",
    );

    ask(search("(est.) $4.20 +"));

    assert.deepEqual(talliesOf(posted), [{ count: 1, at: 0 }]);
  }),
);

it.effect(
  "⌘F, ⌘G, and ⇧⌘G pressed in the page are handed to the panel once a press, and the page never sees them, held or not; ⌘C stays the page's",
  () =>
    Effect.gen(function* () {
      const { frame, posted } = yield* draw(FUNNEL);
      const framed = frame.contentWindow ?? assert.fail();
      const seen: string[] = [];
      framed.addEventListener("keydown", (event) => seen.push(event.key));
      const press = (key: string, shiftKey = false, repeat = false) => {
        const event = new KeyboardEvent("keydown", {
          key,
          metaKey: true,
          shiftKey,
          repeat,
          bubbles: true,
          cancelable: true,
        });
        frame.contentDocument?.body.dispatchEvent(event);
        return event.defaultPrevented;
      };

      const kept = [press("f"), press("g"), press("g", false, true), press("G", true), press("c")];

      assert.deepEqual(kept, [true, true, true, true, false]);
      assert.deepEqual(seen, ["c"]);
      assert.deepEqual(
        posted.flatMap((message) => ("key" in message ? [message.key] : [])),
        ["find", "next", "previous"],
      );
    }),
);

it.effect("an ask from anything but the window that framed the page is not heard", () =>
  Effect.gen(function* () {
    const { ask, posted } = yield* draw(FUNNEL);

    ask(search("invites sent"), null);

    assert.deepEqual(talliesOf(posted), []);
  }),
);

it.effect("the words selected in the page are handed to the panel as the selection changes", () =>
  Effect.gen(function* () {
    const { frame, posted } = yield* draw(FUNNEL);
    const page = frame.contentDocument ?? assert.fail();
    const words = page.querySelector("h1")?.firstChild ?? assert.fail();

    page.getSelection()?.setBaseAndExtent(words, 0, words, 6);
    page.dispatchEvent(new Event("selectionchange"));

    assert.deepEqual(posted.at(-1), { type: PAGE_FIND_TYPE, selection: "Invite" });
  }),
);
