# Spike: seamless plan editing (TipTap and alternatives)

Status: spike, 2026-10-12. The draft PR that carries this is never merged.
Its code (`apps/desktop/src/renderer/spike/`, the swapped view in
`planning/plan-field-editor.tsx`) is evidence for the recommendation below,
not a starting point to merge.

Dean asked: "How are we doing editing? It feels a little clunky to have an
edit button and then open a textbox. Can we use something more seamless like
tiptap?"

## Today, verified in the code and in a browser

- **The way in.** A click into a field's words opens its editor (the pencil
  is the keyboard's way in). The heading stays drawn, and the words are
  swapped for a bordered box: a `textarea` of the field's raw Markdown for a
  text field, one item a line for the open questions and the assumptions,
  and for a rule a statement input plus a Given, When, and Then input per
  example, with "Add example" and "Delete rule" buttons.
- **What feels clunky** (screenshot below). The words jump into a box, and
  the formatting turns into syntax: `[support thread](https://…)`,
  `` `code` ``, `**bold**`. **The caret lands at the start of the box, not
  where you clicked** (`autoFocus`; the suite confirms it: text typed after a
  click mid-sentence lands at the field's start).
- **Saving.** The words save one second after the typing pauses, and again
  on close (Esc, ⌘↩, focus leaving). Note that **Esc saves and closes; it
  does not cancel**. The service merges the edit over what Luke wrote since
  its base with jsdiff under the row lock (`applyDeveloperEdit`). A conflict
  holds the editor open with Keep mine and Use Luke's, a failed save offers
  Try again, and the editor stays where it opened while Luke's live drafts
  arrive (#2022's hold). The editor sits under `ph-no-capture`.
- **The structure.** The plan is structured fields, and the body is formatted
  from them and never parsed back (`docs/proposals/plan-history-and-editing.md`).
  The editor works a field at a time, in the field's stored shape, through
  `plan-field-editor-model.ts`, which decides every save.
- **A latency cost nobody has noticed yet.** Every keystroke re-renders the
  whole `PlanBody`, every unit's `react-markdown` included, because the
  draft lives in the document's hook. On a long plan (60 rules, a
  30-paragraph field) that is **28–30 ms p50 and 40 ms p95 from key to frame
  on this VM, and 128 ms p50 under a 4× CPU throttle**.

## What the spike built

One small editor per field, with **no heading inside it**. The document goes
on drawing every heading as it does today, so the fixed template cannot be
broken by construction. Each field kind has its own schema of a few lines,
and each editor reads and writes the field's stored shape, with no
body→fields parser:

| Field | Editor document | Stored as |
| --- | --- | --- |
| Text fields (Problem, Decisions, …) | paragraphs, lists, code blocks, quotes, bold, italic, strike, inline code, links; anything else (a table, HTML) kept as an untouchable block | the field's Markdown |
| Open questions, assumptions | one bullet list, an item a paragraph | the items |
| A rule | its statement, then examples of exactly Given, When, and Then, the labels drawn and never typed | `{statement, examples}` |

- **Markdown without a new parser.** `spike/field-markdown.ts` turns a
  field's Markdown into a ProseMirror document and back over
  `mdast-util-from-markdown` and `mdast-util-to-markdown`, which
  `react-markdown` and `remark-gfm` already put in the renderer (+7.6 KB
  raw for the printer handlers not yet reached).
- **Untouched blocks keep their bytes.** A printer normalises (`_em_` to
  `*em*`, a soft wrap joined), and re-printing a whole field would hand the
  service's line merge a "change" on every line, which is what turns Luke's
  concurrent writes into conflicts. ProseMirror keeps an untouched node's
  identity across edits, so every block, list item, statement, or clause the
  developer did not touch is written back as its original source. Only the
  block they typed in is re-printed.
- **The save model is untouched.** The view feeds the same
  `editing.typeText` and `editing.typeRule`, so the merge, the conflict, the
  retry, the hold, and attribution behave as shipped. The view changed in
  three places: the click point is passed so the caret lands where the
  pointer was (`posAtCoords`), the box chrome is gone (a quiet wash marks the
  open field), and drafts are coalesced (below).
- **Rules type like a form.** Enter walks Statement → Given → When → Then,
  Enter on Then adds the next example, Backspace in an empty example strikes
  it, and emptying the statement strikes the rule, as the model already did.
- **Markdown input rules** for `- `, `1. `, ```` ``` ````, `> `, `**b**`,
  `*i*`/`_i_`, `` `c` ``, `~~s~~`, and `[text](https://…)`, plus ⌘B, ⌘I, ⌘E,
  ⌘Z, ⇧⌘Z, Tab and ⇧Tab in lists, and ⇧↩ for a line break.

The same field-editor seam was then filled four ways and driven by one
headless-Chrome suite over the real `PlanBody`, with a fake service running
the real `applyDeveloperEdit`.

## Demo

Today (left): a click opens a box of raw Markdown with the caret at the
start. The spike (right): the same words, still formatted, with the caret
where the click landed.

![Today vs the spike](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/today-vs-seamless.png)

Click, type `**often** `, Esc. The shortcut turns into bold as it is typed,
and the save lands as Markdown:

![Typing in place](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/seamless-edit.gif)

| A rule: Enter walks the clauses and adds an example | The open questions: Enter makes the next one |
| --- | --- |
| ![Rule](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/rule-editing.png) | ![List](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/list-editing.png) |

Luke rewrites the section mid-edit, and the shipped conflict choice stands
under the editor:

![Conflict](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/conflict.png)

## Measurements

The bundle is `renderer.js` built with `scripts/build.mjs`'s options from a
clean `main` checkout, plus each prototype, gzipped at level 9 as the budget
check does (`node apps/desktop/scripts/spike-seamless-editing/measure.mjs`). `main` measures
**714,225** against a baseline of 698,487, a ceiling of **733,411**, and
**19,186 bytes of headroom**. The lazy column is the editor built as a bundle
of its own with no React, loaded the way `whiteboard.js` is.

Latency is key to the next frame (rAF, then a task) while typing 132
characters 35 ms apart into a 20-paragraph field of the long plan. All four
in-place editors include the draft coalescing; without it the ProseMirror
prototype measured the same as today (30.7 ms p50), because the cost is the
document's re-render, not the editor.

| | Today (textarea) | **Minimal ProseMirror** | TipTap 3.31 | Lexical 0.52 | contenteditable + own serializer |
| --- | --- | --- | --- | --- | --- |
| `renderer.js` gz | 714,225 | 786,967 | 847,514 | 858,963 | 715,397 |
| Δ vs `main` | — | **+72,742** | +133,289 (+153,071 with `@tiptap/markdown`) | +144,738 | +1,172 |
| vs ceiling 733,411 | under by 19,186 | over by 53,556 | over by 114,103 | over by 125,552 | under by 18,014 |
| As a lazy bundle (gz, on disk) | — | **99,262** (load+eval 17–26 ms, first mount 14–17 ms; 4×: 41 ms, 60 ms) | 152,493 | 137,074 | — |
| Typing p50 / p95, long plan | 28.4 / 40.1 ms | **5.0 / 17.6 ms** | 4.6 / 16.5 ms | 5.0 / 17.4 ms | 5.0 / 17.0 ms |
| Same, 4× CPU throttle | 128.6 / 182.4 ms | 18.7 / 26.9 ms | 18.0 / 26.7 ms | 16.6 / 23.9 ms | 14.0 / 23.6 ms |
| Caret where clicked | ✗ (start of box) | ✓ | ✓ | ✓ | ✓ after clamping by hand |
| Formatting shown while editing | ✗ raw Markdown | ✓ | ✓ | ✓ | ✓ |
| Rules (statement + G/W/T) | inputs + buttons | ✓ schema, Enter walks clauses | ✓ same schema as 6 nodes | ✗ not prototyped (no schema language; 6 `ElementNode` classes) | ✗ **lost the rule's examples on save** |
| Lists (Enter = new item) | one a line | ✓ | ✓ | ✓ | ✗ typed item lost |
| One character added: lines rewritten | 1 | 1 (edited block only) | 1 (edited block only) | whole field re-printed; `__strong__` saved as *italic*, `1)` list and `[link][ref]` read as text | 6 rewritten, the typed `!` lost, `\*literal\*` turned into emphasis |
| Undo / redo (⌃Z, ⇧⌃Z) | undo ✗ in the headless test | ✓ | ✓ | ✓ | ✓ until anything rewrites the DOM |
| IME (CDP composition, 日本) | ✓ | ✓ | ✓ | ✓ | ✓ |
| HTML paste (h1, bold, styles, table) | n/a | heading → paragraph, bold kept, styles dropped | same | same, table cells split | plain text only, bold lost |
| Live drafts into another field mid-edit | ✓ hold | ✓ words and focus kept | ✓ | ✓ | ✓ |
| Luke rewrites the edited field | ✓ conflict | ✓ conflict | ✓ | ✓ | ✓ |
| Screen reader | textbox "Outcome", multiline | textbox "Outcome", multiline | same | same | same |
| Session replay | inside `ph-no-capture` | inside `ph-no-capture` | same | same | same |

The runs are from a Linux VM in headless Chrome 154; a Mac is faster. The
p95 of ~17 ms in every in-place column is one 60 Hz frame. The suite, the frame, and
the lazy-load scripts are beside `measure.mjs` in
`apps/desktop/scripts/spike-seamless-editing/`.

### What the table means

- **Every real editor is over the budget in `renderer.js`**, the minimal
  ProseMirror one by 53 KB. `prosemirror-view` alone is 99 KB minified.
  Shipping one in the main bundle means a **baseline move** (CLAUDE.md:
  "A bundle-budget baseline moves only for a deliberate library adoption"),
  which is Dean's call.
- **The editor as a bundle of its own needs no baseline move.** ProseMirror
  imports no React, so the editor can be a framework-free `field-editor.js`
  beside `whiteboard.js`, with the same one-global contract. `renderer.js`
  keeps a door of a few hundred bytes. Prefetched when a plan opens, the
  ~20 ms load is gone before the first click, and the first mount is ~15 ms.
- **TipTap is ProseMirror plus 60 KB gz** of extension framework (`@tiptap/core`
  86 KB raw, `linkifyjs` 20 KB, list and link extensions, the React binding,
  `fast-equals`). Its strengths are menus, collaboration, and an extension
  marketplace, and this editor uses none of them. Its three field schemas
  are custom nodes either way. `@tiptap/markdown` adds `marked` and re-prints
  the whole field on every save, which is exactly the merge noise the source
  preservation avoids. The two are the same engine, so the spike's TipTap
  prototype reuses the ProseMirror prototype's commands and Markdown bridge
  unchanged. Choosing ProseMirror is not a dead end: moving to TipTap later
  costs only the wrappers.
- **Lexical is the largest** (core 210 KB raw), has no schema language for a
  rule's fixed shape, and its Markdown transformers are lossy and re-print
  the whole field.
- **Plain contenteditable is the only option inside the budget**, and the
  suite shows why nobody ships it. With no schema, the rule's structure is
  gone, Enter writes whatever the browser likes, and the hand serializer
  changed meaning on a one-character edit. Doing it properly means building
  a worse ProseMirror.
- **The latency win is independent of the editor.** Coalescing drafts (one
  per 150 ms pause, flushed on close) takes the long plan from 28 ms to 5 ms
  p50, and from 128 ms to under 20 ms throttled. Memoising the units would
  give today's textarea the same win.

### Coexistence

- **Luke's live typing (`plan-reveal.ts`).** Unchanged. The chase draws the
  read view, and while a field is open the chase's drawing of that unit is
  suppressed, as it is today. On close the developer's own edit lands at
  once (`ownEdit`). The suite pushed live drafts into another field every
  60 ms while typing: the editor kept its words and its focus.
- **Live drafts and conflicts (#2022).** The model is unchanged, so the hold,
  Keep mine, and Use Luke's behave as shipped (screenshot above). A
  ProseMirror editor also opens a later option that a textarea cannot have
  (PR 6 below).
- **The fixed template.** Headings are outside every editor. The text schema
  parses a pasted `h1`–`h4` as a paragraph and has no heading input rule,
  and the formatter still escapes any field line that would open a heading.
- **Session replay.** The editor is a `contenteditable`, so its words are DOM
  text, masked by `mask_all_text` like every other text node. The editor
  also stands under `ph-no-capture` (the field section and the editor host),
  because the recorder would otherwise capture one DOM mutation per
  keystroke, the rhythm of the typing. The suite asserts every editable
  node is inside a blocked subtree. No new way of drawing words leaves the
  machine. The production PR should keep a test that the host carries the
  class.
- **Accessibility.** The editor root is `role="textbox"`,
  `aria-multiline="true"`, and `aria-label` is the field's name, which the AX
  tree reads exactly as it reads today's textarea. A rule's labels are
  `contenteditable="false"` text that is read but never typed. The pencil
  stays as the keyboard's way in, with the caret at the end. VoiceOver needs
  the Mac pass.
- **IME, undo, paste.** ProseMirror owns composition, and the CDP
  composition test committed 日本 in every engine. A real macOS IME (kana,
  pinyin, Hangul, press-and-hold accents) must be checked on a Mac. Undo is
  per editor session, as it is for a textarea. HTML paste is normalised by
  the schema.

### Bugs found on the way

1. `useFieldEditing`'s `changed` updates state but not the `latest` ref that
   `close()` reads. With drafts arriving asynchronously, Esc within 150 ms
   of the last key saved the words before it. Today's synchronous textarea
   path never hits this, but any coalescing or async editor does. The spike
   fixes it, and it belongs in PR 1.
2. In the read view, a bold word inside a rule's example clause draws as a
   muted label, because `.plan-rule-body li > strong` matches any bold word
   that is a direct child (visible on "as a **member**" in the screenshots).
   This is a small CSS fix to mark the label by class.

## Follow-up: an off-the-shelf Markdown layer instead of ours

The hand-rolled part that breeds edge cases is the Markdown bridge
(`field-markdown.ts`), together with the input rules and keymaps beside it. A
second round measured four libraries that would replace it, with the
same edge cases opened in each editor and read back, once untouched and once with
one character typed (`apps/desktop/src/renderer/spike/libs/`, raw results in
the PR's round-trip table). The sizes are against the same `main` build
(which has since moved to #2086, baseline 733,811, with a lazy `file-tree.js`
bundle beside `whiteboard.js`).

| Edited paragraph holds | Ours | **Milkdown 7.22** | TipTap 3.31 + markdown, task list, table, image | prosemirror-markdown |
| --- | --- | --- | --- | --- |
| `_em_`, `__strong__`, soft wrap | normalised to `*em*`, `**strong**` | **kept as written** | normalised | normalised, wrap joined |
| `- [ ]` task list | **checkboxes dropped** | kept | kept | **escaped, broken** |
| `![image](…)` | **escaped, broken** | kept | needs `inline: true` | kept |
| `<kbd>` inline HTML | **escaped, broken** | kept | **stripped** | kept |
| Footnote `[^1]` | **escaped, broken** | kept | **escaped, broken** | **escaped, broken** |
| `[text][ref]` | **escaped, broken** | inlined to `[text](url)` | inlined | inlined |
| Table | kept, not editable | kept, editable | re-padded | **flattened to one line** |
| `-` bullets | kept | printed as `*` (a printer option) | kept | printed as `*` |
| `renderer.js` Δ gz | +72,819 | +107,871 | +160,195 | +114,655 |
| As a lazy bundle gz | 99,389 | 139,627 | 158,803 | 114,366 |

MDXEditor (Lexical, Markdown-first) measured +247,555 gz and was not taken
further. BlockNote stores blocks and exports Markdown lossily, so it was
ruled out.

**Milkdown is the right replacement.** It is ProseMirror with remark as its
Markdown layer, the same parser `react-markdown` and `remark-gfm` already
use for the read view. So the editor and the drawn document agree on what a
field's Markdown means by construction, and the long tail (task lists,
images, HTML, footnotes, tables) survives an edit. It shares the renderer's
remark and micromark, which is why it costs less inside the bundle than as a
lazy bundle. What it removes from our code: the Markdown bridge, the input
rules, the text-field keymaps, and the paste handling (its commonmark and gfm
presets and clipboard plugin). Most of the source preservation can go too:
set the printer's options to the notetaker's style (`-` bullets), or
normalise stored fields once with the same remark printer on the service.

What stays ours either way, because no library knows the plan:

- the rule editor's Given/When/Then schema, on the ProseMirror that Milkdown
  re-exports, at no extra bytes;
- the list fields as one bullet list, and the assumptions as plain text;
- the glue to `plan-field-editor-model.ts`.

The risks are a smaller community than TipTap's and one lead maintainer, on a
major (v7) that has been stable for years. It is MIT licensed.

## Recommendation

**Milkdown for the text fields (revised after the follow-up above), one
editor per field, with the rule and list editors on the ProseMirror it
re-exports, and no heading in any editor.** The first round's own mdast
bridge was smaller (99 KB lazy, against Milkdown's 140 KB) but broke five of
the long-tail cases on an edit. Each of those is a fix we would own forever,
and Milkdown already handles them with the read view's own parser. Not TipTap:
it is larger, still loses inline HTML and footnotes, and its Markdown parser
(`marked`) is not the one the read view draws with.

**Bundle approval: needed in either form, and Dean should pick.**

- **Lazy (recommended), like `whiteboard.js` and `file-tree.js`.**
  `renderer.js` does not move (a few hundred bytes of door). A new budget
  entry, `renderer/field-editor.js` at ~140 KB gz, is a new bundle's first
  baseline rather than a move of the renderer's, but it is still a recorded
  number Dean should OK.
- **In `renderer.js`.** Simpler, with no loader, but about +108 KB gz. That
  needs a **renderer baseline move** under CLAUDE.md's rule. The spike branch
  records one (787,092, for the first round's editor) only so the branch
  builds.

## Migration plan

Each PR is independently shippable, and each ships behind nothing, because
each falls back to today's editor.

1. **The field editor stops re-rendering the document on every keystroke.**
   S, ~100 lines. Memoise `BodyUnit`, move `changed` onto the ref (bug 1),
   and fix the rule-label CSS (bug 2). Low risk; worth shipping even if
   nothing else here does. Test: a long-plan typing test that counts no
   re-render of untouched units through their public output; the label
   colour by class.
2. **`field-editor.js`: a Milkdown field editor as a bundle of its own.**
   M, ~500 lines with tests. Milkdown's commonmark and gfm presets with the
   heading node left out and the printer set to the notetaker's style, the
   rule and list schemas on its ProseMirror, a `contract.ts` mirroring
   `whiteboard/contract.ts`, the `build.mjs` entry, and the new budget entry
   (**Dean's OK**). Tests in vitest with no DOM for the round trips: open a
   field, change nothing, get the same bytes; touch one block, get one block
   re-printed; items and clauses likewise; a rule's shape. Risk: the loader
   failing, answered by falling back to the textarea.
3. **A field opens in place, the caret where you clicked.** M, ~300 lines.
   Swap `PlanFieldEditor`'s view for the lazy editor, prefetch it when a plan
   opens, pass the click point, keep the pencil, show the textarea until the
   bundle has loaded or if it fails, and use Enter and Backspace for rules
   with a quiet "Delete rule". Amend `docs/PLANNING.md` and
   `docs/DESIGN.md`. Needs `verify.sh` evidence on a Mac (IME, VoiceOver,
   trackpad selection), since CI builds nothing for the Mac. Risk: a caret
   or selection edge case in WebKit-only gestures, answered by the Mac pass
   (LUKE-159).
4. **Paste and shortcuts.** S. Plain-text paste parsed as Markdown, ⌘K for a
   link, ⌘-click opens a link while editing, and a per-field placeholder.
5. **Copy and Markdown fidelity follow-up.** S. Decide whether a touched
   block's normalisation (`_em_` to `*em*`) is acceptable or whether the
   formatter should normalise every field the same way once, so stored and
   printed Markdown agree. Product call: low stakes, but it should be made
   once, deliberately.
6. **Later, its own spike: Luke's writes woven into an open editor.** L,
   risky. Apply Luke's change to the field as ProseMirror steps mapped
   through the developer's own steps (collaboration-lite), so most conflicts
   disappear and the chase could type inside the editor. Only ProseMirror,
   TipTap, and Lexical make this possible at all; a textarea cannot.

Not run here: `./scripts/verify.sh` (macOS only; this was a Linux VM). CI
cannot verify the Mac UI. The screenshots are headless Chrome on Linux over
the real renderer modules and stylesheet, not the Electron window.
