import { Schema as EffectSchema } from "effect";
import { DESCRIPTION_COMMENT_BOUNDS } from "./description-comment-wire.js";

export const PAGE_PICK_TYPE = "app-page-pick";

export const PAGE_PICK_ACT = {
  START: "start",
  STOP: "stop",
  SHOW: "show",
  HINT: "hint",
  MARK: "mark",
  UNSELECT: "unselect",
} as const;

export type PagePickAsk =
  | {
      readonly type: typeof PAGE_PICK_TYPE;
      readonly act:
        | typeof PAGE_PICK_ACT.START
        | typeof PAGE_PICK_ACT.STOP
        | typeof PAGE_PICK_ACT.UNSELECT;
    }
  | {
      readonly type: typeof PAGE_PICK_TYPE;
      readonly act: typeof PAGE_PICK_ACT.SHOW | typeof PAGE_PICK_ACT.HINT;
      readonly path: string;
    }
  | {
      readonly type: typeof PAGE_PICK_TYPE;
      readonly act: typeof PAGE_PICK_ACT.MARK;
      readonly marks: readonly PageMark[];
    };

export interface PageMark {
  readonly path: string;
  readonly words?: string;
}

const frameBoxSchema = EffectSchema.Struct({
  left: EffectSchema.Finite,
  top: EffectSchema.Finite,
  right: EffectSchema.Finite,
  bottom: EffectSchema.Finite,
});

export type FrameBox = typeof frameBoxSchema.Type;

const elementPathSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_ELEMENT_PATH_CHARS),
);

const pickedSchema = EffectSchema.Struct({
  path: elementPathSchema,
  quote: EffectSchema.String.check(
    EffectSchema.isPattern(/\S/u),
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
  ),
  section: EffectSchema.String.check(
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_SECTION_CHARS),
  ),
  box: frameBoxSchema,
  words: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type PagePicked = typeof pickedSchema.Type;

export const pagePickAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ type: EffectSchema.Literal(PAGE_PICK_TYPE), picked: pickedSchema }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    stopped: EffectSchema.Literal(true),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    marks: EffectSchema.Array(
      EffectSchema.Struct({ path: elementPathSchema, box: EffectSchema.NullOr(frameBoxSchema) }),
    ).check(EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION)),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    selected: EffectSchema.NullOr(pickedSchema),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_PICK_TYPE),
    pressed: EffectSchema.Literal(true),
  }),
]);

export const PAGE_PICK_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_PICK_TYPE)};
  const MAX_PATH = ${DESCRIPTION_COMMENT_BOUNDS.MAX_ELEMENT_PATH_CHARS};
  const MAX_QUOTE = ${DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS};
  const MAX_SECTION = ${DESCRIPTION_COMMENT_BOUNDS.MAX_SECTION_CHARS};
  const MARK = "data-ui-pick";
  const PRESSES = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];
  const WORDS = "ui-comment-words";
  const pick = { on: false, hovered: null, shown: null, hinted: null, styled: false };
  const painted = typeof CSS !== "undefined" && CSS.highlights !== undefined && typeof Highlight === "function";

  const post = (message) => parent.postMessage(Object.assign({ type: TYPE }, message), "*");
  const flat = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
  const cut = (text, most) => (text.length > most ? text.slice(0, most - 1) + "…" : text);

  const style = () => {
    if (pick.styled || typeof CSSStyleSheet !== "function") return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("[" + MARK + "] { outline: 2px solid #0a84ff !important; outline-offset: 2px !important; } [" + MARK + "=hover] { cursor: crosshair !important; } [" + MARK + "=hint] { outline-color: rgba(10, 132, 255, 0.45) !important; } ::highlight(" + WORDS + ") { background-color: rgba(255, 196, 0, 0.32); }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    pick.styled = true;
  };

  // The element hovered or shown moved to another, or to none, each of the two marked for what it now is.
  const mark = (key, element) => {
    const was = pick[key];
    pick[key] = element;
    for (const each of [was, element]) {
      if (each === null) continue;
      const value = each === pick.hovered ? "hover" : each === pick.shown ? "shown" : each === pick.hinted ? "hint" : null;
      if (value === null) {
        each.removeAttribute(MARK);
      } else {
        style();
        each.setAttribute(MARK, value);
      }
    }
  };

  const step = (element) => {
    if (element.id !== "" && typeof CSS !== "undefined" && document.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
    const tag = element.tagName.toLowerCase();
    if (element === document.body || element === document.documentElement) return tag;
    let place = 1;
    for (let sibling = element.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === element.tagName) place += 1;
    }
    return tag + ":nth-of-type(" + place + ")";
  };

  const pathOf = (element) => {
    const steps = [];
    for (let at = element; at !== null; at = at.parentElement) {
      const one = step(at);
      steps.unshift(one);
      if (one.startsWith("#") || at === document.body || at === document.documentElement) break;
    }
    const path = steps.join(" > ");
    return path.length <= MAX_PATH || element.parentElement === null ? path.slice(0, MAX_PATH) : pathOf(element.parentElement);
  };

  const quoteOf = (element) => {
    const words = flat(element.innerText ?? element.textContent)
      || flat(element.getAttribute("aria-label"))
      || flat(element.getAttribute("alt"))
      || flat(element.getAttribute("title"));
    return cut(words || "<" + element.tagName.toLowerCase() + ">", MAX_QUOTE);
  };

  const sectionOf = (element) => {
    let heading = null;
    for (const each of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      if (each === element || each.contains(element) || (each.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) heading = each;
      else break;
    }
    return heading === null ? "" : cut(flat(heading.textContent), MAX_SECTION);
  };

  const stop = () => {
    pick.on = false;
    mark("hovered", null);
  };

  const target = (event) => (event.target instanceof Element ? event.target : null);

  const boxOf = (rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

  const find = (path) => {
    try {
      return path === "" ? null : document.querySelector(path);
    } catch {
      return null;
    }
  };

  const told = { marks: [], said: "[]", selected: "", queued: false, settle: undefined };

  // The words a thread quotes, found in its element's text as one string, as a range; none where they stand there no more.
  const wordsIn = (element, words) => {
    const nodes = [];
    let text = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    const at = text.indexOf(words);
    if (at < 0 || words === "") return null;
    const end = at + words.length;
    const first = nodes.findLast((each) => each.start <= at);
    const last = nodes.findLast((each) => each.start < end);
    const range = document.createRange();
    range.setStart(first.node, at - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  };

  const tint = () => {
    if (!painted) return;
    style();
    const ranges = told.marks.flatMap((each) => {
      const element = typeof each.words === "string" ? find(each.path) : null;
      const range = element === null ? null : wordsIn(element, each.words);
      return range === null ? [] : [range];
    });
    CSS.highlights.set(WORDS, new Highlight(...ranges));
  };

  // The words selected, as an element picked whose quote they are: none where none are, or they stand in a field.
  const selected = () => {
    const selection = getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
    const words = cut(String(selection).trim(), MAX_QUOTE);
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node instanceof Element ? node : node.parentElement;
    if (words === "" || element === null || element.closest("input, textarea, select, [contenteditable]") !== null) return null;
    return { path: pathOf(element), quote: words, section: sectionOf(element), box: boxOf(range.getBoundingClientRect()), words: true };
  };

  // What the panel holds of the page told again where it moved: each element marked, and the words selected.
  const tell = () => {
    told.queued = false;
    const marks = told.marks.map(({ path }) => {
      const element = find(path);
      return { path, box: element === null ? null : boxOf(element.getBoundingClientRect()) };
    });
    const said = JSON.stringify(marks);
    if (said !== told.said) {
      told.said = said;
      post({ marks });
      tint();
    }
    if (told.selected !== "" && told.selected !== "null") tellSelected();
  };

  const tellSelected = () => {
    const now = selected();
    const said = JSON.stringify(now);
    if (said === told.selected) return;
    told.selected = said;
    post({ selected: now });
  };

  const moved = () => {
    if (told.queued) return;
    told.queued = true;
    (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(tell);
  };

  addEventListener("scroll", moved, true);
  addEventListener("resize", moved);
  new MutationObserver(moved).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });

  // Note that words are offered as a press or a key lets them go, a finger's once they rest, and taken away at once.
  addEventListener("pointerup", () => setTimeout(tellSelected, 0), true);
  addEventListener("keyup", tellSelected, true);
  document.addEventListener("selectionchange", () => {
    clearTimeout(told.settle);
    if (getSelection()?.isCollapsed !== false) tellSelected();
    else told.settle = setTimeout(tellSelected, 300);
  });

  addEventListener("pointerover", (event) => {
    if (pick.on) mark("hovered", target(event));
  }, true);

  for (const name of PRESSES) {
    addEventListener(name, (event) => {
      if (!pick.on) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = target(event);
      if (name !== "click" || element === null) return;
      stop();
      post({ picked: { path: pathOf(element), quote: quoteOf(element), section: sectionOf(element), box: boxOf(element.getBoundingClientRect()) } });
    }, true);
  }

  // Note that a press the pick took for itself stops before this, and one that selected words is a selection's.
  addEventListener("click", () => {
    if (getSelection()?.isCollapsed !== false) post({ pressed: true });
  }, true);

  addEventListener("keydown", (event) => {
    if (!pick.on || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stop();
    post({ stopped: true });
  }, true);

  addEventListener("message", (event) => {
    const ask = event.data;
    if (event.source !== parent || ask === null || typeof ask !== "object" || ask.type !== TYPE) return;
    if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.START)}) pick.on = true;
    else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.STOP)}) stop();
    else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.UNSELECT)}) getSelection()?.removeAllRanges();
    else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.MARK)} && Array.isArray(ask.marks)) {
      told.marks = ask.marks.filter((each) => each !== null && typeof each === "object" && typeof each.path === "string");
      told.said = "";
      tell();
      tint();
    } else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.SHOW)} && typeof ask.path === "string") {
      const element = find(ask.path);
      mark("shown", element);
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (ask.act === ${JSON.stringify(PAGE_PICK_ACT.HINT)} && typeof ask.path === "string") {
      mark("hinted", find(ask.path));
    }
  });
})();`;
