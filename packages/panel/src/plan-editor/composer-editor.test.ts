// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
} from "./contract.js";

/**
 * The message box's editor through its mount and its handle: the words read
 * out as the one string a message is, every change from outside landing
 * once, Enter and an input method's Enter, the bound, a paste, a dictation's
 * mark, and a skill's chip, which one Backspace takes out whole and whose
 * name stands in no attribute the recording would keep.
 */

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
  };
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

test("the space a pick writes at the end of the words is drawn, under the panel's own stylesheet", () => {
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync(`${__dirname}/../styles/tasks.css`, "utf8");
  document.head.append(sheet);
  const box = mountedWithMentions("");

  typeInComposer(box.host, "Fix @ses");
  box.handle.chooseMention({
    name: "session-store.ts",
    target: "luke://file/apps/web/session-store.ts",
  });
  const editor = composerEditor(box.host);
  const spacing = getComputedStyle(editor).whiteSpace;
  sheet.remove();

  assert.equal(editor.querySelector("p")?.lastChild?.textContent, " ");
  // Note that a space ending a line collapses under `normal`, which leaves the caret against the chip.
  assert.equal(spacing, "pre-wrap");
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
  box.caretAt(1 + "Run `x @ses".length);

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

  box.caretAt(1 + "Run `x".length);
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
