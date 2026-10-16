# Proposal: images in plans, and which other media follow

Status: **decided by Dean on 2026-10-15**: "Mostly looks great to me. I
don't feel like the uploading fits in with our app, let's redesign that.
Also we don't need Image added or Image removed chips in the version
history, the red/green is enough. I agree with everything else and think we
should do v1 and not more." So v1 is images and Mermaid, the twelve
decisions in §9 as recommended, and nothing beyond. Two changes from the
text below, recorded under "As decided": the uploading state is option A
of the show's redesign, which Dean chose ("I agree with A"), and a version
marks a picture only with the change's red or green.

## As decided

- **Uploading, option A.** The picture stands at its final size at half
  strength, with the window's 16 px spinner and "Uploading" where its
  caption will stand; a failed keep says so there, in the failure note's
  words, with Retry and Remove. The veil of §3 is gone. Option B, a bar
  along the picture's edge, was not taken. The show's "Uploading" section
  draws both.
- **No labels on history's pictures.** A picture written in wears the
  green edge, and one struck out is dimmed behind the red, as words are;
  "Image added" and "Image removed" are gone.
- **General names.** The picture vocabulary
  (`@luke/features/picture-wire`), the window's picture cache, and its
  picture block are named for pictures rather than plans, so the agents'
  transcript pictures can share them.
- **Shipped, all of v1:** #2886 (PR 1, the editor's bug), #2895 (PR 2,
  the store and its addresses), #2913 (PR 3, drawn on the page and in
  versions), #2914 (PR 4, paste, drop, and Insert image on ⌥⌘I), #2943
  (PR 5, `look_at_picture` and a correction that keeps its pictures),
  #2945 (PR 6, a coding agent adds a sandbox screenshot), and #2890 (PR 7,
  Mermaid).
- **No bound on looks.** PR 5 shipped `look_at_picture` with four looks a
  turn. Dean took it out (#2991): "Why would we have a limit? Do other
  industry tools do this? We don't want any overengineering or special
  logic/handling. The agent should be smart enough to figure it out." A
  model looks as often as it asks. What bounds a look is what bounds the
  picture, 1.5 MB, and a model provider's own limits answer as the tool
  error they are.

The show is `docs/proposals/plan-media/index.html`, one self-contained file
that fetches nothing. Open it in a browser. Each frame uses main's compiled
desktop stylesheet, light and dark, over the DOM main's real components
drew for synthetic words and pictures: `PlanBody`, `VersionView`, the TipTap
plan editor (`mountPlanEditor`), and `AttachmentViewer`. The proposal is
patched into their sources as the show is bundled, so what you see is the
change applied to main rather than a drawing of it. The pictures went
through the real `encodeImage`, and the frames were captured under the
window's own Content Security Policy.

Dean's ask: "I want to support images (and maybe other types?) in plans.
Can we work on this?"

Research with sources is in `plan-media/research.md`.

## 1. Today

A plan is one Markdown text (`plan.document`, at most 200,000 characters,
`PLAN_BOUNDS.MAX_BODY_CHARS`), revised whole into `plan_revision`. People
edit it in the plan editor, Luke's notetaker writes it during calls, and
coding agents write it with `edit_plan`. All three go through
`plan-notes.ts`.

What happens to an image today:

| Where | What `![alt](url)` does |
| --- | --- |
| Read view and version history (`markdown-message.tsx:288`) | Draws the alt text alone, by design: "an image has no picture to draw in a caption". |
| Transcript replies (`transcript-blocks.tsx:256`) | Draws nothing. |
| Plan editor (`plan-editor.ts:121`) | Loads TipTap's `Image` with `inline: true`, so the line round-trips. Nothing pastes or drops a picture. |
| Coding agents' brief, planning model, notetaker | The text, URL included. No model sees a plan picture. |

**A bug on main, found while building the show.** TipTap's Paragraph turns
a paragraph holding only an image into a block-level image
(`@tiptap/extension-paragraph`'s `parseMarkdown`). Main configures `Image` as
inline, so a plan with an image on its own line opens as an invalid document.
The image sits at the top level, where only blocks may stand. The first edit
whose step touches it throws `Called contentMatchAt on a node with invalid
content`. An agent can write such a line today. PR 1 fixes it before any
upload exists.

What Luke already has to reuse:

- **Intake.** `encodeImage` (`feedback-images.ts`). It keeps a PNG, JPEG or
  WebP that fits and re-encodes anything else to WebP: 2,000 px at 0.82, then
  1,400 px at 0.6.
- **Storage.** `inbox_attachment`: bytes in a Postgres `bytea` column, held to
  1.5 MB by a check, its type sniffed (`image-signature.ts`), and served under
  the account by `GET /api/inbox/attachment` with `private, no-store` and
  `nosniff`.
- **The hot-payload lesson** (#2750/#2757). A workspace photo's bytes stay
  out of the workspaces read. They are served apart and cached by version.
- **Viewer.** `AttachmentViewer`, the Quick Look card the composer and the
  Inbox open: arrows walk the files, with Download and Esc.
- **Agent intake from the sandbox.** `inbox-image.ts`: an agent names a file,
  and the service reads it, sniffs it, and bounds it.
- **A model looking at a picture.** `look_at_board` hands the board's PNG to
  the planning model as a file part. It keeps only the status in the
  conversation (`storedLookOutput`).
- **No object storage anywhere.** There is no `@vercel/blob`, S3 or R2. The
  inbox schema says so outright.

## 2. What other tools do

Sources and the detail are in `plan-media/research.md`.

| | Paste, drop | Stored | Markdown | Size | Caption, alt | Lightbox | Mermaid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub | Both, plus a button | `user-attachments`, behind login for private repos since 2023, signed for 5 min | `<img width height alt="Image">` on paste; files as links | HTML `width` only | No caption; alt defaults to "Image" | Opens in a new tab | Yes, drawn in the browser |
| Linear | Drop, `/file` | `uploads.linear.app`, auth required, signed on request | `![alt](url)` in the API | Drag handles | Not documented | Yes | Yes (Nov 2025), `/diagram` |
| Notion | Both, `/image` | Signed URLs that expire in an hour | `![Caption](url)` in API Markdown | Drag handles, align | Caption and alt, separate | Full screen | Yes, preview or split |
| Google Docs | Both, plus Insert | A copy in the doc; 30-minute URLs per account | Base64 at the end of the export (community) | Handles, wrap modes | Alt text | No | No |
| Coda | `/image`, drop | S3, Imgix | Exported without images | Drag bars, crop | Caption and alt | Full screen | Through a community Pack |
| Craft | Both, `/` | AWS | TextBundle carries images | Auto or Large | Caption is a text style | Gallery | Yes, native |
| Cursor plans | Not documented | Files on disk | Markdown | n/a | n/a | n/a | Yes, inline since 2.2 |

Four patterns hold across them:

1. **Upload at once, then write an address.** Nobody embeds bytes in the
   text.
2. **The address is gated.** Since 2023 every tool here that hosts private
   content serves its pictures behind sign-in or a short signature. That
   covers GitHub's private repositories, Linear, Notion and Google Docs.
3. **Plain Markdown loses width and caption.** Tools that care keep them
   beside the Markdown or in HTML. CommonMark has `![alt](url "title")`
   and nothing more. TipTap's own serializer writes exactly that and drops
   width (`research.md` §TipTap).
4. **Mermaid is the common diagram.** GitHub, Linear, Notion, Craft, Cursor's
   plans and Devin's wiki all draw a `mermaid` fence. No coding agent's plan
   documents raster images inside it. They take pictures as input and attach
   screenshots to the pull request.

## 3. The design: images first

### Writing one

The way in is **paste or drop** into the plan editor, or **Insert image**
from ⌘K and the Edit menu while editing, which opens the file picker. The
picture goes in as its own block under the caret's paragraph.

1. The renderer runs `encodeImage(file, 1_500_000)` and shows the picture at
   once from the local bytes at half strength, "Uploading" under it.
2. `planning.attachFile` (main, on the account's bearer) posts the raw bytes
   to `POST /api/plans/:id/files`. The service sniffs the type, checks the
   reader can reach the plan, stores the row, and answers its id.
3. The node's address becomes the file's. **A picture still uploading writes
   nothing to the text**, so a `data:` address is never saved and a
   half-done upload never reaches a revision. A failed upload says so where
   its caption will stand, with Retry and Remove (as decided, option A).

Once a picture stands, selecting it shows its tools: **Alt text**,
**Caption**, **Enlarge** and **Delete**. Backspace removes it, ⌘Z brings it
back, and dragging moves it.

### How it is written down

```md
![Members page: two active members and two pending invites](https://tryluke.dev/acme/plan/5d8e2a61-7c3b-4f0e-9b1a-2c6d4e8f0a13/files/3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02 "Pending invites sit in the members list")
```

- **The address is the plan's own address with `/files/<id>`**, in
  `mention-link`'s style: a real `https://tryluke.dev` address, never a
  private scheme.
  - Opened in a browser it lands on the Open in Luke page, which reveals
    nothing, because `vercel.json`'s `/[^/]+/plan/[^/]+/?` rewrite gains
    `/files/[^/]+` and `appLinkFromAddress` answers the plan.
  - Pasted into GitHub it is a link nobody without Luke can read.
  - A coding agent reads it as the plan's file.
  - A new `@luke/features/plan-file-link` reads and writes it, beside
    `mention-link` rather than inside it: it is not a mention, and
    `mentionLinksIn` must stop counting `![@…]` as one (PR 1).
- **Alt text is the image description; the caption is the CommonMark
  title.** The title is the one slot plain Markdown has. TipTap's `Image`
  already parses it, and a reader that ignores it loses nothing.
  - Alt text starts as the dropped file's name, or "Screenshot" for a
    pasted picture. GitHub writes "Image", and its alt-text bot exists
    because nobody changes it.
  - The serializer escapes `]` in the alt text and `"` in the caption.
    `@tiptap/markdown`'s does not (`research.md`).
- **No width in v1.** A picture draws at its own size up to the column's
  width and at most 520 px tall. Resizing needs a syntax that TipTap's
  Markdown drops, and no tool's plain Markdown keeps width. Revisit if plans
  fill up with small icons drawn large.

### Where it is stored

Recommended: **a `plan_attachment` table shaped like `inbox_attachment`**.
Each row holds:

- its `uuid` id;
- `plan_id` (cascade);
- `organization_id` (cascade);
- the uploader's `user_id` (set null, since the picture is the plan's, as
  their words are);
- the sniffed content type;
- `byte_count`;
- `bytes` (`bytea`, held to 1.5 MB by a check);
- `created_at`;
- `first_saved_at`.

A plan holds at most 100 files. Why Postgres and not object storage:

- **There is none to reuse.** Vercel Blob or S3 would be a new provider, a
  new subprocessor in PRIVACY.md, a second place to delete an account from,
  and a second auth story beside the bearer.
- **The inbox already made this call** for the same size of picture, in the
  same database.
- **The numbers are small.** A WebP screenshot is 100 to 300 KB. A plan at the
  100-file cap holds at most 150 MB, and a typical one holds a few hundred
  KB.
- **It is reversible.** Moving the bytes to a store later changes the route,
  not the text: the address names the file, not where it lives.

Video, or files over a few megabytes, would change this answer (§6).

### Who sees it

**Only members of the plan's workspace, the same set who can read the
plan**, through the read route
`GET /api/plans/:id/files/:fileId` and `planReachableBy(userId)`, on the
account's bearer. It answers with the sniffed type, `private, no-store`,
and `nosniff`. There is never a public or unguessable URL. Holding the
address gives nothing to someone who cannot read the plan.

- **The hot-payload lesson.** The bytes never ride the plan read, its stream,
  or a revision. The text names a file, and the desktop reads each through
  `planning.fileRead` (main, bearer) into a `data:` URL, which the CSP already
  allows. A file's bytes never change, so the window caches them by id for
  its life. A new picture is a new id, so nothing goes stale.
- **A picture someone else cannot reach.** One copied from a plan in another
  workspace draws as its alt text, marked "not available", for readers who
  cannot read the source plan (show, States). A paste of such a picture from
  plan to plan copies its bytes into the new plan instead (`planning.copyFile`,
  PR 4), so a pasted picture works for the new plan's members.
- **The web's Open page** fetches and draws nothing of the plan, image
  addresses included (§3, How it is written down).
- **Session replay.** The picture's block wears `ph-no-capture`, so the
  recording draws an empty box of its size. That is a second line behind
  `maskAttributeFn`, which already blanks `src` and `alt`. The editor and the
  version history are already left out whole. A data URL is megabytes of
  attribute that has no business in a recording even masked.
- **Traces, counted events, fixtures.** No route logs a body, and a model's
  look at a picture keeps only its status in the conversation and its traces,
  as `storedLookOutput` does. Fixtures and tests use synthetic pictures.
- **PRIVACY.md.** A new paragraph, "A plan's pictures":
  - what is kept and where (our database, beside the plan);
  - up to 1.5 MB each, re-encoded on the Mac;
  - every member of the workspace sees them;
  - they go with the plan, the workspace, or an unsaved upload after a day;
  - our operators can read them, as they can read the plan.

### Reading it

- **Read view.** `markdown-message.tsx`'s `img` row becomes `PlanImage` where
  the place hands a file reader: the plan's page, its versions, and Luke's
  notes. A caption keeps today's alt text.
  - The picture is its own block, framed on the section's fill, with the
    caption under it in the secondary colour.
  - A press opens the viewer.
  - While its bytes are read it is a quiet box with the spinner.
  - A picture whose bytes are gone, or that this reader cannot reach, shows
    its alt text and "not available".
- **Lightbox.** The existing `AttachmentViewer`, walking the plan's pictures
  in reading order. Its header names the alt text and size, with Download
  and Esc. Nothing new to learn: it is the Inbox's and the composer's
  viewer.
- **A picture from outside Luke** (`![…](https://example.com/a.png)`) is
  **never fetched**. It draws as a link with an image glyph, opening in the
  browser:
  - the CSP refuses remote images;
  - fetching would tell any host who reads the plan and when (the reason
    GitHub proxies every image through Camo);
  - a tracking pixel could watch a team's plan.

  An "Import" that re-hosts one is later (§9, D7).
- **Version history.**
  - A picture is one token to `plan-diff.ts`. Today `![a](u1)` against
    `![b](u2)` diffs letter runs inside the URL, which leaves broken
    Markdown.
  - `drawEdit` wraps a picture in the mark its token wears.
  - A picture written in wears the green edge. One struck out is dimmed
    behind a red dashed edge. A replacement shows both, the struck one
    first. As decided, no label is added: the red and green say it, as they
    do for words.
  - A changed alt text or caption is a replaced picture, which is honest:
    what a reader is told changed.

### Deleting it, and orphaned bytes

Deleting a picture from the text deletes nothing. Every revision that named
it can be restored, and a restore must bring the picture back. So a file's
bytes live as long as its plan: they go with the plan, the workspace, or the
account the plan goes with, by cascade.

The one waste is an upload that never reached a saved text: pasted, then
undone, then the window closed. A save stamps `first_saved_at` on each file
its text names, in the same transaction. The scheduled sweep
(`maintenance-sweep.ts`) deletes files with no stamp older than a day. That
is one indexed delete, with no scan of revision texts.

## 4. Agents and Luke

What is realistic now, and what comes later:

| | v1 | Later |
| --- | --- | --- |
| A coding agent reads plan pictures | The brief carries the picture's line, so the agent reads the alt text and caption. `look_at_plan_file(id)` hands it the picture as a file part when it decides it needs it, modelled on `look_at_board`. | Pictures as vision input in the first message for plans with few of them |
| Luke's planning model | The same `look_at_plan_file`, beside `look_at_board` | Luke describes a pasted picture's alt text for you |
| A coding agent adds a screenshot | `edit_plan` gains an `image` note: a sandbox path, alt text, and the section, read through `inbox-image.ts`'s intake (sniffed, 1.5 MB), stored as a plan file, its line written under the section. Its byline names the agent (show, Agent). | Screenshots of each run attached automatically |
| Notetaker | Keeps pictures, never adds them: it has no pictures to add. A correction may not drop a picture's line, as `keepsMentions` refuses one that drops a mention (`keepsFiles`). | Placing the board's picture into the plan when asked |

Why a tool and not the brief by default: a plan may hold a dozen
screenshots, and each is a large prompt cost on every agent the plan
starts, most of which never need them. The alt text tells the agent what a
picture shows, and the tool lets it look when that matters, as
`look_at_board` already does for Luke. Vision input to the model is already
exercised by composer attachments (`attached-files.ts`) and `look_at_board`,
so neither path is new.

## 5. Mermaid, recommended for v1

A ` ```mermaid ` fence draws as its diagram in the read view and under its
code in the editor. Its code stays the text, so agents read and write it
as they already write Mermaid in GitHub. Every surface without the diagram
bundle draws the code, as today.

**Value:** a plan's flows and sequences are the most common picture a coding
plan needs, and coding agents write Mermaid fluently. GitHub, Linear,
Notion, Craft, and Cursor's plans all draw it.

**Cost: no storage, no service, no privacy change.** The diagram is drawn
on the Mac from the words already in the plan. Three facts were measured
while building the show:

- **Size.** Mermaid 11.17.2 (already in the lockfile through Streamdown,
  never bundled) is ~950 KB gzipped for every diagram type. As its own
  ESM entry with splitting, a flowchart or sequence diagram loads
  **~228 KB gzipped on first use** and the other types stay on disk. That
  is a new budget line, `renderer/diagram.js`, recorded with
  `LUKE_UPDATE_BUNDLE_BUDGET=1` and stated in its PR. Nothing joins
  `renderer.js` but a loader. An IIFE like the whiteboard's would inline
  every type, so it must be ESM.
- **The CSP.** Mermaid's SVG carries a `<style>`, which `style-src 'self'`
  refuses, so an SVG put in the page draws every node black. Drawn as an
  `<img>` from a `data:image/svg+xml` URL, it renders. The image is its own
  document, and its style applies inside it.
- **Labels.** Mermaid measures labels in the page, where its style was
  refused, so labels clip. Adopting its theme CSS as a constructable
  stylesheet before it measures (`document.adoptedStyleSheets`, CSSOM, which
  the policy allows) fixes the measure. The show's diagrams were drawn this
  way, under the window's own policy.

A fence that fails to parse says so under its code, and its code is
untouched. The diagram follows the window's appearance, drawn per theme
and cached by its code. Version history draws a changed fence as its code
with the changes marked, since two diagrams side by side hide what changed.
`securityLevel: "strict"` drops Mermaid's click handlers and HTML labels.

## 6. Other media, ranked

| Type | Value | Effort | Recommendation |
| --- | --- | --- | --- |
| Images | High: mocks, screenshots, the bug's picture | M, reusing the inbox's storage and the viewer | **v1** |
| Mermaid diagrams | High for coding plans | M, no storage | **v1**, last PR, independent |
| PDF and other files as cards | Medium: a spec, a design export | S once `plan_attachment` exists (it is named for this). A card with the type's icon, name and size opens the viewer, which shows a PDF by its icon with Download, since the CSP refuses PDF frames. Agents read PDFs as file parts already. | Later (v2). Same table, a 3 MB cap like the composer's PDFs. |
| Figma, Loom, YouTube links | Medium | Iframes are refused by `frame-src`. A preview card needs a server fetch of oEmbed and a thumbnail, which tells each provider who reads the plan. | Later, as recognised link chips (a provider glyph and title, as integrations' mentions are drawn), not embeds |
| Video | Low for plans | Needs object storage (a recording runs to tens of MB), a player, and a CSP `media-src` change | Not planned. A Loom or a link covers it. |
| The plan's whiteboard, placed in the text | Medium | S: the board's PNG exists (`plan_board.image`) | Later, an "Insert the board" item once images ship |

## 7. Bundle, performance, limits

- **Bundles.**
  - `plan-editor.js` grows by the node view, paste and drop, and the upload,
    about 3 KB gzipped. `Image` is already in it.
  - `renderer.js` grows by `PlanImage` and the file read, about 2 KB, and
    reuses the viewer.
  - Mermaid is its own lazy entry (§5). The images PRs need no budget change.
- **Performance.**
  - The plan read and its stream carry only addresses.
  - Each picture is one read, the first time it is shown in a window, then
    cached. A plan with ten screenshots reads ~2 MB once.
  - A picture is drawn `decoding="async"` with `loading="lazy"` below the
    fold. While read, it stands in a box of 480 by 300.
  - The page moves once when it lands. An address carrying the picture's
    size would remove that jump, at the cost of noise in the text. Not
    recommended for v1.
- **Limits.**
  - 1.5 MB per picture after re-encode, the inbox's and the composer's
    bound.
  - PNG, JPEG, WebP after intake. HEIC and GIF are re-encoded to WebP.
    Animation is lost, which is said when a GIF is dropped.
  - 100 files per plan.
  - The upload body is the raw bytes, well under Vercel's 4.5 MB request
    limit, with no base64 inflation.

## 8. Migration: expand and contract

- **Expand (PR 2).** One additive migration creates `plan_attachment` and
  its index, `(plan_id)`. A partial index on `created_at` where
  `first_saved_at is null` serves the sweep. No existing row changes.
- **Order.** PR 1, the editor fix, ships in a release before any upload
  exists. Agents can already write an image line today, and an old editor
  opening one is the invalid document of §1.
- **Old desktops.** A plan with pictures opened on a desktop before PR 3 draws
  each picture's alt text, as main does today, and its editor keeps the line
  as written. The service's routes are new, so no old client calls them.
- **Contract.** None. Nothing is renamed or removed. Backing out is dropping
  the routes. The table can stay, and texts still name their files, which
  draw "not available".

## 9. Decisions for Dean

1. **Scope of v1.** *Recommended:* images (PRs 1 to 6) plus Mermaid (PR 7).
   Files, link cards and video later (§6).
2. **Storage.** *Recommended:* a `plan_attachment` table in Postgres like
   `inbox_attachment` (§3). The alternative is adding Vercel Blob now, which
   only video or large files would justify.
3. **The address.** *Recommended:*
   `https://tryluke.dev/<workspace>/plan/<id>/files/<file>`, which opens the
   Open in Luke page in a browser. Alternatives:
   - a private `luke://file/<id>` scheme, which breaks outside Luke;
   - inline `data:` URLs, which the 200,000-character cap and every read and
     revision would carry.
4. **Caption and alt text.** *Recommended:* alt text for the description,
   the Markdown title for an optional visible caption. The alternative is one
   field, Pandoc-style, with the alt text shown as the caption.
5. **Who sees pictures.** *Recommended:* exactly the plan's readers,
   checked on every read, with no public link ever (§3).
6. **Resizing.** *Recommended:* not in v1. Pictures draw at their own size up
   to the column and 520 px tall.
7. **Pictures from outside Luke.** *Recommended:* never fetched, drawn as a
   link with an image glyph. An "Import" that re-hosts one is later.
8. **Orphaned bytes.** *Recommended:* kept while the plan stands, so every
   version restores. Unsaved uploads are swept after a day.
9. **Agents seeing pictures.** *Recommended:* alt text in the brief, plus a
   `look_at_plan_file` tool for coding agents and Luke, not vision input on
   every brief.
10. **Agents adding pictures.** *Recommended:* yes, an `edit_plan` image note
    from a sandbox file (PR 6). The notetaker keeps pictures but never adds
    them.
11. **Mermaid in v1.** *Recommended:* yes, as the last, independent PR, with
    a new ~228 KB lazy budget line (§5).
12. **Insert image's place.** *Recommended:* paste, drop, and Insert image
    in ⌘K and the Edit menu while editing. There is no toolbar to add it to.

## 10. PR plan

Each PR ships its tests (`AGENTS.md`, Testing). The sizes are lines changed,
tests included.

| # | PR | Size |
| --- | --- | --- |
| 1 | `fix(desktop,features)`: a plan's image opens in the editor as a block, not an invalid inline node at the top level. `plan-diff` reads an image as one token. `mentionLinksIn` stops counting `![@…]`. The serializer escapes `]` and `"`. | S · ~200 |
| 2 | `feat(database,service,web)`: `plan_attachment` and its migration; `POST /api/plans/:id/files` and `GET /api/plans/:id/files/:file` for the plan's readers; `first_saved_at` on save and the sweep's delete; the Open page's rewrite for file addresses; `@luke/features/plan-file-link`; PRIVACY.md's paragraph. Store tests on `getTestDB()`, including that a non-member cannot read another workspace's file. | M · ~550 |
| 3 | `feat(host,desktop)`: the read view draws a plan's pictures: `planning.fileRead`, the window's cache by id, `PlanImage` and its states, the viewer walking the plan's pictures, the version history's marks. | M · ~450 |
| 4 | `feat(desktop)`: paste, drop and Insert image in the plan editor; the upload state (option A), Retry and Remove; alt text and caption; a picture pasted from another plan kept again on this one. | M · ~500 |
| 5 | `feat(service)`: `look_at_plan_file` for coding agents and the planning model, its image kept out of the stored transcript and traces; `keepsFiles` for the notetaker's and agents' corrections. | M · ~300 |
| 6 | `feat(service)`: `edit_plan`'s image note, reading a sandbox file through the inbox's intake. | S–M · ~250 |
| 7 | `feat(desktop)`: Mermaid fences draw as diagrams in the read view and under their code in the editor; the lazy `diagram` entry and its budget line. | M · ~400 |

PRs 1 and 2 are independent. 3 needs 2. 4 needs 3. 5 and 6 need 2 alone.
7 needs only 1, for the editor's code block, and can go first or in
parallel.

## 11. Risks

- **Database growth.** Bytes in Postgres grow the database and its backups.
  The 1.5 MB bound, the 100-file cap, and the sweep hold it. If plans fill
  with pictures, moving the bytes to a store changes the route, not the text
  (§3).
- **Old editors and the bug.** A desktop before PR 1 can still hit the
  invalid document on any image line, which agents can write today. PR 1
  ships first, and auto-update carries it.
- **A copied address leaks nothing, but it is a dead picture elsewhere.** An
  image line pasted into GitHub or Slack draws nothing there. That is the
  privacy rule working, and the alt text still reads.
- **Prompt cost.** `look_at_plan_file` puts a picture in a model's context
  each time it is called. The tool's description says to look only when the
  alt text is not enough, and the model decides when that is; as decided,
  no count bounds a turn's looks.
- **Mermaid's size and surface.** 228 KB on first diagram, and a large
  dependency to keep current. `securityLevel: "strict"` and drawing through
  an `<img>` keep its output from running anything. A failure shows the
  code, so a bad diagram never blanks a section.
- **Session replay.** A new way of drawing words would change what leaves
  the machine (`AGENTS.md`). A picture can hold words, so it is blocked, not
  only masked. Mermaid's words are drawn inside an image, which is blocked
  the same way.
