// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  composerEditor,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { mountComposer } from "./composer-editor.js";
import {
  COMPOSER_INPUT,
  type ComposerEditorHandle,
  type ComposerEditorProps,
  type ComposerTrigger,
  type EditorFormat,
} from "./contract.js";

/**
 * The message box's editor through its mount and its handle: the words read
 * out as the one string a message is, every change from outside landing
 * once, Enter and an input method's Enter, the bound, a paste, a dictation's
 * mark, a skill's chip, which one Backspace takes out whole and whose
 * name stands in no attribute the recording would keep, and the inline
 * marks, typed, chorded, and read out and back as their Markdown.
 */

// Note that the editor's keymap reads the platform once, as it loads, to say which key Mod is, so the page is a Mac's before anything is imported.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

const SKILLS: ReadonlySet<string> = new Set(["release", "deploy"]);

/** Every box mounted, taken down after each test. */
const boxes: { host: HTMLElement; handle: ComposerEditorHandle }[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const box of boxes.splice(0)) box.handle.destroy();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** The device's pointer as a phone's, a finger, or a mouse's, which the browser's media queries answer. */
function pointerIs(coarse: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
  }));
}

/** A box mounted on the words given, with everything it hands back written down. */
function mounted(text: string, overrides: Partial<ComposerEditorProps> = {}) {
  const drafts: string[] = [];
  const triggers: (ComposerTrigger | undefined)[] = [];
  const pasted: (readonly File[])[] = [];
  const chips = new Set<HTMLElement>();
  const sends = { count: 0 };
  const host = document.createElement("div");
  document.body.append(host);
  const handle = mountComposer(host, {
    text,
    skills: SKILLS,
    maxLength: 16_000,
    label: "Message to the agent",
    className: "agent-composer-input",
    focus: true,
    onDraft: (draft) => drafts.push(draft),
    onKey: () => false,
    onEnter: () => {
      sends.count += 1;
    },
    onPasteFiles: (files) => {
      pasted.push(files);
      return files.some((file) => file.type.startsWith("image/"));
    },
    onTrigger: (trigger) => triggers.push(trigger),
    drawChip: (element, chip) => {
      element.textContent = `/${chip.name}`;
      chips.add(element);
      return () => chips.delete(element);
    },
    ...overrides,
  });
  boxes.push({ host, handle });
  const editor = composerEditor(host).editor;
  assert.ok(editor, "the editor is running");
  return {
    host,
    handle,
    drafts,
    triggers,
    pasted,
    sends,
    /** The chips drawn now, by their words. */
    chips: () => [...chips].map((chip) => chip.textContent),
    /** Puts the caret at a place in the document, as a press there would. */
    caretAt: (pos: number) => editor.commands.setTextSelection(pos),
    /** Selects the document from one place to another, as a drag would. */
    select: (from: number, to: number) => editor.commands.setTextSelection({ from, to }),
    /** Selects every word, as ⌘A does. */
    selectAll: () => editor.commands.selectAll(),
  };
}

/** The words typed one key at a time, as the browser's text input hands each to the editor, so a Markdown rule a key completes runs. */
function typeKeys(host: HTMLElement, text: string): void {
  const view = composerEditor(host).editor?.view ?? assert.fail("the editor is running");
  for (const character of text) {
    const { from, to } = view.state.selection;
    const typed = () => view.state.tr.insertText(character, from, to);
    const ruled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, character, typed),
    );
    if (ruled !== true) view.dispatch(typed());
  }
}

/** A chord pressed in the box, ⌘ with the letter, Shift where asked, as a Mac keyboard spells it; answers whether anything outside the editor heard it. */
function chord(host: HTMLElement, letter: string, shift = false): boolean {
  let heard = false;
  const hear = () => {
    heard = true;
  };
  window.addEventListener("keydown", hear);
  const upper = letter.toUpperCase();
  pressInComposer(host, shift ? upper : letter, {
    code: `Key${upper}`,
    keyCode: upper.charCodeAt(0),
    metaKey: true,
    shiftKey: shift,
  });
  window.removeEventListener("keydown", hear);
  return heard;
}

/** What the box's words hold in each mark's element, by the element's tag. */
function marked(host: HTMLElement): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const tag of ["strong", "em", "s", "code", "a"]) {
    const words = [...composerEditor(host).querySelectorAll(tag)].map((each) => each.textContent);
    if (words.length > 0) found[tag] = words;
  }
  return found;
}

/** A paste of the words and files given, as the system's clipboard hands one over, with the markup a copy from an editor carries beside them. */
function paste(host: HTMLElement, text: string, files: readonly File[] = [], html = ""): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      types: [...(text === "" ? [] : ["text/plain"]), ...(html === "" ? [] : ["text/html"])],
      getData: (type: string) => {
        if (type === "text/plain") return text;
        return type === "text/html" ? html : "";
      },
    },
  });
  composerEditor(host).dispatchEvent(event);
}

test("the words a box opens on stand as they were written, a known skill's /name a chip, and each change hands the words back", () => {
  const box = mounted("Cut it with /release now\nthen tell me");
  assert.deepEqual(box.chips(), ["/release"]);
  assert.deepEqual(box.drafts, [], "the words opened on are not handed back");

  typeInComposer(box.host, ", please");
  assert.deepEqual(box.drafts, ["Cut it with /release now\nthen tell me, please"]);

  typeInComposer(box.host, "\nThanks");
  assert.equal(box.drafts.at(-1), "Cut it with /release now\nthen tell me, please\nThanks");
});

test("clear and replace each land once, the caret at the words' end, and hand the words back once", () => {
  const box = mounted("Fix the bug");

  box.handle.replace("Try /deploy again");
  assert.deepEqual(box.drafts, ["Try /deploy again"]);
  assert.deepEqual(box.chips(), ["/deploy"], "a restored skill is its chip again");
  typeInComposer(box.host, "!");
  assert.equal(box.drafts.at(-1), "Try /deploy again!", "the caret stands at the end");

  box.handle.clear();
  assert.deepEqual(box.drafts.slice(2), [""]);
  assert.deepEqual(box.chips(), []);
  box.handle.clear();
  assert.equal(box.drafts.length, 3, "emptying an empty box hands nothing back");
});

test("Enter sends, Shift+Enter breaks the line, and an Enter an input method is composing sends nothing", () => {
  const box = mounted("Ship it");

  pressInComposer(box.host, "Enter");
  assert.equal(box.sends.count, 1);

  pressInComposer(box.host, "Enter", { shiftKey: true });
  assert.equal(box.sends.count, 1);
  assert.equal(box.drafts.at(-1), "Ship it\n");

  pressInComposer(box.host, "Enter", { isComposing: true });
  pressInComposer(box.host, "Enter", { keyCode: 229 });
  assert.equal(box.sends.count, 1, "the Enter that commits a composed word never sends");
});

test("on a coarse pointer Enter is a new line, ⌘ or Ctrl with Enter sends, and the return key says so", () => {
  pointerIs(true);
  const box = mounted("Ship it");
  assert.equal(composerEditor(box.host).getAttribute("enterkeyhint"), "enter");

  pressInComposer(box.host, "Enter");
  typeInComposer(box.host, "today");
  assert.equal(box.sends.count, 0);
  assert.equal(box.drafts.at(-1), "Ship it\ntoday");

  pressInComposer(box.host, "Enter", { metaKey: true });
  pressInComposer(box.host, "Enter", { ctrlKey: true });
  assert.equal(box.sends.count, 2);
});

test("with a mouse Enter sends, and the return key says Send", () => {
  pointerIs(false);
  const box = mounted("Ship it");
  assert.equal(composerEditor(box.host).getAttribute("enterkeyhint"), "send");

  pressInComposer(box.host, "Enter");
  assert.equal(box.sends.count, 1);
  assert.equal(box.drafts.at(-1), undefined, "the words stand as they were");
});

test("a key the owner takes is the owner's alone", () => {
  const box = mounted("Ship it", { onKey: (event) => event.key === "Enter" });
  const event = pressInComposer(box.host, "Enter");
  assert.equal(box.sends.count, 0);
  assert.equal(event.defaultPrevented, true);
});

test("the bound refuses a keystroke past it, and a paste past it is cut to the room left", () => {
  const box = mounted("12345678", { maxLength: 10 });

  typeInComposer(box.host, "9");
  typeInComposer(box.host, "ab");
  assert.equal(box.drafts.at(-1), "123456789", "words past the bound are not taken");

  paste(box.host, "xyz");
  assert.equal(box.drafts.at(-1), "123456789x");
  paste(box.host, "more");
  assert.equal(box.drafts.at(-1), "123456789x", "a full box takes no paste");
});

test("the owner is told of a paste that was cut, a paste with no room left included, and of none that went in whole", () => {
  let cuts = 0;
  const box = mounted("12345678", {
    maxLength: 10,
    onPasteCut: () => {
      cuts += 1;
    },
  });

  paste(box.host, "x");
  assert.equal(box.drafts.at(-1), "12345678x");
  assert.equal(cuts, 0, "a paste that fits is not a cut one");

  paste(box.host, "yz");
  assert.equal(box.drafts.at(-1), "12345678xy");
  assert.equal(cuts, 1, "a paste past the bound is told");

  paste(box.host, "more");
  assert.equal(box.drafts.at(-1), "12345678xy");
  assert.equal(cuts, 2, "a paste with no room left is told too");
});

test("a pasted image goes to the owner and not into the words, and pasted lines stand as they were, blank ones too", () => {
  const box = mounted("");
  const image = new File(["png"], "shot.png", { type: "image/png" });

  paste(box.host, "", [image]);
  assert.deepEqual(box.pasted, [[image]]);
  assert.deepEqual(box.drafts, []);

  paste(box.host, "one\n\nthree /release");
  assert.equal(box.drafts.at(-1), "one\n\nthree /release");
});

test("a dictation's words land where the caret was marked, carried through changes since: between two chips, and at the end", () => {
  const box = mounted("/release /deploy");
  // The document holds the first chip at 1, then a space, then the second chip.
  box.caretAt(2);
  const between = box.handle.mark();
  box.caretAt(1);
  typeInComposer(box.host, "Run ");
  box.caretAt(1);
  const end = box.handle.mark();

  assert.equal(between.insert("the build with"), true);
  assert.equal(box.drafts.at(-1), "Run /release the build with /deploy");
  typeInComposer(box.host, ",");
  assert.equal(
    box.drafts.at(-1),
    "Run /release the build with, /deploy",
    "the caret stands after the words",
  );

  box.handle.setInput(COMPOSER_INPUT.READ_ONLY);
  typeInComposer(box.host, "typed");
  assert.equal(
    box.drafts.at(-1),
    "Run /release the build with, /deploy",
    "read-only takes no typing",
  );
  assert.equal(end.insert("now"), true, "but takes a mark's words");
  assert.equal(box.drafts.at(-1), "now Run /release the build with, /deploy");
});

test("a dictation's words a full box has no room for are not put in", () => {
  const box = mounted("1234567", { maxLength: 8 });
  assert.equal(box.handle.mark().insert("words"), false);
  assert.deepEqual(box.drafts, []);
});

test("one Backspace takes a chip out whole, and no attribute in the box carries a skill's name", () => {
  const box = mounted("Use /release");
  for (const element of composerEditor(box.host).querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.value, /release/u, `${element.tagName} ${attribute.name}`);
    }
  }

  pressInComposer(box.host, "Backspace");
  assert.deepEqual(box.drafts, ["Use "]);
  assert.deepEqual(box.chips(), []);
});

test("a / word the caret ends is reported as it is typed, and a pick writes its chip and a space", () => {
  const box = mounted("");

  typeInComposer(box.host, "Run /rel");
  assert.deepEqual(
    box.triggers.filter((each) => each !== undefined).map(({ start, query }) => ({ start, query })),
    [{ start: 4, query: "rel" }],
  );

  box.handle.chooseSkill("release");
  assert.equal(box.drafts.at(-1), "Run /release ");
  assert.deepEqual(box.chips(), ["/release"]);
  assert.equal(box.triggers.at(-1), undefined, "the word is no longer being typed");
  typeInComposer(box.host, "now");
  assert.equal(box.drafts.at(-1), "Run /release now");
});

test("a /name typed or read later becomes its chip once the caret has left it, and a / in a word or in code stays words", () => {
  const box = mounted("");
  typeInComposer(box.host, "/release");
  assert.deepEqual(box.chips(), [], "a word still being typed stays words");
  typeInComposer(box.host, " and a/deploy and `/deploy` too");
  assert.deepEqual(box.chips(), ["/release"]);

  const later = mounted("Cut /release now", { skills: new Set() });
  assert.deepEqual(later.chips(), []);
  later.handle.setSkills(SKILLS);
  assert.deepEqual(later.chips(), ["/release"]);
  assert.deepEqual(later.drafts, [], "the words are the same words");
});

test("a chip copied from a box is a chip again where its skill is known, and words where it is not", () => {
  const box = mounted("");
  const copied = (name: string) => `<p>Run <span data-chip="skill">/${name}</span> now</p>`;

  paste(box.host, "Run /release now", [], copied("release"));
  assert.deepEqual(box.chips(), ["/release"]);
  paste(box.host, " and /elsewhere", [], copied("elsewhere"));
  assert.deepEqual(box.chips(), ["/release"], "a skill this repository keeps none of stays words");
  assert.equal(box.drafts.at(-1), "Run /release nowRun /elsewhere now");
});

test("the list's word is reported again as the words scroll under it", () => {
  const box = mounted("");
  typeInComposer(box.host, "Run /rel");
  assert.equal(box.triggers.at(-1)?.rect.top, 0);

  // The words scrolled up: the slash now stands 40 pixels lower in the window.
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 40, 0, 16);
  composerEditor(box.host).dispatchEvent(new Event("scroll"));
  assert.deepEqual(box.triggers.at(-1), {
    start: 4,
    query: "rel",
    rect: { left: 10, top: 40, bottom: 56 },
  });
});

/** A box mounted with mentions, every report and drawn mention written down. */
function mountedWithMentions(text: string) {
  const reported: (ComposerTrigger | undefined)[] = [];
  const drawn: string[] = [];
  const box = mounted(text, {
    mentions: {
      onTrigger: (trigger) => reported.push(trigger),
      drawMention: (element, mention) => {
        element.textContent = `@${mention.name}`;
        drawn.push(`${mention.name} ${mention.target}`);
        return () => undefined;
      },
      // The panel reads the one page of an integration's this box is pasted.
      pasted: (words) => (words.trim() === ISSUE_URL ? ISSUE : undefined),
    },
  });
  return { ...box, reported, drawn };
}

/** A page of an integration's, as the panel names it. */
const ISSUE_URL = "https://linear.app/acme/issue/LUKE-142/fix-the-thing";
const ISSUE = { name: "LUKE-142/fix-the-thing", target: ISSUE_URL };

const STORE_LINK = "[@session-store.ts](luke://file/apps/web/session-store.ts)";

test("an @ word is reported to the mentions, and a pick writes the mention into the words as its link, a space after it", () => {
  const box = mountedWithMentions("");

  typeInComposer(box.host, "Fix @ses");
  const word = box.reported.at(-1);
  box.handle.chooseMention({
    name: "session-store.ts",
    target: "luke://file/apps/web/session-store.ts",
  });

  assert.equal(word?.query, "ses");
  assert.equal(box.drafts.at(-1), `Fix ${STORE_LINK} `);
  assert.deepEqual(box.drawn, ["session-store.ts luke://file/apps/web/session-store.ts"]);
});

test("words laid in with a mention's link hold it as its chip, and hand the same words back", () => {
  const box = mountedWithMentions("");

  box.handle.replace(`See ${STORE_LINK} first`);

  assert.deepEqual(box.drawn, ["session-store.ts luke://file/apps/web/session-store.ts"]);
  assert.equal(box.drafts.at(-1), `See ${STORE_LINK} first`);
});

test("one Backspace right after a mention takes it out whole", () => {
  const box = mountedWithMentions(`See ${STORE_LINK}`);

  typeInComposer(box.host, "");
  pressInComposer(box.host, "Backspace");

  assert.equal(box.drafts.at(-1), "See ");
});

test("a pick right before a chip replaces the @ word alone, and the chip stays", () => {
  const box = mountedWithMentions(`See ${STORE_LINK}`);

  // The caret right after "See ", before the chip: the paragraph opens at 1.
  box.caretAt(1 + "See ".length);
  typeInComposer(box.host, "@go");
  box.handle.chooseMention({ name: "Goal", target: "luke://plan/pl_1#Goal" });

  assert.equal(box.drafts.at(-1), `See [@Goal](luke://plan/pl_1#Goal) ${STORE_LINK}`);
});

test("a box with no mentions reports no @ word", () => {
  const triggers: (ComposerTrigger | undefined)[] = [];
  const box = mounted("", { onTrigger: (trigger) => triggers.push(trigger) });

  typeInComposer(box.host, "Fix @ses");

  assert.ok(triggers.every((trigger) => trigger === undefined));
});

test("an @ in code is the code's: no @ word is reported in a fence or a span", () => {
  const box = mountedWithMentions("");

  typeInComposer(box.host, "```\n@ses");
  const inFence = box.reported.at(-1);
  box.handle.replace("Run `x @ses` now");
  // Note that the code span's backticks are its mark's, which stand in no place of the document.
  box.caretAt(1 + "Run x @ses".length);

  assert.equal(inFence, undefined);
  assert.equal(box.reported.at(-1), undefined);
});

test("a box that takes no mentions shows a mention's link as the words it is, never a chip", () => {
  const box = mounted("");

  box.handle.replace(`See ${STORE_LINK}`);

  assert.equal(composerEditor(box.host).textContent, `See ${STORE_LINK}`);
  assert.equal(box.drafts.at(-1), `See ${STORE_LINK}`);
});

test("a page of an integration's pasted whole is laid in as its mention, a space after it, and other words paste as words", () => {
  const box = mountedWithMentions("");

  typeInComposer(box.host, "See ");
  paste(box.host, ` ${ISSUE_URL} `);
  typeInComposer(box.host, "first.");

  assert.equal(box.drafts.at(-1), `See [@LUKE-142/fix-the-thing](${ISSUE_URL}) first.`);
  assert.deepEqual(box.drawn, [`LUKE-142/fix-the-thing ${ISSUE_URL}`]);
});

test("a page's address pasted inside a code span stays the code's words", () => {
  const box = mountedWithMentions("");
  box.handle.replace("Run `x` now");

  box.caretAt(1 + "Run x".length);
  paste(box.host, ISSUE_URL);

  assert.deepEqual(box.drawn, []);
  const draft = box.drafts.at(-1) ?? "";
  assert.ok(!draft.includes("[@"), draft);
});

test("a page's address pasted on the line after a closing fence is laid in as its mention", () => {
  const box = mountedWithMentions("");
  box.handle.replace("```\ncode\n```\n");

  paste(box.host, ISSUE_URL);

  assert.deepEqual(box.drawn, [`LUKE-142/fix-the-thing ${ISSUE_URL}`]);
});

test("a mention laid in from elsewhere stands where the caret is, a space after it, and none is laid in past the box's bound", () => {
  const box = mountedWithMentions("Fix  first");
  const lines = {
    name: "invite.ts:2–3",
    target: "https://github.com/acme/relay/blob/HEAD/src/invite.ts#L2-L3",
  };
  const full = mounted("12345678", { maxLength: 10 });

  box.caretAt(1 + "Fix ".length);
  box.handle.insertMention(lines);
  full.handle.insertMention(lines);

  assert.equal(box.drafts.at(-1), `Fix [@invite.ts:2–3](${lines.target}) first`);
  assert.deepEqual(full.drafts, []);
});

/** The quote blocks the box holds, by their words. */
function quotesIn(host: HTMLElement): (string | null)[] {
  return [...host.querySelectorAll("[data-quote]")].map((element) => element.textContent);
}

test("a quote laid in stands as a block under the caret's line, the caret on a line under it, and reads out as a blockquote set apart", () => {
  const box = mounted("Two things:");
  assert.equal(box.handle.insertQuote("A or B?"), true);
  assert.deepEqual(quotesIn(box.host), ["A or B?"]);
  assert.equal(box.drafts.at(-1), "Two things:\n\n> A or B?\n\n");

  typeInComposer(box.host, "B.");
  box.handle.insertQuote("Ship today?");
  box.handle.insertQuote("Or wait?");
  typeInComposer(box.host, "Wait.");
  assert.equal(
    box.drafts.at(-1),
    "Two things:\n\n> A or B?\n\nB.\n\n> Ship today?\n\n> Or wait?\n\nWait.",
    "a quote laid in on an empty line takes its place, so quotes laid in one after another stack",
  );
});

test("words laid in with quotes set apart hold them as blocks, and hand the same words back", () => {
  const box = mounted("> A or B?\n>\n> Pick one.\n\nB.\n\n> Ship today?\n\nYes");
  assert.deepEqual(quotesIn(box.host), ["A or B?\n\nPick one.", "Ship today?"]);
  typeInComposer(box.host, "!");
  assert.equal(box.drafts.at(-1), "> A or B?\n>\n> Pick one.\n\nB.\n\n> Ship today?\n\nYes!");

  box.handle.replace("Above\n> runs into the line\nBelow");
  assert.deepEqual(quotesIn(box.host), [], "a > line run into its neighbours stays words");
});

test("one Backspace at the start of the line under a quote takes the quote out whole, and Delete at the end of the line above it too", () => {
  const box = mounted("");
  box.handle.insertQuote("A or B?");
  pressInComposer(box.host, "Backspace");
  assert.deepEqual(quotesIn(box.host), []);
  assert.equal(box.drafts.at(-1), "");

  typeInComposer(box.host, "Above");
  box.handle.insertQuote("A or B?");
  typeInComposer(box.host, "Below");
  box.caretAt(1 + "Above".length);
  pressInComposer(box.host, "Delete");
  assert.equal(box.drafts.at(-1), "Above\nBelow");
});

test("a quote is cut from its end to the room the bound leaves, and none is laid in where there is none", () => {
  const box = mounted("Hi", { maxLength: 30 });
  assert.equal(box.handle.insertQuote("Option A or option B or option C"), true);
  const written = box.drafts.at(-1) ?? "";
  assert.ok(written.length <= 30, written);
  assert.match(written, /^Hi\n\n> Option A.*…\n\n$/u);
  assert.equal(box.handle.insertQuote("More"), false);
});

test("each mark's chord lays it on the words selected and takes it off again, the words read out as its Markdown, and the window never hears the chord", () => {
  const box = mounted("Ship it now");
  const chords = [
    { key: "b", shiftKey: false, written: "Ship **it** now" },
    { key: "i", shiftKey: false, written: "Ship *it* now" },
    { key: "x", shiftKey: true, written: "Ship ~~it~~ now" },
    { key: "e", shiftKey: false, written: "Ship `it` now" },
  ];
  for (const { key, shiftKey, written } of chords) {
    box.select(1 + "Ship ".length, 1 + "Ship it".length);
    const heard = chord(box.host, key, shiftKey);
    assert.equal(box.drafts.at(-1), written, key);
    assert.equal(heard, false, `the window never hears ${key}`);

    chord(box.host, key, shiftKey);
    assert.equal(box.drafts.at(-1), "Ship it now", `${key} again takes it off`);
  }
});

test("a mark's Markdown typed becomes the mark, its delimiters gone from the words shown", () => {
  const box = mounted("");

  typeKeys(box.host, "a **bold** and *slanted* and ~~struck~~ and `code` word");

  assert.deepEqual(marked(box.host), {
    strong: ["bold"],
    em: ["slanted"],
    s: ["struck"],
    code: ["code"],
  });
  assert.equal(composerEditor(box.host).textContent, "a bold and slanted and struck and code word");
  assert.equal(box.drafts.at(-1), "a **bold** and *slanted* and ~~struck~~ and `code` word");
});

test("a message that comes back reads its Markdown back into marks, and reads out as it came", () => {
  const box = mounted("");
  const message =
    "Go **now**, *gently*, ~~not~~ `make it` per [the guide](https://example.com/guide) ***both*** ways";

  box.handle.replace(message);

  assert.deepEqual(marked(box.host), {
    strong: ["now", "both"],
    em: ["gently", "both"],
    s: ["not"],
    code: ["make it"],
    a: ["the guide"],
  });
  assert.equal(box.drafts.at(-1), message);
  typeInComposer(box.host, "!");
  assert.equal(box.drafts.at(-1), `${message}!`, "and an edit keeps every mark as it came");
});

test("words wearing no mark read out exactly as they came, stray asterisks, underscores, and backslashes among them", () => {
  const box = mounted("");
  const message = "5 * 3 is __init__ in my_var, \\*kept\\* ~one~ and an `open tick";

  box.handle.replace(message);
  typeInComposer(box.host, "!");

  assert.deepEqual(marked(box.host), {});
  assert.equal(box.drafts.at(-1), `${message}!`);
});

test("a chip among words selected and bolded stays the chip and wears no mark, and bolding them again takes the mark off", () => {
  const box = mounted("Ship /deploy now");
  box.selectAll();

  chord(box.host, "b");
  assert.equal(box.drafts.at(-1), "**Ship** /deploy **now**");
  assert.deepEqual(box.chips(), ["/deploy"]);
  assert.deepEqual(marked(box.host), { strong: ["Ship ", " now"] });

  chord(box.host, "b");
  assert.equal(box.drafts.at(-1), "Ship /deploy now");
  assert.deepEqual(box.chips(), ["/deploy"]);
});

test("words in code take no other mark, and a mark's Markdown typed there stays the code's words", () => {
  const box = mounted("Run `make it` now");
  box.select(1 + "Run ".length, 1 + "Run make it".length);

  chord(box.host, "b");
  assert.deepEqual(box.drafts, [], "the words are as they were, so none are handed back");

  box.caretAt(1 + "Run make".length);
  typeKeys(box.host, " **x**");
  assert.deepEqual(marked(box.host), { code: ["make **x** it"] });
});

test("a / typed in bold words still offers the skills, and a pick writes its chip outside the mark", () => {
  const box = mounted("Run");
  box.selectAll();
  chord(box.host, "b");
  box.caretAt(1 + "Run".length);

  typeInComposer(box.host, " /rel");
  assert.equal(box.triggers.at(-1)?.query, "rel");

  box.handle.chooseSkill("release");
  assert.deepEqual(box.chips(), ["/release"]);
  assert.equal(box.drafts.at(-1), "**Run** /release ");
});

test("Enter still sends words that wear marks, and Shift+Enter is still a new line", () => {
  const box = mounted("**Ship** it");

  pressInComposer(box.host, "Enter", { shiftKey: true });
  assert.equal(box.sends.count, 0);
  pressInComposer(box.host, "Enter");
  assert.equal(box.sends.count, 1);
});

test("⌘K over words selected opens the owner's link field and links them, and with none selected it is the window's", () => {
  const formats: EditorFormat[] = [];
  const links = { count: 0 };
  const box = mounted("Read the guide", {
    format: {
      onFormat: (format) => formats.push(format),
      onLink: () => {
        links.count += 1;
      },
    },
  });

  box.caretAt(1);
  assert.equal(chord(box.host, "k"), true, "a caret's ⌘K is the window's");
  assert.equal(links.count, 0);

  box.select(1 + "Read the ".length, 1 + "Read the guide".length);
  assert.equal(formats.at(-1)?.empty, false, "the toolbar is told of the words selected");
  assert.equal(chord(box.host, "k"), false, "the editor's alone");
  assert.equal(links.count, 1);

  box.handle.setLink("https://example.com/guide");
  assert.equal(box.drafts.at(-1), "Read the [guide](https://example.com/guide)");
  box.handle.toggleMark("writing-bold");
  assert.equal(box.drafts.at(-1), "Read the [**guide**](https://example.com/guide)");
});

test("pasted Markdown lands as its marks, a bare address pasted stays the words it is, and one pasted over words selected links them", () => {
  const box = mounted("");

  paste(box.host, "Ship **it** in my __init__ at https://example.com/a");
  assert.equal(box.drafts.at(-1), "Ship **it** in my __init__ at https://example.com/a");
  assert.deepEqual(marked(box.host), { strong: ["it"] });

  box.select(1 + "Ship ".length, 1 + "Ship it".length);
  paste(box.host, "https://example.com/b");
  assert.equal(
    box.drafts.at(-1),
    "Ship [**it**](https://example.com/b) in my __init__ at https://example.com/a",
  );
});

test("asterisks, tildes, brackets, and backslashes in marked words are escaped, so the words and their marks come back as they were", () => {
  const box = mounted("a **b ~~c] \\d");
  box.selectAll();

  chord(box.host, "b");
  const bolded = box.drafts.at(-1) ?? "";
  assert.equal(bolded, "**a \\*\\*b \\~\\~c\\] \\\\d**");
  box.handle.replace(bolded);
  assert.deepEqual(marked(box.host), { strong: ["a **b ~~c] \\d"] });
  assert.equal(box.drafts.at(-1), bolded);

  box.handle.replace("see a]b now");
  box.select(1 + "see ".length, 1 + "see a]b".length);
  box.handle.setLink("https://example.com");
  const linked = box.drafts.at(-1) ?? "";
  assert.equal(linked, "see [a\\]b](https://example.com) now");
  box.handle.replace(linked);
  assert.deepEqual(marked(box.host), { a: ["a]b"] });
});

test("a paste over part of a marked word is cut to fit the bound as the words would stand after it, delimiters and all", () => {
  const box = mounted("**it** ok", { maxLength: 12 });
  box.select(1, 2);

  paste(box.host, "abcde");

  assert.equal(box.drafts.at(-1), "abcd**t** ok");
});
