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

**TipTap's.** All of the editing itself comes from TipTap, with everything
Markdown can store switched on:
- StarterKit: paragraphs, headings, lists, quotes, horizontal rules, bold,
  italic, strike, inline code, links, undo and redo, and the Markdown typing
  shortcuts and keys.
- `CodeBlockLowlight`: code blocks, syntax-highlighted.
- `@tiptap/markdown` reads and writes each field's Markdown.
- Task lists, tables, and images.
- The placeholder.

The one StarterKit extension switched off is underline: Markdown cannot
store it and the read view could not draw it. The other TipTap extensions
(highlight marks, sub- and superscript, text colour and alignment, smart
typography) have no Markdown form either, so they stay out for the same
reason.

**Ours** (`spike/field-editor.tsx`, `spike/rule-extension.ts`, the glue in
`plan-field-editor.tsx`, and a few lines of CSS so TipTap's elements stand
exactly where the read view's do, measured at 0 px of shift on every field
kind):

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
- **The door to the editor's bundle.** `field-editor-contract.ts` (types and
  one asset name, no values from TipTap), the shared `bundleAtom` loader, and
  a prefetch on hover.
- **Nothing else.** The save model is untouched: the editor feeds the same
  `typeText` and `typeRule` as the text boxes did, so the merge, the
  conflict, the retry, the hold, and attribution behave as shipped.

**Two changes outside the editor, so it can draw everything it writes:**

- **Headings in a field.** The formatter used to escape a heading in a field
  (it drew `## Rejected` as those characters), because a field must never
  open a section of its own. It now moves the heading below the field's own
  `###` instead: `#` becomes `####`, `##` becomes `#####`, and deeper ones
  `######` (`packages/hosted/src/plan-template.ts`). Nothing cuts the body at
  anything below `###`, the stored field keeps the developer's `##`, and the
  read view draws it as a heading in the field.
- **The editor loads lazily.** TipTap, its grammars, and the rule's nodes
  ship as `field-editor.js`, a bundle of their own, which the document loads
  the first time a field is hovered or opened (see "Loading the editor
  lazily" below). The read view's code stays plain, as it is on `main`.

## Hover, the keyboard, and the "just changed" tint

- **Hover shows only who last edited the section.** There is no hover wash
  and no pencil. A field's words take the text cursor, and a click into them
  edits them. Hovering a section shows its "Edited by … · 2h ago" line at the
  column's edge.
- **The keyboard moves between blocks, as in Notion.**
  - The document is **one Tab stop**: Tab enters at the block you last
    selected (the first block before that), and Tab again leaves the
    document for the rest of the window.
  - Inside it, **↑ and ↓** move between blocks. With nothing focused (a
    fresh window, or after a click elsewhere in the page), ↓ selects the
    first block in view and ↑ the last, rather than scrolling the page. Focus
    on any other control keeps its own arrows.
  - **Return** edits the selected block with the caret at the end. On the
    Rules heading it adds a rule.
  - **Esc** (or ⌘↩) saves, stops editing, and leaves the block selected.
  - A selected block wears a soft tint of the focus colour in the hover
    wash's old box, with no border.
  - Each block is a labelled group (`role="group"`, `aria-label` the field's
    name, `aria-keyshortcuts="Enter"`), not a button, so a screen reader still
    reads the words inside it.
  - Code blocks are taken out of the Tab order inside a block, because
    Chrome makes a scrolling `<pre>` a Tab stop of its own.
  - The rules' "+" still shows under the pointer, because adding a rule is
    not a click into existing words.
- **No "Saving…".** A save under way says nothing. A save that failed, or
  met Luke's words, still says so under the field.
- **The tint is the hover wash's size.** The highlight a section wears as
  Luke's or an agent's edit lands now takes the box the hover wash had
  (2 px above and below, 6 px either side) instead of 2 px all round.
- **Your own edit does not light up.** It already landed at once rather
  than being retyped. It now also lands unlit, sections and assumptions
  alike, because you watched it being typed (`ChaseAim.lit` in
  `plan-reveal.ts`, with a test). Luke's and agents' edits light as before.

The suite checks the keyboard path end to end: Tab enters at Problem, ↓ and
↑ move to Outcome and back, Tab leaves, Shift-Tab returns to Problem, Return
edits, Esc saves and selects Problem again, and "Saving…" never appears.

| Hover: only "Edited by…" | Keyboard: a selected block | Luke's edit: the tint at the hover wash's size |
| --- | --- | --- |
| ![Hover](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/hover-byline.png) | ![Selected](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/keyboard-selected.png) | ![Tint](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/agent-edit-tint.png) |

## Should a rule just be a numbered list?

Not as an editor change. Given/When/Then is the stored shape
(`examples: [{given, when, then}]` in `plan-wire.ts`), and a deliberate one:
`docs/PLANNING.md` takes it from Example Mapping (rules, each with its
examples) so that "two agents given the plan build the same behavior". The
notetaker writes it with its own `addExample` note. The formatter turns it
into the `### Rule N:` blocks that Copy hands a coding agent, and the read
view draws it as a numbered rule over its examples. The editor's part is
about 120 lines of TipTap nodes.

### Making the schema less bespoke

The honest version of "less bespoke" is to store rules as one Markdown text
field, like Decisions, written as a numbered list with Given/When/Then lines
under each rule by convention. The rules would then edit in the stock TipTap
editor, and `rule-extension.ts` would go. What it takes:

- **The wire and the template.** `planFieldsSchema.rules` becomes
  `string | null`, so the JSON Schema goldens the models are shown change.
  Those bytes key the providers' prompt caches, so every standing
  conversation pays its prefix once.
- **The notes.** `addExample`, and the rule-by-number notes the notetaker
  and coding agents' `edit_plan` write, become ordinary `add` and `replace`
  notes on a text field. The notetaker's instructions and its offline eval
  change with them.
- **The data.** A migration rewrites every stored `rules` array as the
  Markdown the formatter already prints for it.
- **The desktop.** The chase's per-rule units (`### Rule N:`), `plan-rule.tsx`'s
  numbered drawing, the history model's rule matching, and the field
  editor's rule targets all go, and the Rules section becomes one unit.
- **In all, about 27 files** across `packages/hosted`, `apps/web` (brain,
  notetaker, coding agents' edits, tests), and `apps/desktop`, plus the
  goldens and a migration. That is an L-sized PR with a model-behaviour risk.

What is lost: the guarantee that every example has exactly a Given, a When,
and a Then. Today the schema enforces it. As Markdown, it would rest on the
models following a convention, and on the developer not deleting a label.

**Recommendation:** keep the schema. The structure is the product's own
decision, and the cost of honouring it in the editor is small and contained.
Revisit only if Dean wants rules to be freeform. That is a decision about
plans, and it should be made with the notetaker's eval in hand rather than
for the editor's sake.

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

| A heading typed with `## ` in a field | Highlighted code, read and edited the same |
| --- | --- |
| ![Heading](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/heading-editing.png) | ![Code](https://raw.githubusercontent.com/reviewstage/luke/pr-assets/pr-2072/code-editing.png) |

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
| Formatting while editing | ✗ raw Markdown | ✓, headings and highlighted code included |
| Layout shift as a field opens | the words jump into a box | **0 px** on text, bullets, numbered, heading, code, questions, assumptions, rule |
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

Measured with `scripts/build.mjs` against the `main` commit this branch
merged (#2085), whose `renderer.js` is 738,427 gz (baseline 733,811, ceiling
770,501).

| | `renderer.js` gz | `field-editor.js` gz |
| --- | --- | --- |
| **The editor lazily, read view plain (this branch)** | **738,641 (+214 B)** | 213,106 (budget entry) |
| The same, with the editor's code blocks plain (no `lowlight`) | ~+214 B | 159,737 |
| Earlier: TipTap inside `renderer.js` | 905,662 (+169 KB) | — |
| Earlier: TipTap inside, and `rehype-highlight` in the read view | 961,262 (+225 KB) | — |

What the editor's bundle is (minified, before gzip): the editor engine
(`prosemirror-*` and `@tiptap/core`, ~330 KB), `marked` (88 KB),
`lowlight` and `highlight.js`'s 37 common grammars (~53 KB gz on their own),
tables (`prosemirror-tables` and the extension, 48 KB), lists (22 KB),
`@tiptap/markdown` (21 KB), and `linkifyjs` for links (20 KB).

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

## Loading the editor lazily

The editor ships as its own chunk, as the whiteboard and a File tab's tree
already do, and the spike now builds it that way:

- **The chunk.** `field-editor.js` is built by `scripts/build.mjs` from
  `spike/field-editor-bundle.ts`. It holds TipTap, its extensions,
  `lowlight`, and the rule's nodes, and sets one global,
  `window.lukeFieldEditor = { mount }`. It mounts with TipTap's own DOM
  (`new Editor({ element })`) rather than `@tiptap/react`, so no second copy
  of React rides along. That is the difference from `whiteboard.js`.
- **The door.** `plan-field-editor.tsx` reads the chunk through the shared
  `bundleAtom` (`bundle-loader.ts`). The renderer imports only
  `field-editor-contract.ts`, whose types and one asset name carry no value
  from TipTap.
- **When it loads.** The pointer or the keyboard coming onto an editable
  field starts the load, so it is usually done before the click. A click
  before it is done keeps the field drawn as it was, with no spinner and no
  flash. The editor mounts the moment the chunk arrives, and the click's
  point still lands the caret on the same word, because nothing moved. A
  failed load says "The editor could not be loaded." under the field.
- **Budget.** A new entry, `renderer/field-editor.js` at 213,106 (5% slack
  like the others), beside `whiteboard.js` and `file-tree.js`.
  `renderer.js` keeps `main`'s baseline of 733,811.

**Expected main-renderer delta: +214 bytes gz.** That is the door, the
contract, and the spike's glue (coalescing, the field-kind mapping). The
production PR lands in the same place.

| Cost of the first open on this VM (headless Chrome, Linux) | 1× CPU | 4× CPU throttle |
| --- | --- | --- |
| Load and evaluate `field-editor.js` | 86–93 ms | 306–326 ms |
| …without `lowlight` | 29–32 ms | 62–72 ms |
| First mount (warms up) | 36–43 ms | 153–165 ms |
| Every later mount | ~6 ms | ~25 ms |

With the hover prefetch, the load overlaps the time between hovering and
clicking, so the first open usually costs only the first mount. A field
opened from the keyboard before any hover waits for the load with its words
still drawn. Behaviour is unchanged by the split: the suite passes as it
did, with typing at 4.4 ms p50 and 0 px of layout shift on every field kind.

### Can the read view drop lowlight, so nothing grows `renderer.js`?

Yes, and on this branch it already has. `rehype-highlight` is gone from
`markdown-message.tsx`, so the read view draws code plain, as `main` does,
and `lowlight` lives only in the editor's chunk. There are two ways to give
the read view colour without growing `renderer.js`:

- **Host Shiki.** The panel already asks main to colour fenced code
  (`ACT_KIND.PLANNING_COLOUR_CODE`, `highlightSnippet` in
  `packages/host/src/plan-code.ts`). The transcript does this today
  (`transcript-markdown.tsx`, with its colouring cache and `runColours`).
  Doing the same for the plan's read view adds no dependency, and an
  estimated ≤1 KB gz of glue in `markdown-message.tsx`. The colours would
  match the Code tab and the transcript. The caveats:
  - **Fences without a language** stay plain, because Shiki does not guess.
  - **The chase** must draw a unit plain while it is typing it, because its
    caret and marks sit on the text runs.
- **Plain.** As now. It costs nothing.

Either way, the editor and the read view should colour code the same, or a
code block changes colour as it opens. The editor's `lowlight` uses
highlight.js's GitHub theme and guesses unlabelled fences; host Shiki uses
GitHub Dark/Light Default and does not guess. That leaves three consistent
pairings:

1. **Both plain.** Drop `CodeBlockLowlight` from the editor (StarterKit's
   plain code block). The chunk is 160 KB and loads in ~30 ms. This is the
   smallest and fastest.
2. **Both host Shiki.** The editor colours its code blocks through the same
   act as ProseMirror decorations: about 60 lines, because TipTap ships no
   async highlighter. The chunk is 160 KB and colours match the rest of the
   app. This is the most consistent, but not out of the box.
3. **Both `lowlight`.** As the branch was one commit ago. Puts ~55 KB gz back
   into `renderer.js`, so it is ruled out by the budget.

**Recommendation:** ship option 1 with the lazy chunk (renderer +214 B, chunk
~160 KB, ~30 ms to load). Take option 2 as a follow-up if coloured code in
plans matters.

## Coexistence

- **Luke's live typing (`plan-reveal.ts`).** Unchanged. The chase draws the
  read view, an open field's unit is not drawn by it, and the developer's own
  edit lands at once on close.
- **Live drafts and conflicts (#2022).** The model is unchanged, so the hold,
  Keep mine, and Use Luke's behave as shipped (tested above).
- **The fixed template.** No editor holds a section's heading; the document
  draws those. A heading typed into a field is the field's own and is moved
  below the field's `###` in the body, so it can never open a section.
- **Session replay.** The editor is a `contenteditable`, so its words are DOM
  text that `mask_all_text` masks. It also stands under `ph-no-capture`,
  because the recorder would otherwise capture one DOM mutation per
  keystroke. No new way of drawing words leaves the machine. The production
  PR keeps a test that the editor's host carries the class.
- **Accessibility.** The editor is `role="textbox"`, multiline, and labelled
  with the field's name, which is how the AX tree reads today's textarea.
  Each block is a labelled group the arrows move between, and Return edits
  it. VoiceOver needs the Mac pass.
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

`renderer.js` does not move: this branch is back on `main`'s baseline
(733,811) and measures +214 B over `main`. What needs Dean's OK is the new
lazy budget entry, `renderer/field-editor.js`: 213,106 with `lowlight`, or
~160,000 without it.

## Migration plan

1. **Stop re-rendering the document on every keystroke.** S. Memoise
   `BodyUnit`, fix bug 1 and the rule-label CSS (bug 2). Worth shipping even
   alone.
2. **The field opens in place on TipTap, loaded lazily.** M, ~350 lines with
   tests: `field-editor.ts`, `rule-extension.ts`, `field-editor-contract.ts`,
   and `field-editor-bundle.ts` as the spike has them, the `build.mjs` entry,
   the glue in `plan-field-editor.tsx`, the dependencies, and the
   `field-editor.js` budget entry (**Dean's OK**). Rewrite `plan-field-editor.test.ts` for the editor:
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
