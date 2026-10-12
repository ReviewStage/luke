# Spike: seamless plan editing

Status: spike, 2026-10-12. The draft PR that carries this is never merged.
Its code (`apps/desktop/src/renderer/spike/`, the swapped view in
`planning/plan-field-editor.tsx`) is evidence for the plan below, not a
starting point to merge.

Dean asked: "How are we doing editing? It feels a little clunky to have an
edit button and then open a textbox. Can we use something more seamless like
tiptap?" After two rounds of comparison he chose TipTap, with the direction
to keep our own code minimal and rely on the library wherever it can.

## Today

- **The way in.** A click into a field's words (or its pencil) swaps them for
  a bordered box: the field's raw Markdown in a `textarea`, a list one item a
  line, or a rule as a statement input and Given, When, and Then inputs per
  example with "Add example" and "Delete rule" buttons.
- **What feels clunky.** The words jump into a box, formatting turns into
  syntax (`[support thread](https://…)`), and the caret lands at the start of
  the box rather than where you clicked.
- **Saving.** The words save one second after the typing pauses and on close
  (Esc, ⌘↩, focus leaving). **Esc saves; it does not cancel.** The service
  merges the edit over Luke's writes since its base (`applyDeveloperEdit`),
  a conflict offers Keep mine or Use Luke's, and the editor holds its words
  while Luke's live drafts arrive (#2022).
- **A cost nobody had noticed.** Every keystroke re-renders the whole
  `PlanBody`. On a long plan that is 28 ms p50 and 40 ms p95 from key to
  frame on this VM, and 128 ms p50 under a 4× CPU throttle.

## What the spike builds

One TipTap editor per field, opened in place of the field's drawn words, with
**no heading inside it**. The document draws every heading as it does today,
so the fixed template cannot be broken by editing. The editor wears the read
view's own classes, so nothing moves as it opens. It has no box, and the
caret is the only sign of editing.

**TipTap's.** All of the editing itself comes from TipTap:
- StarterKit: paragraphs, lists, code blocks, quotes, bold, italic, strike,
  inline code, links, undo and redo, and the Markdown typing shortcuts and
  keys.
- `@tiptap/markdown` reads and writes each field's Markdown.
- Task lists, tables, and images, so a field holding them survives an edit.
- The placeholder.

**Ours** (`spike/field-editor.tsx`, `spike/rule-extension.ts`, and the glue
in `plan-field-editor.tsx`):

- **The rule's fixed shape.** Six small TipTap nodes: a statement, then
  examples of exactly Given, When, and Then, the labels drawn and never
  typed. Enter walks Statement → Given → When → Then and adds the next
  example; Backspace in an empty example strikes it. Each part's inline words
  go through TipTap's own Markdown manager.
- **Which kind of field is which.** The open questions open as a Markdown
  list. The assumptions open and save as plain text, because the document
  draws them as plain text.
- **The caret where you clicked.** One `posAtCoords` call.
- **Drafts coalesced.** One per 150 ms pause, flushed on close, so the
  document stops re-rendering on every keystroke.
- **Nothing else.** The save model is untouched: the editor feeds the same
  `typeText` and `typeRule` as the text boxes did, so the merge, the
  conflict, the retry, the hold, and attribution behave as shipped.

## Demo

Today (left): a click opens a box of raw Markdown with the caret at the
start. The spike (right): the same words, still formatted, with the caret
where the click landed.

![Today vs the spike](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/today-vs-seamless.png)

Click, type `**often** `, Esc. The shortcut becomes bold as it is typed:

![Typing in place](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/seamless-edit.gif)

| A rule: Enter walks the clauses and adds an example | The open questions: Enter makes the next one |
| --- | --- |
| ![Rule](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/rule-editing.png) | ![List](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/list-editing.png) |

Luke rewrites the section mid-edit, and the shipped conflict choice stands
under the editor:

![Conflict](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/conflict.png)

## Measurements

The headless-Chrome suite (`apps/desktop/scripts/spike-seamless-editing/suite.mjs`)
drives the real `PlanBody` against a fake service running the real
`applyDeveloperEdit`. It ran on Linux in headless Chrome 154, and a Mac is
faster.

| | Today (textarea) | TipTap in place |
| --- | --- | --- |
| Caret where clicked | ✗ start of the box | ✓ |
| Formatting while editing | ✗ raw Markdown | ✓ |
| Typing p50 / p95, long plan | 28.4 / 40.1 ms | **4.5 / 17.6 ms** (p95 is one 60 Hz frame) |
| Same, 4× CPU throttle | 128.6 / 182.4 ms | 16.2 / 24.4 ms |
| Rule: Enter to next clause, new example | inputs and buttons | ✓ |
| List: Enter makes the next item | one a line | ✓ |
| Open a field and leave it untyped | saves nothing | saves nothing, every field kind |
| Undo / redo | ✗ undo in the headless test | ✓ |
| IME (composition of 日本) | ✓ | ✓ |
| HTML paste (heading, bold, styles, table) | n/a | heading → paragraph, bold kept, styles dropped, table kept as a table |
| Luke's live drafts into another field mid-edit | ✓ hold | ✓ words and focus kept |
| Luke rewrites the edited field | ✓ conflict | ✓ conflict |
| Screen reader | textbox "Outcome", multiline | the same |
| Session replay | inside `ph-no-capture` | the same; every editable node checked |

### Bundle

| `renderer.js` gz | |
| --- | --- |
| `main` (#2086) | 736,347 (baseline 733,811, ceiling 770,501) |
| With TipTap inside | **905,662 (+169 KB)**, recorded as this branch's baseline so it builds |
| As a lazy `field-editor.js` instead | `renderer.js` unmoved; the new bundle is ~226 KB gz, since it carries its own React |

What the 169 KB is (minified, before gzip): the editor engine
(`prosemirror-*` and `@tiptap/core`, ~330 KB), `marked` (88 KB),
tables (`prosemirror-tables` and the extension, 48 KB), lists (22 KB),
`@tiptap/markdown` (21 KB), and `linkifyjs` for links (20 KB). Dropping
tables would save about 14 KB gz. The cost is that a field holding a table
would lose it on its first edit, because the whole field is re-printed.

### What relying on the library costs

- **An edit re-prints the whole field in TipTap's Markdown style.** For what
  Luke writes (`-` bullets, inline code, bold, links), that is byte-identical,
  so an edit changes only the lines the developer changed. Hand-written
  variants are normalised the first time anyone edits the field: `* ` to
  `- `, `1)` to `1.`, `_em_` to `*em*`, `[text][ref]` to `[text](url)`, and
  **a soft-wrapped line becomes a hard line break**. That last one is
  visible. Normalised lines also count as the developer's change in the
  service's merge, so a field written in another style can conflict with
  Luke more often on its first edit.
- **Inline HTML is dropped and footnotes are escaped** on an edit. Neither
  appears in what the notetaker writes. They would only come from a coding
  agent's edit or a paste.
- **TipTap parses with `marked`; the read view draws with remark.** Both
  follow CommonMark and GFM, so they disagree only at the edges.

## Coexistence

- **Luke's live typing (`plan-reveal.ts`).** Unchanged. The chase draws the
  read view, an open field's unit is not drawn by it, and the developer's own
  edit lands at once on close.
- **Live drafts and conflicts (#2022).** The model is unchanged, so the hold,
  Keep mine, and Use Luke's behave as shipped (tested above).
- **The fixed template.** No editor holds a heading. StarterKit's heading is
  switched off, so a pasted heading lands as a paragraph, and the formatter
  still escapes any field line that would open one.
- **Session replay.** The editor is a `contenteditable`, so its words are DOM
  text that `mask_all_text` masks. It also stands under `ph-no-capture`,
  because the recorder would otherwise capture one DOM mutation per
  keystroke. No new way of drawing words leaves the machine. The production
  PR keeps a test that the editor's host carries the class.
- **Accessibility.** The editor is `role="textbox"`, multiline, and labelled
  with the field's name, which is how the AX tree reads today's textarea.
  The pencil stays as the keyboard's way in. VoiceOver needs the Mac pass.
- **IME.** ProseMirror owns composition. A real macOS IME (kana, pinyin,
  Hangul, press-and-hold accents) must be checked on a Mac.

## Options compared before choosing

Round one put a minimal ProseMirror editor, TipTap, Lexical, and plain
`contenteditable` behind the same seam. Round two put four Markdown layers
on the same edge cases. In short:

| | `renderer.js` Δ gz | Adoption | Verdict |
| --- | --- | --- | --- |
| **TipTap 3.31** with its extensions | +169 KB | 22.6M weekly downloads, 38.7k stars, maintained by a company | **chosen** |
| Minimal ProseMirror and our own Markdown bridge | +73 KB | (ProseMirror itself is the engine under TipTap) | our bridge broke task lists, images, HTML, footnotes, and reference links on an edit: a long tail we would own forever |
| Milkdown 7.22 (ProseMirror and remark) | +108 KB | 0.59M weekly downloads, effectively one maintainer | the best Markdown fidelity, but a single-maintainer dependency for the centre of the product |
| prosemirror-markdown | +115 KB | official, CommonMark only | flattened tables and broke task lists |
| Lexical 0.52 | +145 KB | 6M weekly downloads | largest, no schema language for a rule, and its Markdown re-print was lossy |
| MDXEditor (Lexical) | +248 KB | | too large |
| `contenteditable` and our own serializer | +1 KB | | lost a rule's examples and changed meaning on a one-character edit |

## Bugs found on the way

1. `useFieldEditing`'s `changed` updated state but not the ref `close()`
   reads, so Esc within 150 ms of the last key saved the words before it.
   It never fires with today's synchronous textarea, but any async editor
   hits it. The spike fixes it.
2. In the read view, a bold word inside a rule's example draws as a muted
   label, because `.plan-rule-body li > strong` matches any direct-child bold
   word. This is a small CSS fix.

## Bundle approval

Dean approved moving the renderer baseline for this branch, where it now
stands at 905,662. The production PR either records the same move, or ships
the editor lazily, as `whiteboard.js` and `file-tree.js` are, at the cost of
a loader and a second copy of React in that bundle. That choice is Dean's.

## Migration plan

1. **Stop re-rendering the document on every keystroke.** S. Memoise
   `BodyUnit`, fix bug 1 and the rule-label CSS (bug 2). Worth shipping even
   alone.
2. **The field opens in place on TipTap.** M, ~300 lines with tests:
   `field-editor.tsx` and `rule-extension.ts` as the spike has them, the glue
   in `plan-field-editor.tsx`, the dependencies, and the bundle baseline
   (**Dean's OK**). Rewrite `plan-field-editor.test.ts` for the editor:
   jsdom runs TipTap; a test drives it through its commands and asserts what
   `onDraft` hears and what saves. Amend `docs/PLANNING.md` and
   `docs/DESIGN.md`. Needs `verify.sh` evidence on a Mac (IME, VoiceOver,
   trackpad selection).
3. **Fidelity decisions.** S. Decide whether soft wraps should stay soft
   (TipTap's Markdown options or a small extension), and whether the service
   should store fields in TipTap's style from the start so the first edit
   changes nothing it does not have to.
4. **Later, its own spike: Luke's writes woven into an open editor.** L.
   Apply Luke's change to the field as ProseMirror steps mapped through the
   developer's own, so most conflicts disappear and the chase could type
   inside the editor.

Not run here: `./scripts/verify.sh` (macOS only; this was a Linux VM), so CI
cannot verify the Mac UI. The screenshots are headless Chrome on Linux over
the real renderer modules and stylesheet, not the Electron window.
