# Proposal: images in agent output

Status: **shipped.** Dean approved all twelve decisions on 2026-10-15 as
recommended, revised the limits after benchmarking (§3, Limits), and added
several pictures in a row as decision 13. All five PRs merged on 2026-10-15
and 2026-10-16; "As decided and shipped" below says what landed and where it
differs from this proposal.

The show is `docs/proposals/agent-output-images/index.html`, one
self-contained file that fetches nothing. Open it in a browser. Each frame
draws main's compiled desktop stylesheet, in light and in dark, over the DOM
that main's real components drew for synthetic turns and pictures:
`AgentMessage`, `TranscriptTool`, `AttachmentViewer`, `Spinner` and
`ReadFailure`. The proposal was patched into their sources as the show was
bundled, so what you see is the change applied to main, not a drawing of it.

Dean's ask: "I think popular coding agents are able to display images in
their output. How does that work? Can we add support for that? I bet it
relates to the images in plans work."

It does. Worker 318's plan-media proposal (`docs/proposals/plan-media.md` on
`conductor/plan-media-images`, PRs #2886 and up) builds most of what this
needs:

- a table of picture bytes beside the thing they belong to;
- a read route checked against who may read;
- the window's cache by id;
- the picture's loading and failure states;
- the lightbox.

This proposal adds a second owner of pictures, the agent's transcript. It
reuses 318's machinery rather than building another system.

Research with sources is in `agent-output-images/research.md`.

## As decided and shipped

| # | PR | What landed |
| --- | --- | --- |
| 1 | #2906 | An integration's picture is kept in `conversation_attachment` and named by `picture: {id, mediaType, width, height, byteCount}`, not carried as base64 in the transcript. `image-signature.ts` reads a picture's size from its header. |
| 2 | #2911 | `GET /api/agents/:id/pictures/:picture` and `…/subagents/:call/pictures/:picture`, for whoever may read the agent (`reachedAgent`); `HostedCodingAgentClient.agentPicture`. |
| 3 | #2919 | `show_image(images)`, 1 to 20 `{path, caption}`, for coding agents and their workers. A call keeps all its pictures or none, in one transaction. |
| 4 | #2927 | The desktop draws them: a shown set kept out of the fold, an integration's pictures as chips under the call, markdown images as links that never fetch, and the viewer walking the set. |
| 5 | #2979 | **Add to plan** in the viewer, with Undo. |

**Dean's limits**, one constant (`CONVERSATION_PICTURE_BOUNDS`):

- 4 MB per picture, under Vercel's 4.5 MB response;
- 200 MB per conversation, in bytes rather than a count;
- 20 per `show_image` call;
- deduplicated by hash within a conversation.

A picture over a limit is "Not kept", with its size.

**Several pictures in a row** (decision 13) shipped as proposed:

- one picture draws alone, with its caption;
- two or three share one justified row;
- four or more draw as wrapping thumbnails, six shown with "+N";
- calls in one step join into one set.

**Where it differs from this proposal:**

- **Add to plan always appends.** Decision 10 says "at the caret if the
  plan editor is open". The editor closes as focus leaves it, and the press
  is in the agent's tab, so the plan's end is the only place the line can
  go. It is written as its own paragraph through `planning.edit`, the same
  edit a developer's save is. The toast's Undo takes it back out where it
  still stands alone.
- **Add to plan re-encodes, not copies.** The picture is re-encoded on the
  Mac to the plan's 1.5 MB bound and kept through 318's
  `planning.pictureKeep`, rather than copied server-side by a
  `planning.attachFile` from a conversation's file. That is because an
  agent's picture may be up to 4 MB.
- **No "In the plan" state.** The press does not change once used; the
  toast says the picture was added.
- **Names.** The routes say `pictures`, not `files`. The shared component
  is 318's `PictureBlock` with `@luke/ui/picture-cache`, not a lifted
  `StoredImage`.

**Later** (§8), unchanged but for the browser:

- **A browser in the sandbox image** is in progress, built by worker 349
  (agent capability gaps).
- The Call tab's pictures, through a plan route.
- `read_file`'s picture in its row, only if asked.
- Screenshots of every run, a Mac screenshot through `run_on_mac`, video,
  and before-and-after pairs: not planned.

## 1. Today

**Where an image in an agent's output can come from, and what happens to it
on main:**

| Source | What happens | Where |
| --- | --- | --- |
| An integration's MCP tool answers `{type: "image", data, mimeType}` (Linear's `extract_images`, for one) | The model sees it as a file part. The relay also stores the raw content array **with its base64** in `messages.parts`, twice when the nested `linear_remote` call is kept beside `connection_execute`, and once more in the relay's durable state. Nothing caps, strips, or drops it. | eve's `toConnectionToolResult`, `connectionToolModelOutput`; `brain-host/relay.ts:543-556` |
| The agent reads a PNG with `read_file` | The model sees it. The stored output is metadata only (path, type, size, width, height). Nothing keeps the picture for the desktop. | eve's `read_file`; `coder-host/files.ts:76-88` |
| The agent takes a screenshot in its sandbox | It can't easily: the sandbox has git, node, pnpm, python3 and tmux, and no browser. It can install Playwright with `npx`. | `agent-runtime/sandbox.ts:38-50` |
| The agent posts an Inbox item with an image block | The service reads the file from the sandbox, sniffs it, holds it to 1.5 MB, and keeps it in `inbox_attachment`. It is served only to the workspace's members. | `coder-host/inbox-image.ts`, `inbox.ts:280-325` |
| The agent writes `![alt](path or url)` in a reply | A relative path draws as Streamdown's grey "[Image blocked: alt]" pill. An `https` address draws nothing (`img: () => null`). Neither is fetched. | `transcript-blocks.tsx:240-257`, `transcript-words.golden.json` |
| `run_on_mac` | Text only: stdout and stderr, 20,000 characters each. | `mac-command-wire.ts` |
| Luke looks at the board | The model gets the PNG as a file part. The relay stores only `{status}` (`storedLookOutput`). | `plans/board-look.ts:126-143` |

**The MCP row is a bug on main, found while mapping this.** A screenshot an
integration answers is:

- written into `messages.parts` as base64;
- rewritten whole with every later event of its turn, since `amendJournal`
  rewrites the row's parts (`writer.ts:1241`);
- sent whole on each long-poll page (`coder-host/transcript.ts`);
- drawn in its row as a JSON block of base64, because `toolCallView` falls
  back to `jsonBlock(output)` for any call it does not know
  (`tool-call-model.ts:573-587`).

This is the hot-payload problem #2750 fixed for workspace photos. Codex and
Claude Code both have it in their session files (research §Storage).

**What Luke already has to reuse:**

- **318's plan pictures (in flight).** `plan_attachment` (bytea, 1.5 MB);
  `POST`/`GET /api/plans/:id/files`; the window's cache by id; `PlanImage`
  with its pending, missing, and outside-link states; the viewer walking a
  plan's pictures; `look_at_plan_file`; and `edit_plan`'s image note.
- **Agent intake from the sandbox.** `readInboxImage`
  (`coder-host/inbox-image.ts:110`) streams a named file, sniffs it once 12
  bytes are in, and refuses one past its bound with a sentence the model can
  act on.
- **Type sniffing.** `sniffImageType` (`features/image-signature.ts:26`):
  PNG, JPEG, WebP.
- **Keeping a look out of the record.** `lookModelOutput` and
  `storedLookOutput` hand the model a picture and store only a status.
- **The viewer.** `AttachmentViewer`, the Quick Look card the composer and
  the Inbox open: the arrows walk files, with Download and Esc. It is
  `ph-no-capture`.
- **Chips.** The message box's 64×48 thumbnail chips (`attached-file-chips.tsx`).
- **Who may read an agent.** `reachedAgent` (`agents/agent-reach.ts:69`):
  workspace membership, used by every agent route.
- **Session replay.** An agent's tab is already left out whole
  (`agent-tab.tsx:791`, `PRIVACY.md`). `maskAttributeFn` also blanks `src`
  and `alt`.

## 2. What other tools do

Detail and sources are in `agent-output-images/research.md`.

| | Images in output from | Drawn in the transcript | Lightbox | Stored as | Remote images in replies |
| --- | --- | --- | --- | --- | --- |
| Claude Code CLI | MCP image blocks, `Read` of an image, Chrome screenshots, `SendUserFile` | `[Image]` placeholder; markdown images become links | Cmd-click opens in the OS viewer | Base64 in the session JSONL, twice per `Read` (#80175); MCP originals also saved under `tool-results/` | Never drawn |
| Claude Code desktop and web | The same, plus a browser pane | Thumbnails for `Read` and `SendUserFile`; MCP images collapsed or missing (#101011) | Web: fit-to-viewport overlay, no zoom | Thumbnails served as `/preview` assets on web | Artifacts' CSP blocks every external image |
| Codex CLI | `view_image`, MCP images, `image()`, image generation | Placeholders ("Viewed image", "Returned image"); Kitty and Sixel thumbnails since 2026-10-15 | n/a | Base64 `data:` URLs in session files; 20 to 98 GB bloat reports; an `AttachmentStore` with `file_id` since September | Never fetched for the model |
| Codex app | The same, plus a browser and Computer Use | Generated images inline; MCP images not drawn (#43497) | Focused and Canvas views | Moving to attachment references (`fileId`, #54398) | `url_safe` check, fails closed |
| Cursor | MCP images ("attaches returned images to the chat"), Browser screenshots, image generation | Inline in Agent chat (regressed in 3.16) | Not documented | Not documented; generated images saved to `assets/` | Remote images stripped from Mermaid after CVE-2025-54132 |
| Cursor cloud agents | Computer use | Artifacts: video, screenshots, logs | n/a | Hosted, "long, unguessable URLs viewable without authentication" for PRs | n/a |
| Devin | Browser screenshots and recordings | Attached to session messages | Video player | On Devin's machine | Rendered from untrusted domains; no fix confirmed |
| Windsurf (Devin Desktop) | MCP tools (images not documented) | Not documented | n/a | n/a | Image exfiltration reported, no fix confirmed |
| Replit Agent | App Testing's browser | Video replay in the task view | Scrubber | n/a | n/a |

Five patterns hold:

1. **Bytes in the transcript are the failure every one of them hit.**
   Claude Code's JSONL duplicates base64 per `Read`. Codex's session files
   reached tens of GB, and threads became unrecoverable at 413. The AI SDK
   streams and persists the raw tool output, base64 included, unless the
   output is a reference. The fix everyone is moving to is the same: store
   the bytes once and keep a reference in the log (Codex `AttachmentStore`,
   the AI SDK's own guidance).
2. **The model's view and the user's view are separate.** The model gets
   the image as a content part in the step. What the user sees is drawn from
   something else. Claude Code desktop and Codex app both have open bugs
   where the model saw an MCP image and the user did not.
3. **An explicit "show the user this file" tool exists where it matters.**
   Claude Code has `SendUserFile` (render or attach), Codex has
   `generatedImage(result)`, and Cursor's cloud agents attach artifacts.
   Images the agent merely reads are its input, often drawn smaller or not
   at all.
4. **A remote image in model output is an exfiltration channel.** ChatGPT,
   Bing, Bard, Claude.ai (2023), Copilot Chat (twice, the second through
   GitHub's own Camo proxy), M365 Copilot (EchoLeak), GitLab Duo, Cursor,
   Windsurf, Devin and Amp were all reported. The fixes were: no rendering
   (GitHub), click to load (Anthropic), or an allowlist with URL checks
   (OpenAI). Allowlists of multi-tenant domains were bypassed.
5. **The lightbox is plain.** Fit to the window, arrows, Esc, download.
   Nobody documents before-and-after diffs of screenshots. Devin and Replit
   moved to video for testing evidence.

## 3. The design

### Where pictures come from in v1

**1. An agent shows pictures: `show_image(images)`.** It is a coding-agent
and worker tool, beside `show_page` and `post_to_inbox`. `images` is a list
of 1 to 20 `{path, caption}`, one call per set the agent means to show
together (§3, Several pictures).

- `path` names a file in the sandbox, read through `readInboxImage`'s
  intake: resolved from the checkout, streamed, sniffed, bounded.
- `caption` is one line of up to 300 characters, the Inbox's bound for an
  image's words. It is the picture's alt text and its visible caption.
- The service stores each file and answers
  `{status: "shown", pictures: [{id, mediaType, width, height, byteCount}]}`.
  Width and height come from the file's header, read beside its type.
- **The model is answered in words.** "Shown to the developer: <caption>."
  It never gets the picture back: it made the file, and `read_file` already
  lets it look. `show_image` is the agent's output, not its input.
- A refusal is one sentence the model can act on: "artifacts/full-page.png
  is 4.6 MB, and a picture is kept up to 4 MB. Save it smaller, as a JPEG or
  a WebP, or as the part of the page that matters, and show it again."
- **The instructions say when to use it:** after a change to anything
  visible, show what it looks like now. They say how to take a screenshot
  in the sandbox (Playwright, installed with `npx` when needed) and that
  `![](path)` in a reply shows nothing.

**2. An MCP tool answers one: kept automatically.** In the relay, as it
settles a tool result, before `settlementOf`:

- each `{type: "image", data, mimeType}` block in the output is sniffed,
  bounded, and stored, and its `data` is replaced by
  `picture: {id, mediaType, width, height, byteCount}`;
- a block over the limit becomes `{type: "image", mimeType, byteCount,
  omitted: "too-large"}`, and one past the conversation's count becomes
  `omitted: "limit"`;
- this covers `connection_execute` and its nested `<provider>_remote` call.
  The two carry the same bytes, and the file is keyed by its hash within the
  conversation, so it is stored once and named twice;
- the model's view is untouched. eve's `toModelOutput` runs on the raw
  value in its own step, so the model sees the picture as it does today. Only
  the record changes;
- the relay's durable state (`withSettlement`) holds the same reference,
  not the base64.

`resource` blocks with an image `blob` are kept the same way. Audio and
other blobs are left as they are (§8).

**3. Markdown images in replies: never fetched.** Every `![alt](address)` is
turned into Luke's own element before Streamdown's hardening sees an image.
That is a remark step, as mentions already have (`markMentions`). It draws
as a link with the image-off glyph, its address in the tooltip. A press
opens an `https` address in the browser, as any link does. A sandbox path
opens nothing.

- This replaces both of main's behaviours, the grey pill and the nothing,
  with one honest one.
- Why never: the panel's `img-src` admits `https://*.googleusercontent.com`
  for avatars. That is the multi-tenant domain Bard's exfiltration bypass
  used (research §Exfiltration). A model-written address must never become an
  image element in this window.
- Resolving `![](path)` from the sandbox when the reply lands is the
  alternative in D2. It is not recommended: the reply would hold a path that
  means nothing once the sandbox is gone, and the read would happen at an
  unknown time against a file that may have changed.

### Where it is stored

Recommended: **a `conversation_attachment` table shaped like
`plan_attachment` and `inbox_attachment`.** Each row holds:

- `id` (uuid);
- `conversation_id` (cascade);
- `user_id`, the agent's owner (cascade, as the conversation's);
- `sha256`, unique with `conversation_id`;
- the sniffed `content_type`;
- `width` and `height`;
- `byte_count`;
- `bytes` (`bytea`, held to 4 MB by a check);
- `created_at`.

Why the conversation, and not the agent or the plan:

- A transcript is a conversation. A coding agent has one, each worker's
  subagent task has a child conversation (`childConversationId`), and the
  planning model's Call tab has one per plan. A table keyed by conversation
  serves all three without a second migration when the Call tab follows (§8).
- **Pictures go when their transcript goes.** Conversations cascade with
  their parent, and the sweep already purges deleted ones after thirty days
  (`maintenance-sweep.ts`). So no new sweep is needed, and no picture
  outlives the words that named it.

Why a table of its own beside 318's, rather than one table for every owner:

- Each owner cascades by a real foreign key: plan, item, conversation.
  One table with three nullable owners and a check is a polymorphic key
  Postgres cannot cascade cleanly.
- The code is what is shared. Lift these into one module so that each
  table is a dozen lines:
  - the type and size sniff;
  - the bound and its refusal sentences;
  - the serve headers (`nosniff`, `private, no-store`);
  - the read's view schema (`{contentType, base64}`).
- **Coordination with 318:** whichever of their PR 2 and this one's PR 1
  lands first creates `packages/service/src/files/stored-image.ts` and
  `features/image-signature.ts`'s dimension read; the other adopts it.

Why Postgres and not Blob is 318's answer and holds here: there is no object
store to reuse, the inbox made the same call, and moving the bytes later
changes the route, not the transcript, because the transcript names an id.
What would change the answer: video (§8), or pictures piling up faster than
the bounds below allow.

**Limits.** Dean asked whether 3 MB and 300 per conversation were too
restrictive. Benchmarked, with sources in `research.md` §Limits:

| | Per picture | Per message or call | Per conversation |
| --- | --- | --- | --- |
| Claude API | 10 MB base64 (~7.5 MB), 8000 px | 100 or 600, 32 MB a request | None (the context window) |
| Claude.ai | 10 MB | 20 | Not documented |
| ChatGPT | 20 MB | Not fixed | Not documented; 80 files per 3 hours; 25 GB per user |
| OpenAI API | 2048 or 6000 px | 1,500, 512 MB a request | None |
| GitHub | 10 MB | Not documented | Not documented |
| Linear | 10 MB on Free, unlimited on paid | Not documented | Not documented |
| Slack | 1 GB a file | 10 files | Unlimited (Free stops at 5 GB) |

Nobody bounds a conversation by a count; they bound by context, upload
rate, or account storage. And Vercel caps a function's response at 4.5 MB
([limits](https://vercel.com/docs/functions/limitations#request-body-size)),
which bounds one picture's read. So:

- **4 MB per picture**, raw bytes, served raw by the read, under Vercel's
  4.5 MB. The service cannot re-encode, and an agent's full-page PNG is
  often 1 to 3 MB. Over it, a picture is "Not kept", with its size.
- **200 MB per conversation, in bytes, not a count.** An agent that shows
  many small screenshots is never cut off before one that shows a few large
  ones. Past it, a picture is "Not kept".
- **20 per `show_image` call**, claude.ai's per-message count.
- **Deduplicated by SHA-256 within a conversation.** The wrapper and nested
  call carry one picture, and agents re-show the same screenshot.
- Each bound is one constant in `CONVERSATION_PICTURE_BOUNDS`
  (`features/conversation-picture-wire.ts`). The byte bound is also the
  table's check, so moving it is that edit plus `pnpm db:generate`.

### Several pictures

Dean asked: "What if an agent wants to show multiple images in a row? Popular
dev tools can put a bunch in one row."

- **One call, one set.** `show_image` takes up to 20 images, and the set
  draws as one block. The agent decides what belongs together.
- **Calls in one step, nothing between them, draw as one set too.** Models
  issue parallel tool calls, so two `show_image` calls the same step made
  would otherwise draw as two blocks for what the agent meant as one.
  `turn-rows.ts` already groups adjacent calls; a run of shown pictures
  joins into one set there.
- **Two or three pictures draw as one justified row.** Each keeps its own
  shape, uncropped, and the row stretches to the column so they share a
  height. Each is captioned under itself. A narrow column wraps the row
  where the pictures would be too small to read.
- **Four or more draw as thumbnails of one height that wrap.** Six are
  drawn, the sixth reading "+N", with a line saying how many there are.
  Their captions move to the viewer's header, so a long set does not
  lengthen the turn.
- **The viewer walks the whole set**, "3 of 8", the ones the turn did not
  draw included. Add to plan is in its header, one picture at a time.
- While the call runs, each picture's place waits at 16:10. Once it
  answers, each place takes the picture's own shape.

This is what ChatGPT, Claude.ai, GitHub, and Linear do with several images
in one message: a row or grid of thumbnails into one viewer with arrows.
Uncropped tiles are the one change, because a screenshot cropped to a square
loses what it shows. The show draws two, three, and eight pictures, at full
width and at 340 px, in both appearances.

### How the transcript names it

The stored tool output carries
`picture: {id, mediaType, width, height, byteCount}` and nothing else:

- **No bytes.** The message log, the journal amend, the long poll, the Work
  tab's projection and eve's durable relay state all carry ids.
- **No URL.** An address the model wrote is never drawn (§3, Markdown).
  An id can only be read through the route, which checks the reader.
- **Width and height** let the desktop hold the picture's exact place while
  its bytes are read, so the turn never jumps.

### Who sees it

**Exactly whoever can read the agent's transcript, checked on every read.**
The routes are `GET /api/agents/:id/files/:file` and
`GET /api/agents/:id/subagents/:callId/files/:file`:

- `reachedAgent`, then the file's conversation must be the agent's, or a
  child of it for the subagent route;
- the answer is the sniffed type, with `private, no-store` and `nosniff`,
  and nothing about the file in a log line;
- there is never a public or unguessable URL. Cursor's cloud agents use
  "long, unguessable URLs viewable without authentication" for GitHub's
  proxy; Luke does not.

**The rest of what leaves the picture's reach:**

- **Traces.** Luke configures no OpenTelemetry exporter. eve records tool
  outputs in spans only when `recordOutputs` is on, which it is not here.
  The service's spans log no bodies. A picture's id may appear; its bytes
  never do.
- **eve's session history** (Vercel Workflow) holds the raw tool output,
  base64 included, while the session runs. Its retention is zero once the
  session finishes (`apps/web/coder/agent.ts:27-30`). That is already true
  for MCP pictures today, and this proposal does not change it.
- **Counted events.** None carries an output. Two buckets may be added,
  `picture_count` and `picture_omitted`, on the existing turn event. No
  name, caption or path.
- **Fixtures and tests.** Synthetic pictures only, made in the test (a 4×3
  PNG) or drawn like the show's.
- **Session replay.** An agent's and a worker's tab are already left out
  whole. The picture, its chips and the viewer also wear `ph-no-capture`,
  so a recording draws an empty box of their size if the tab rule ever
  loosens. A picture holds words, so it is blocked, not only masked.
- **Old desktops** see a `show_image` row as an unknown call with its JSON:
  an id, a size, a caption. An MCP row's JSON shrinks from base64 to an id.
- **AGENTS.md.** Its carve-out already lets "an integration's MCP tool calls
  and results … reach the conversation, the model, an agent's transcript, and
  its traces". A kept MCP picture is inside it, so no addition is proposed.

**PRIVACY.md** gains a paragraph, "Pictures a coding agent shows you":

- what is kept: pictures an agent shows from its sandbox, and pictures an
  integration answered, up to 4 MB each and 200 MB a conversation;
- where: in our database beside the agent's transcript;
- who: every member of the workspace who can read the agent;
- how long: they go with the transcript;
- that our operators can read them, as they can the transcript;
- that a picture over the limit is not kept, though the model saw it;
- that a picture an agent writes as an address in its reply is never
  fetched.

The Linear and Notion paragraphs say "everything Linear answered … is written
to the agent's transcript". They gain "a picture among it is kept as a
file beside the transcript".

### Drawing it

All of this reuses 318's pieces, lifted out of the plan into
`renderer/stored-image.tsx`:

- **`StoredImage`.** The picture is its own block, at its own width up to the
  column's, and at most 420 px tall. It sits in a hairline frame on the
  section's fill, with its caption under it in the secondary ink.
  - **Pending:** a quiet box of the picture's own shape with the region
    spinner, as `plan-image-pending`.
  - **Failed:** the Inbox's "The image could not be read." with Retry, in
    the same box.
  - **Missing:** the caption marked "not available", on a dashed edge.
- **The window's cache by id**, 318's. `codingAgents.fileRead` (main, on the
  bearer) reads a file into a `data:` URL, which the CSP already allows. A
  file's bytes never change, so it is held for the window's life and
  evicted with the agent's tab. No `blob:`: `img-src` does not admit it, and
  nothing here needs it.
- **A shown picture** draws where its call stands in the turn, in place of a
  tool row.
  - It is **kept out of a finished turn's fold.** `turn-rows.ts` already has
    the seam (`RowReading.kept`, which keeps the newest to-do list out), so
    the turn reads: its work folded, the picture, then its last words. The
    show draws this.
  - While the call runs, the box is 480 by 300 and says "Showing
    <path>". The service is reading the file and its shape is not known yet.
  - A refused call stays a row with its error, as any failed call does.
  - **Hover tools:** Add to plan, and Open. 318's tools bar, same tokens.
- **An MCP call's pictures** draw as the message box's 64×48 chips **under
  its row, whether the row is open or closed**. A picture is what a reader
  scans for, and a closed row would hide it. They are not drawn full size,
  because they are the agent's input, not its answer.
  - A chip still reading shows the inline spinner, and one that failed shows
    the image-off glyph.
  - A picture that was not kept is a chip reading "Not kept 6.4 MB".
  - Opening the row shows the stored JSON, now with ids.
  - In a finished turn the row folds with its run; the chips go with it.
- **The lightbox is main's `AttachmentViewer`.** It walks the turn's
  pictures (a shown picture) or the call's (chips) with the arrows, names
  each by its caption or `<remote tool>-<n>`, shows its size, and has
  Download and Esc. It gains one button, **Add to plan**, for an image.
- **A worker's tab** draws the same, through its own route.

### Promote to plan

**Add to plan**, on a picture's hover tools and in the viewer:

1. Main calls `planning.attachFile` with `{from: {agent, file}}`, 318's
   `POST /api/plans/:id/files` taking a source instead of bytes. The service
   checks that the reader can reach both, and copies the bytes into
   `plan_attachment`. This is 318's `planning.copyFile` (their PR 4) with a
   conversation as the source.
2. The picture's line, `![caption](https://tryluke.dev/<ws>/plan/<id>/files/<file>)`,
   is written as your edit:
   - at the caret, if the plan editor is open;
   - otherwise at the end of the plan, as a new revision named for you,
     with the toast "Added to the plan", Open and Undo.
3. The press reads **In the plan** for that picture from then on, in this
   window.

It is a copy, not a reference. The plan's readers and the agent's readers
are the same workspace today, but a plan outlives its agents, and a plan's
picture must not vanish when an agent's transcript is purged.

Agents already have their own way to do this in 318's PR 6 (`edit_plan`'s
image note from a sandbox path), so no agent tool is added here.

## 4. Agents and Luke

| | v1 | Later |
| --- | --- | --- |
| A coding agent shows the developer a screenshot | `show_image` | Screenshots of every run, taken by Luke (§8) |
| A worker shows one | `show_image`, drawn in its tab | |
| An integration's picture | Kept and drawn as chips | |
| The agent reads a picture it took | `read_file`, as today, drawn as today | The picture in its row, from the sandbox at read time |
| Luke's planning model (Call tab) | MCP pictures are kept by reference (PR 1, since the relay is shared), drawn as today's rows | Chips on the Call tab, through a plan route |
| `run_on_mac` | Text only | A Mac screenshot through a `show_mac_image`, with consent (§8) |
| Generated images | None (Luke has no image model) | `show_image` covers a file a tool generated |

## 5. Bundle, performance

- **Bundle.** `renderer.js` grows by `ShownPicture`, `ToolPictures`, the
  remark step, and the read, about 3 KB gzipped. `StoredImage`, the cache and
  the viewer are shared with 318's. There is no budget change.
- **The transcript.** The read carries ids. A turn with ten screenshots
  costs ten reads of about 300 KB each, once per window, and only for
  pictures drawn. A chip in a folded run is not drawn until the fold opens,
  so its picture is not read either.
- **The write path.** The relay inserts a picture once per hash, in the same
  turn it settles. The journal row is smaller than today's.
- **The model.** No change. MCP pictures reach it as today; `show_image`
  answers in words.

## 6. Migration: expand and contract

- **Expand (PR 1).** One additive migration creates `conversation_attachment`
  with its unique `(conversation_id, sha256)` and its index on
  `(conversation_id)`. No existing row changes.
- **Rows already stored** with base64 in `messages.parts` stay as they
  are. A one-off backfill could move them; it is not proposed, because MCP
  pictures have been rare and conversations age out. The desktop draws an old
  row as its JSON, as today.
- **Old desktops.** They draw `show_image` as an unknown call, and an MCP
  row as smaller JSON. Nothing breaks.
- **Contract.** None. Backing out is dropping the routes and the tool. The
  table can stay, and a stored id draws "not available".

## 7. Risks

- **Database growth.** Agents that screenshot freely grow the database and
  its backups faster than plans do. The 4 MB and 200-MB-per-conversation bounds,
  the hash dedupe, and the purge with the conversation hold it. A counted
  bucket on picture bytes per turn would show the trend before it matters.
- **A picture can show a secret.** An agent may screenshot a page that
  shows an API key. The developer sees it, as they would see the agent's
  `bash` output. Operators can read it, as they can the transcript. It never
  reaches a trace, a counted event, or a fixture. The instructions tell the
  agent not to show credentials, in pictures as in words.
- **A picture can carry instructions.** An MCP image is already in the
  model's context today; drawing it for the developer adds no channel. The
  model never gets `show_image`'s picture back, so a shown picture can't
  inject.
- **eve's running session history keeps base64** until the session ends.
  That is unchanged from today, and the PRIVACY.md section on "Who we send
  it to" already covers it.
- **Prompt cost does not change**, which is the point. Codex and Claude Code
  hit request-size walls by resending pictures every turn. Luke's model sees
  an MCP picture where eve already sends it, and never a shown one.
- **Sandbox screenshots are slow to set up.** Playwright and Chromium cost
  about a minute and 150 MB on first use in a sandbox. If agents use this
  often, a browser in the sandbox image is the next PR (§8, D11).
- **318's shapes may move.** The lift of `PlanImage` into `StoredImage` and
  the cache's key both depend on their PR 3. PR 4 here waits for it rather
  than drawing its own.

## 8. Later, ranked

| What | Value | Effort | When |
| --- | --- | --- | --- |
| The Call tab's pictures | Medium: Luke's MCP pictures, drawn | S: a plan route over the same table | After PR 4 |
| A browser in the sandbox image | High if agents screenshot often | M: image size, snapshot time | In progress: worker 349 (agent capability gaps) |
| `read_file`'s picture in its row | Low: the agent's input | S: read at settle, keep by hash | Only if asked |
| Screenshots of every run, automatic | Medium | L: a browser and a dev-server convention per repository | Not planned |
| A Mac screenshot (`run_on_mac`) | Low | M: consent, the Mac carve-out | Not planned |
| Video (a test recording) | Medium, as Devin and Replit do | L: object storage, a player, `media-src` | Not planned; it is what would justify Blob |
| Before-and-after pairs | Low; nobody ships it | S once pictures exist: the viewer showing two | Not planned |

## 9. Decisions for Dean

1. **Sources in v1.** *Recommended:* `show_image` from the sandbox, and
   MCP image results kept automatically. Later: `read_file`'s pictures, the
   Call tab's, Mac screenshots (§8).
2. **How an agent shows a picture.** *Recommended:* an explicit
   `show_image(path, caption)` tool, beside `show_page`. Alternatives:
   - draw every image the agent reads, which is noise, since most reads are
     its own checking;
   - resolve `![](path)` from the sandbox when the reply lands, which ties
     a reply to a sandbox file that may change or vanish.
3. **Storage.** *Recommended:* `conversation_attachment`, keyed by
   conversation, beside `plan_attachment` and `inbox_attachment`, sharing one
   stored-image module with 318's (§3). Alternatives: one polymorphic table
   across owners, which changes 318's PR 2 before it lands; or Vercel Blob,
   which only video would justify.
4. **How the transcript names a picture.** *Recommended:*
   `picture: {id, mediaType, width, height, byteCount}` in the stored output,
   with no bytes and no address.
5. **Limits.** *Approved, then revised:* 4 MB per picture, 200 MB per
   conversation in bytes rather than a count, 20 per call, and
   deduplication by hash. Over a limit, the picture is "Not kept", with its
   size (§3, Limits).
6. **Does the model see what it showed?** *Recommended:* no. `show_image`
   answers in words, and the agent looks with `read_file` when it wants to.
7. **Where pictures draw.** *Recommended:* a shown picture inline, kept out
   of the finished turn's fold. MCP pictures as chips under their row, open
   or closed. Both open the shared viewer.
8. **Who sees them.** *Recommended:* whoever can read the agent, checked on
   every read, with no public link ever. Never in traces, counted events or
   fixtures beyond ids. A PRIVACY.md paragraph (§3). No AGENTS.md change.
9. **Markdown images in replies.** *Recommended:* never fetched, drawn as a
   link with the image-off glyph, replacing main's grey pill and blank.
10. **Add to plan.** *Recommended:* copy the bytes into the plan and write
    the line at the caret if the plan editor is open, else at the plan's end
    as your edit, with Undo.
11. **A browser in the sandbox.** *Recommended:* not in v1. The instructions
    say how to install Playwright when the agent needs a screenshot. Bake
    Chromium into the sandbox image if use shows it is worth the snapshot
    size.
12. **Order.** *Recommended:* PR 1 first. It stops the base64 in the message
    log, and it needs nothing of 318's.
13. **Several pictures in a row.** *Recommended:* `show_image` takes 1 to
    20 images, and calls in one step with nothing between them draw as one
    set. Two or three draw as one justified row; four or more draw as
    wrapping thumbnails, six shown with "+N"; the viewer walks the set.

## 10. PR plan

Each PR ships its tests (`AGENTS.md`, Testing). The sizes are lines changed,
tests included. "318's PR n" is their plan's numbering (§10 of
`plan-media.md`): PR 1 is #2886, PR 7 is #2890, and PRs 2 to 6 are not yet
open.

| # | PR | Size | Needs |
| --- | --- | --- | --- |
| 1 | `fix(database,service)`: an integration's picture is kept by reference, not as base64 in the transcript. `conversation_attachment` and its migration; the shared stored-image module (sniff type and dimensions, bound, refusal words); the relay's capture of `image` and image `resource` blocks, deduplicated by hash, "omitted" over a limit, in the stored output and the durable state alike. Store tests on `getTestDB()`, including that one account cannot read another's file; a relay test that the model's output keeps the bytes and the stored one holds the id. | M · ~600 | Nothing. Coordinates the shared module with 318's PR 2. |
| 2 | `feat(service,web,features)`: an agent's and a worker's pictures are read by id. `GET /api/agents/:id/files/:file` and the subagent route, through `reachedAgent` and the conversation check; the client and view schema; the rewrites table; PRIVACY.md's paragraph. | S–M · ~350 | 1 |
| 3 | `feat(service)`: `show_image(path, caption)` for coding agents and workers. It reads the file through the inbox's intake, keeps it, and answers the model in words; plus the instructions' paragraph. | M · ~350 | 1 |
| 4 | `feat(host,desktop)`: the transcript draws pictures. `codingAgents.fileRead`; `StoredImage` and the cache lifted from 318's `PlanImage`; the shown picture kept out of the fold; the chips under a call's row; the viewer walking them; markdown images as links that never fetch. | M–L · ~650 | 2, and 318's PR 3 (to lift `PlanImage` rather than draw a second one) |
| 5 | `feat(desktop,service)`: Add to plan. `planning.attachFile` from a conversation's file; the line at the caret or the plan's end; the toast with Undo; "In the plan". | M · ~350 | 4, and 318's PRs 2 and 4 |

PRs 2 and 3 are independent of each other once PR 1 lands. If 318's PR 3 is
late, PR 4 can land first with `StoredImage` as the shared component and 318
adopts it; the two workspaces agree which way before either starts.
