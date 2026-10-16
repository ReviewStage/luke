# Proposal: @-mentions with chips in the agent composer and the plan

Status: **approved by Dean on 2026-10-14** ("I agree with the @-mentions
build… I agree with all your recommendations for @-mentions"), and being
built as the PR order in §8 describes; what has shipped is listed there.
The link format was settled the same day (see "The link format (settled)"
below).

The design show lives at `docs/proposals/at-mentions/index.html`. It is
one self-contained file, generated from the desktop renderer's real
components and stylesheet, that fetches nothing. Open it in a browser;
round 1 is at its `#round1`.

Dean's ask: "I want to be able to @ mention things in the agent composer with
chips. Let's plan out what we should @ mention and how this will work." He
later added: mentions in the plan document too, not only in the agent's
message box.

## Decisions (Dean, 2026-10-14)

1. **v1 is files and folders, and the plan and its sections.** Integration
   objects come next.
2. **Files are references.** The agent reads a file itself from its own
   checkout, and nothing is pasted in.
3. **An integration object is stored as its title and its link.** There is
   no per-integration code. Decision 13 later added the generic per-turn rule
   on top.
4. **Integration permissions take the simplest default.** The list shows
   items from your own connections, a pick inserts the title and link, and
   nothing checks it afterwards.
5. **No agent mentions for now.** Coding agents have no tool to see or
   message another agent; only Luke's planning model has list, read, message
   and start (`packages/service/src/agents/coding-agent-tools.ts`). Agent
   mentions wait until coding agents get such tools. Superseded on
   2026-10-16 (Dean: "Let's add @-mention support for Pages. And any other
   tabs that make sense."): the task's other agents are mentioned, and the
   one mentioned is handed by its id, its branch and its pull request, which
   a coding agent reads with `gh` and `git`, never its conversation.
6. **No person mentions yet.**
7. **The plan document takes mentions too** (§5).
8. **The message box moves to TipTap**, the rich editor the plan already
   uses (#3): "I am interested in migrating the message box to the richer
   editor actually." The composer and the plan share one chip (§7).
9. **Section links ship first, as PR 0** (§5.6). That includes "Copy link to
   section" on a heading's ⋯, and the struck-through "No longer in the plan"
   state.
10. **A developer's heading rename rewrites the plan's own `@` references to
    it, in the same edit.**
11. **After v1, the `@` list gains a Skills group.** `/` keeps working.
12. **MCP server and tool mentions (PR 6) follow one generic rule** (§4.6):
    - a short note names the server and its tools;
    - a switched-off server is turned on for that turn only;
    - the saved switch is untouched.
13. **Integration-object mentions (e.g. LUKE-142) follow the same rule.**
    They bring that integration in for the turn, with the title and link and
    a one-line note. This supersedes the earlier decision 3's "nothing is
    switched on".
14. **No per-integration search; a pasted link becomes a chip instead.**
    Dean: "Let's skip the per-integration search." PR 7 is dropped. In its
    place (§4.8):
    - a page of an integration's (a Linear issue, a pull request, a Notion
      page), pasted whole into the message box or the plan, becomes a chip
      wearing the integration's mark;
    - its name is the address's readable form (`LUKE-142/fix-the-thing`,
      `relay/pull/123`), since nothing here asks the provider for a title;
    - it follows decision 13's rule: the integration's server is handed to
      the turn that takes the message on, with a note naming the page and
      the connection;
    - the only thing per integration is data: which web hosts are whose.
15. **The link format is approved** (below): worker 273's canonical https
    links.

## The link format (settled)

**Settled by Dean on 2026-10-14** (`docs/proposals/web-and-links.md`, Part
1): a mention stores the thing's address on the web, the pattern Linear,
Notion, Slack and GitHub use, so a mention copied out of Luke still leads
somewhere.

| Kind | Stored target |
|---|---|
| Plan | `https://tryluke.dev/<workspace slug>/plan/<planId>` |
| Section | the plan's, then `#<anchor>`: the heading as GitHub spells a heading's anchor, `-1`, `-2` for a heading borne again |
| File | `https://github.com/<owner>/<name>/blob/HEAD/<path>`; its lines `…/blob/<commit>/<path>#L3-L5` |
| Folder | `https://github.com/<owner>/<name>/tree/HEAD/<path>` |
| MCP server, tool | `luke://mcp/<provider>[/<tool>]`, an internal form, since it has no page on the web |

The desktop app's own scheme is `tryluke://`, the plan's address with its
scheme swapped. Every `luke://plan/…`, `luke://file/…` and
`luke://folder/…` target this document shows is the provisional form the
first PRs shipped with. Those stand in plans and messages already, so
`mention-link`'s `decodeMention` reads them forever, as the same `Mention`
the settled form names; nothing rewrites them.

The rest of the code sees only `Mention` values, through `encodeMention`
and `decodeMention`:

- `Mention` is a tagged union with no format in it: `{kind: file, path,
  lines?}`, `{kind: folder, path}`, `{kind: plan, planId}`,
  `{kind: section, planId, anchor}`, `{kind: server, provider}`,
  `{kind: tool, provider, tool}`, and `{kind: link, provider, url}`.
- A section is named by its anchor rather than its heading's words, so
  §5.6's "gone" state and the editor's rename rewrite follow anchors.
- One order matters now that files are GitHub links: a GitHub blob or tree
  address of the plan's repository reads as a file or a folder first, and
  any other GitHub page as a `link`. Every reader is handed the plan's
  repository for that.

## Still open

Nothing.

The design show holds a catalog of every kind considered, now and
later. For each kind it gives the picker row, the chip, the hover card, the
exact stored text in the message and the plan, what the agent receives,
and a status. It also shows the two routes side by side (B, TipTap, chosen), each with a live
prototype. Two recommendations from the catalog:

- **MCP servers and tools: mention them the Codex way (§4.6, PR 6).** This
  revises the first answer, "only a hint". The chip adds a generic note
  naming the server and its tools. A switched-off server is decided to be
  handed for that turn only, which goes past what Codex does.
- **Skills keep `/`.** The `@` list also offers a Skills group whose pick
  writes the same `/name`.

## TL;DR

- **The category has settled on one shape.** `@` opens a single type-ahead
  list. It starts with recent items, then groups results by kind and narrows
  to one kind on request. The thing picked becomes an atomic chip that one
  Backspace removes. Zed, the Codex CLI, Claude Code, Cursor 2.0+ and Devin
  all ship this (§1).
- **The wire is a markdown link in the words**, `[@label](target)`, as in
  Zed and Linear. The target is a `luke://` URL for something of the plan's
  (a file, a folder, a section) and the object's own URL for an integration
  object. One string serves the message box, the plan's markdown, and the
  model alike.
- **v1:** the plan repository's **files and folders**, and the **plan
  and its sections** (Dean, decision 1).
  - **Next:** integration objects (Linear issues, Sentry issues, Notion
    pages, Slack threads and the rest) as title and link, found through
    your own connections. Also pull requests, Inbox items and pages.
  - **When coding agents get agent tools:** agents.
  - **Not yet:** people, calls and turns.
- **What the agent receives:**
  - **Files and folders:** the links. The agent reads them with
    `read_file` and `glob` on its own branch (Dean, decision 2).
  - **Integration objects:** their titles and links, which Dean decided.
  - **Plan sections:** a budgeted snapshot, since a coding agent can't read
    the plan again.
- **The plan document:** its TipTap editor gets the same `@` and the same
  chip. Its read view draws `[@…](…)` links as chips. Luke's notes keep
  those links intact.
- **The editor (Dean, #3):** the message box moves to TipTap first, in a
  PR that changes nothing visible (§7). `@` then lands in the plan and the
  composer on one node, one picker and one chip.
- **First of all, a small PR gives plan sections links** (§5.6). It adds the
  `luke://plan/<id>#<heading>` target, an in-app opener that scrolls to the
  heading, and "Copy link to section". No OS-level deep link is needed.

## 1. How others do it

I read each vendor's current docs on 2026-10-14. Where a doc is silent I say
so, and for two open-source products I read the source. Full notes with every
citation are in `at-mentions/research-coding-agents.md` and
`at-mentions/research-collaboration.md`, beside this file.

### Coding-agent composers

**Cursor.**
- **Trigger and picker:** `@` opens a list that filters as you type. Folders
  are two-level: "type `/` after selecting a folder to navigate deeper"
  ([prompting](https://cursor.com/docs/agent/prompting)). Past chats and the
  Branch row "appear right away" when the list opens
  ([3.24](https://cursor.com/docs/release-notes/agents-window#oct-9-2026)).
- **Chips:** files and folders have rendered "inline as pills" since 2.0
  ([changelog](https://cursor.com/changelog/2-0)). Sent messages keep their
  chips ([3.21](https://cursor.com/docs/release-notes/ide#sep-17-2026)).
- **What the model gets:** a reference, not file content. "A file mention …
  tells Agent where to look, and Agent reads the file with its tools … The
  file's contents are not inlined"
  ([rules](https://cursor.com/docs/rules)). A folder sends its file tree;
  full folder content was removed because "the benefit … was usually not
  worth the cost"
  ([staff](https://forum.cursor.com/t/cursor-2-0-missing-full-folder-context/140027)).
  Mentioning another agent in a Project lets the coordinator "read that
  agent's transcript and send it messages"
  ([cloud agents](https://cursor.com/docs/release-notes/cloud-agents#oct-5-2026)).
- **Removed kinds:** 2.0 dropped @Web, @Definitions, @Linter Errors and
  others, because "Agent can now self-gather context". 3.21 dropped @Docs.
- **Limits:** none documented for local mentions. Cloud agents take files up
  to 10 MB.

**Claude Code.**
- **Trigger and picker:** `@` opens one mixed list, with no group headers,
  of files, MCP resources (`@server:protocol://path`), subagents and live
  sessions. It uses fuzzy Rust matching and icons per type.
  - Enter or Tab accepts
    ([workflows](https://code.claude.com/docs/en/common-workflows#reference-files-and-directories),
    [MCP](https://code.claude.com/docs/en/mcp#use-mcp-resources)).
  - Clicking a folder in the list opens it
    ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
- **Chips:** in the CLI a mention stays the text `@path`; desktop calls it
  "text-based" ([desktop](https://code.claude.com/docs/en/desktop)). Image
  and selection pills delete as one unit.
- **What the model gets:** an **inlined snapshot**.
  - The file's content goes in "when it fits the Read tool's token limit,
    25,000 tokens by default. A text file larger than 256KB isn't included"
    ([workflows](https://code.claude.com/docs/en/common-workflows#reference-files-and-directories)).
  - A directory sends its listing, not its contents. MCP resources are
    "fetched and included as attachments".
  - Since v2.1.299, `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1` switches to paths
    "with a note to read them using its file tools"
    ([env](https://code.claude.com/docs/en/env-vars)). That is Luke's
    default (decision 2).

**OpenAI Codex (CLI, and the app now inside ChatGPT desktop).**
- **Picker:** the CLI's unified popup (`mentions_v2`) types each row as
  Plugin, Skill, Task, File or Dir. The footer reads "Enter/Tab insert · Esc
  close · ↑/↓ select · ←/→ filter", with ←/→ cycling "All Results",
  "Filesystem Only" and "Plugins". It shows 8 rows
  ([source](https://github.com/openai/codex/blob/76ed3b484d62ccceb9fa512ff4dd139f421814c3/codex-rs/tui/src/bottom_pane/mentions_v2/footer.rs)).
- **Chips:** a file becomes plain path text. Tasks insert as atoms, `@title`
  bound to `thread://<id>`.
- **What the model gets:** "add its path to the prompt"
  ([docs](https://learn.chatgpt.com/docs/developer-commands.md?surface=cli)).
  There is no file-content input item, and the agent reads the file itself.
  A message can mention at most 16 tasks.

**GitHub Copilot.**
- **Triggers:** in VS Code, `#` is for context (files, folders, symbols,
  tools, `#codebase`) and `@` is for participants
  ([context](https://code.visualstudio.com/docs/chat/copilot-chat-context)).
  On github.com, `@` attaches Files, Issues, Pull requests and Repositories
  ([cheat sheet](https://docs.github.com/en/copilot/reference/chat-cheat-sheet?tool=webui)).
- **Picker:** two-level, through "Add Context" → "Files & Folders" /
  "Symbols" / "Issue…" / "Pull Request…" / "MCP Resources".
- **Chips:** a typed `#` reference "also appear[s] as an attachment pill"
  ([1.100](https://code.visualstudio.com/updates/v1_100)). Delete removes
  one ([1.106](https://code.visualstudio.com/updates/v1_106)).
- **What the model gets:** the old rule was "full contents … else an
  outline … else dropped". It was deleted from the docs in March 2026 with
  nothing in its place
  ([commit](https://github.com/microsoft/vscode-docs/commit/22ab8cb6eaf4a6911b7068f3394e84ec0ba2cd6c)).
  Spaces always read `main`.

**Zed's agent panel.** The closest match to this proposal.
- **Picker:**
  - A bare `@` shows recents first: up to 4 recent files and 2 recent
    threads.
  - Below them come category rows: Files & Directories, Symbols, Threads,
    Selection, Skills, Fetch, Diagnostics and Branch Diff.
  - `@file` or `@thread` enters a category. `@foo` searches files and
    category names together
    ([source](https://github.com/zed-industries/zed/blob/b25dc09370229cef7e11673d1d60b5e5713465cd/crates/agent_ui/src/completion_provider.rs)).
- **Chips:**
  - The buffer holds `[@name](uri)` (`file:///…`,
    `zed:///agent/thread/<id>?name=…`), and an inline crease folds it into a
    button with a muted icon.
  - Clicking opens the target. Deleting the folded text drops the mention
    ([source](https://github.com/zed-industries/zed/blob/b25dc09370229cef7e11673d1d60b5e5713465cd/crates/agent_ui/src/mention_set.rs)).
- **What the model gets:** the link stays inline in the text, and a
  `<context>` block follows: "The following items were attached by the user.
  They are up-to-date and don't need to be re-read"
  ([source](https://github.com/zed-industries/zed/blob/b25dc09370229cef7e11673d1d60b5e5713465cd/crates/agent/src/thread.rs)).
  - **Threads:** an LLM summary, not the transcript.
  - **Directories:** a link alone, which the agent reads with tools.
  - **Large files:** a file over 16 KB is sent as an outline.

**Windsurf Cascade (now Devin Desktop).**
- **Kinds:** `@`-mentions rules, skills, terminals and plan files, plus
  `@web` and `@docs`
  ([web search](https://docs.devin.ai/desktop/cascade/web-search)).
- **Chips:** pills gained "type-specific icons" in v3.5.17.
- **What the model gets:** a mention is "a deterministic way of bringing in
  context, and is guaranteed to be part of the context"
  ([chat](https://docs.devin.ai/desktop/chat/overview)).
- **Removed:** conversation mentions went in v3.10.23
  ([changelog](https://docs.devin.ai/desktop/changelog)).

**Devin.**
- **Kinds:** `@Repos`, `@Files`, `@Playbooks`, `@Skills`, `@Secrets` and
  `@Sessions`, with "fuzzy bag-of-words matching" and repositories ranked
  first ([release notes](https://docs.devin.ai/release-notes/overview)).
- **Sent messages:** mentions are "displayed as styled deeplinks instead of
  the raw '@Name (ID)' format".
- **File chips:** same-named files "show enough of the path to tell them
  apart, with the full path on hover".
- **Over ACP:** mentions travel "as structured resource blocks".

### Collaboration products (the wire and permissions)

**Slack.**
- **Wire:** stores ids: `<@U123>`, `<#C123>`, and in the composer's own
  output a `rich_text` block of typed `user`/`channel` elements. The name is
  drawn at view time, and the `<@id|name>` form is deprecated
  ([formatting](https://docs.slack.dev/messaging/formatting-message-text)).
- **Reader without access:** sees "an unclickable `private channel` label".
- **Deleted profiles:** read `@deactivateduser`.

**Linear.**
- **Picker:** `@` mentions "a user, issue, project, date, document, or pull
  request" in one list, with documents in the lowest section
  ([editor](https://linear.app/docs/editor),
  [documents](https://linear.app/docs/documents)).
- **Wire:** a mention is "the plain URL of the resource" in markdown, and
  agents write mentions back the same way
  ([GraphQL](https://linear.app/developers/graphql),
  [agents](https://linear.app/developers/agent-interaction.md)).
- **What an agent gets:** mentioning an agent sends it a `promptContext`
  snapshot of the issue and its threads.

**Notion.**
- **Wire:** a mention is a typed rich-text node with a UUID and a
  `plain_text` fallback. A page the reader cannot read comes back as
  "Untitled" ([rich text](https://developers.notion.com/reference/rich-text)).
- **Rename:** "the new title will automatically reflect that change wherever
  the page is @-mentioned"
  ([help](https://www.notion.com/help/comments-mentions-and-reminders)).
- **Notion Agent:** "has the same permissions you do".

**ChatGPT and Raycast.** In both, `@` picks a *capability*, a GPT, app or
extension that the model may call, not content
([ChatGPT apps](https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt),
[Raycast](https://manual.raycast.com/ai/ai-extensions.md)). Raycast's `@`
also attaches content, and an oversized attachment gives the model "the start
of it, plus the path" ([Raycast chat](https://manual.raycast.com/ai/ai-chat.md)).

### What converged

| | Trigger | Picker | Chip | Model receives | Size limit |
|---|---|---|---|---|---|
| Cursor | `@` | filter, folders drill with `/` | inline pill | reference; folder = tree | not documented |
| Claude Code | `@` | one fuzzy mixed list | text `@path` (CLI) | inlined file; folder = listing | 25k tokens / 256 KB per file |
| Codex CLI | `@` | typed rows, ←/→ filter tabs | path text; tasks are atoms | path only | 16 task mentions |
| Copilot (VS Code) | `#` / `@` | two-level Add Context | attachment pill | not documented now | not documented |
| Zed | `@` | recents, category rows, `@kind` | `[@name](uri)` crease | link plus `<context>` snapshot; thread = summary | 16 KB per file, then outline |
| Devin | `@` | fuzzy, repos first | deeplink chip | resource blocks (ACP) | not documented |
| Linear | `@` | one list, grouped by kind | resolved URL | URL; agents get a snapshot | not documented |
| Slack / Notion | `@` | live search | resolved id | id plus fallback text | not applicable |

1. **One `@` list.** It opens with recents, then lists kinds you can narrow
   to (by a row, a typed `@kind`, or ←/→). Results are grouped by kind, and
   ↑↓, Enter/Tab and Esc work throughout.
2. **The chip is an atom.** One Backspace removes it. It shows a type glyph
   and a name, a press opens the target, and the full path or name is on
   hover.
3. **The message stores an id and draws the name.** Zed and Linear keep a
   link in markdown, so the message stays readable as text. Slack and Notion
   keep typed nodes with fallback text.
4. **Agents with their own tools get references for code and fetch it
   themselves**: Cursor, Codex, and Claude Code's opt-out. Snapshots are for
   things the agent cannot fetch, such as another thread (summarized) or a
   pasted selection.
5. **Removed after shipping:** @Web, @Docs, @Codebase/`@workspace`,
   conversation mentions in Cascade, and full folder content. Each went
   because the agent finds that context on its own. A kind earns its place
   only by pointing at something the agent could not find, or could not
   reach.
6. **No product documents chip editing.** We have to decide it (§4.2).

## 2. What Luke has today

- **The composer**
  (`apps/desktop/src/renderer/planning/agent-composer.tsx`) is a
  `<textarea>`. Skill chips (`skill-picker.tsx`) are a layer under it, set in
  the same type, that lays a pill behind each `/name`.
  - That approach cannot draw a glyph, truncate, or hold anything but the
    literal text, because the pill's width must equal the words'.
  - A `/` at a word's start opens the list (`skill-mention.ts`), with ↑↓,
    Enter/Tab and Esc. Backspace at a chip's end removes the word whole.
- **The wire:** a message is `{text, clientKey, attachments?}`
  (`packages/features/src/coding-agent-wire.ts:329`), with `text` capped at
  16,000 characters.
  - The stored row is AI SDK `parts`: one text part, then file parts
    (`packages/database/src/models/attached-file-parts.ts:56`).
  - What the model is handed is `eveContent(text, attachments)`
    (`apps/web/server/hosted/attached-files.ts:46`): the words, each text
    file inlined under an `Attached file:` heading, then images and PDFs.
  - `receivedMessage` reads that heading back when it matches eve's receipt
    to the row (`:101`). This is the precedent for a second, read-back-able
    text part.
- **Skills on the server:** a `/name` gets no special handling. It reaches
  the model as words, and the prompt says to call `load_skill`
  (`apps/web/server/hosted/coder-host/instructions.ts:119`).
- **What the coding agent can read:**
  - `read_file`, `glob`, `grep` and `bash` on a full checkout, made at the
    default branch, that then moves onto the agent's own branch.
  - The plan, but only as a snapshot in its first message, and not at all
    when the agent was started with a task.
  - Only its own Inbox posts, and the public web.
  - The account's MCP connections (`connection_search`,
    `connection_execute`) for each provider switched on for it.
  - **No tool reads another agent's transcript.** `READ_CODING_AGENT` is
    the planner's alone
    (`apps/web/server/hosted/agent-runtime/tools.ts:45`).
- **What the desktop can list cheaply:**
  - The repository tree: `PLANNING_TREE`, a GitHub App listing at the
    default branch, cached by `planning/folder-listings.ts`. The command
    palette already fuzzy-ranks it with `pathScore`
    (`desktop/command-palette.tsx:276`).
  - Plan sections: `planSections` (`packages/features/src/plan-document.ts:122`).
  - The plan's agents: `CODING_AGENTS_LIST`.
  - Pull requests: off each agent's summary.
  - Inbox, pages, calls, and workspace members
    (`WORKSPACE_MEMBERS_READ`, which carries no pictures).
- **Hover cards:** shared ones exist. `AgentRef` (`planning/agent-ref.tsx`)
  already hangs an agent's card and says "Not found" for one the plan no
  longer holds. Plan cards draw their rows from `CardDetail`,
  `PullRequestLine` and the other parts in `desktop/plan-card.tsx`. The
  shared-component audit (worker 269) plans `FileRef`, `PlanRef` and
  `SkillRef` beside them.
- **Permissions:**
  - A plan is reachable by every member of its workspace
    (`packages/database/src/models/workspace-store.ts:338`).
  - Agents and Inbox items are reachable through their plan.
  - A message from another member lands in the starter's conversation, and
    GitHub reach is checked for the caller
    (`apps/web/server/hosted/coder-host/steer.ts:104-117`).

- **The plan document:**
  - **Editing:** TipTap (StarterKit, `@tiptap/markdown`, task lists,
    tables, images), loaded as its own bundle the first time a section is
    hovered (`plan-editor/contract.ts`). Each untouched block keeps its
    exact markdown source (`plan-editor/document-source.ts`).
  - **Reading:** `MarkdownMessage` draws links as inert spans and drops
    every destination but `http(s)` (`markdown-message.tsx:222`).
  - **The editor bundle** carries no React, and has no
    `@tiptap/suggestion` or Mention extension.

## 3. What can be mentioned

The ranking is by value to a coding agent working a plan. A kind ranks high
when it points at something the agent cannot find on its own, or cannot
reach at all. That is the test the category applied when it removed kinds
(§1, point 5). The table already reflects Dean's decisions.

| Rank | Kind | Value | Cost | When |
|---|---|---|---|---|
| 1 | **Files and folders** in the plan's repository | Highest. Every product leads with it, and it removes a search step ("the bug is in @session-store.ts"). | Listing exists (the palette's); the agent reads with `read_file`. | **v1** |
| 2 | **The plan, or one of its sections** | High, and only Luke has it. The coder can't re-read the plan, and a task-started agent never saw it. In the plan itself, a section mention is a cross-reference. | Sections come from the document the desktop holds; inline on send. | **v1** |
| 3 | **Integration objects:** a Linear issue, Sentry issue, Notion page, Slack thread, GitHub PR or issue, PostHog insight, Granola meeting | High: it names the work. Dean's rule keeps it cheap, as title and link only. | A search over your own connections; nothing resolved at send. | Next (Dean, decision 1) |
| 4 | **A pull request** of the plan's agents, or its Changes | Medium. A PR is how people name work. | List exists; a reference (number, branch); the agent uses git. | Next |
| 5 | **An Inbox item** | Medium: "do what I answered in @…". | List exists; inline question and answer. | Next |
| 6 | **A page** | Medium-low: a rendered spec or mock. | List exists; inline title and text excerpt. | Next |
| 7 | **Another agent of the plan** | High for handoffs, but useless until a coding agent can read or message one. | Waits for coding-agent tools (Dean, decision 2). | Later |
| 8 | **A past call or turn** | Low for a coder. The plan already distils the calls, and Cascade removed conversation mentions. | Lists exist. | Not planned |
| 9 | **A URL** | A pasted URL already reaches the model. Pasting a known kind's URL (GitHub PR, Linear issue) can turn it into its chip. | Small. | With integration objects |
| 10 | **A person** | Not yet (Dean, decision 3). | — | Not planned |
| — | **A skill** | Stays `/name`. Under the TipTap route it becomes a chip in the same editor (§7). | — | Unchanged |

## 4. Mechanics (both places)

### 4.1 Trigger and picker

- **One `MentionPicker` React component** draws the list for both the
  composer and the plan editor. Its sources and ranking are shared; only how
  the caret's place and the keys reach it differs (§5.2).
- **Trigger:** `@` at the start of a word, outside code. It follows the
  exact rule a `/` follows today (`skill-mention.ts`'s `startsWord` /
  `insideCode`, moved where both can share it), so an email address,
  `node_modules/@effect`, or a code span opens nothing.
- **The query** runs from the `@` to the caret and may hold spaces, since
  titles have them. The list closes when a typed space leaves it with no
  rows, on Esc, or when the caret leaves the word.
- **Empty query:**
  - up to four recent mentions on this plan;
  - then one row per kind under "Mention from": Files and folders, Plan,
    and each connected integration, and later Pull requests, Inbox and
    Pages.
  - → or Enter on a kind row narrows the list to it, as does typing
    `@linear:`. ⌫ on an empty query widens it again.
- **Typing:**
  - Every local kind is searched at once, ranked with the palette's own
    `pathScore` and `fuzzyScore`, moved into a shared module.
  - Groups appear in a fixed order: files and folders, plan, then
    integrations. Each group shows its best three, and a narrowed list shows
    up to 50.
  - An integration group says "Searching Linear…" until its server answers,
    below every local group, so local rows never move.
- **Keys:** ↑↓ move. ↵ or ⇥ mention. → opens a folder or kind. Esc closes.
  The keys show in the list's foot.
- **Look:** the window's searchable menu rows, with section headers and
  each kind's glyph. It stands above the caret's line in the composer, and
  above or below it in the plan wherever there is room.
- **Files:** the default branch's recursive tree, read once per plan and
  cached (`keptListings`), the same read the palette uses. A folder row
  mentions the folder, and → walks into it.
- **Integrations:** a new `/api/plans/{id}/mention-search` runs each
  connected server's search as the account and answers each hit's title,
  URL and kind. Only switched-on, connected servers are asked. It returns
  nothing a connection didn't already answer the account (Dean, decision 4).

### 4.2 The chip

- **One look, `.mention-chip`:** the kind's glyph (`FileTypeIcon`, a
  folder, `#` for a section, the integration's `IntegrationMark`) and the
  name, cut at 240px with an ellipsis. It is filled with `--raised-strong`,
  washing to `--selected` on hover.
- **Hover card and press:** the chip hangs the card its kind hangs
  elsewhere (`FileRef` and `PlanRef` as the shared-component audit plans
  them). An integration object's card shows its title and its link. A press
  opens:
  - a file in a File tab;
  - a section, by scrolling the plan to it;
  - an integration object, on its site.
- **Editing:** a chip is one character to the caret. One ⌫ removes it
  whole, ⇧← selects it, and ⌘Z brings it back. Copy gives the markdown
  link, and pasting the link gives the chip back.
- **A subject that is gone,** such as a file no longer on main or a heading
  no longer in the plan, keeps the label it was written with, struck
  through, and its card says why. An integration object is never checked
  (Dean, decision 4), so its chip always reads as written.

### 4.3 The wire: a link in the words (target format pending Part 1)

```
Move the refresh in [@session-store.ts](luke://file/apps/web/server/hosted/session-store.ts)
onto the store's Schedule, as [@Auth token refresh](luke://plan/<planId>#Auth%20token%20refresh) says;
it fixes [@LUKE-142 Token refresh fails after the Mac sleeps](https://linear.app/luke/issue/LUKE-142).
```

| Kind | Target |
|---|---|
| File | `luke://file/<repository path>` |
| Folder | `luke://folder/<repository path>/` |
| Plan | `luke://plan/<planId>` |
| Section | `luke://plan/<planId>#<heading>` |
| Integration object | its own `https://` URL, the label being its title (Dean, decision 1) |
| Next: PR, Inbox item, page | `luke://pull/<number>`, `luke://inbox/<itemId>`, `luke://page/<pageId>` |

- **The `@` at the start of a label is what makes a link a mention.** It is
  drawn as a chip, and every other link stays a link. An integration
  object's chip takes its glyph from its URL's host.
- **The targets above are the provisional forms**, still read; what is
  written now is in "The link format (settled)". Only `mention-link`'s
  encoder and decoder know them.
- **One Schema,** in `packages/features/src/mention-link.ts`, decodes a
  target into a tagged `Mention` and encodes one back. `mentionsIn(text)`
  finds the mentions outside code. `MENTION_BOUNDS` caps a message at 20
  mentions and a target at 400 characters.
- **Why a link rather than a typed part:**
  - The message stays one string, so steer coalescing, receipt and
    optimistic-line matching, copy and the 16,000-character bound are
    untouched.
  - The plan, which is markdown, holds the same text with no new storage.
  - A model reads the form fluently.

### 4.4 What the agent receives, and the budget

The words go to the model exactly as sent. When a message mentions plan
sections (and later Inbox items or pages), the server adds one text part
after the words. It sits under a heading `receivedMessage` reads back the
way it reads `Attached file:`, and it holds a snapshot of each section as
it stood when the message was sent:

```
Mentioned in this message (as it stood when sent):

## Plan section: Auth token refresh
Refresh the session token five minutes before it lapses, …
```

| Kind | The agent gets |
|---|---|
| File, folder | The link alone. The prompt says to read a file with `read_file` before acting and to `glob` a folder. Nothing is pasted in (Dean, decision 2). |
| Plan | Its markdown up to 12,000 characters, then its remaining headings |
| Section | Its markdown up to 4,000 characters |
| Integration object | Its title and link as written, plus a one-line note naming its integration ("LUKE-142 is a Linear issue; read it through the `linear` connection"). That integration is handed to the turn even if it is switched off for the agent (decision 13). Nothing is fetched at send. |
| Next: PR | The link plus its number, title and branch |
| Next: Inbox item, page | Up to 4,000 characters |

- **Budget:** the part holds at most 24,000 characters (about 6,000
  tokens). Excerpts are cut on a line, with a count of what was left out.
- **Prompt:** one paragraph joins the skill paragraph in `instructions.ts`.
  It says what a `luke://` link is, to read a file link from the checkout,
  and that the mentioned part is a snapshot from the moment of sending.
- **The plan's own mentions.** An agent started on the plan already gets
  the plan's markdown, links included. It reads file links the same way and
  sees integration objects as title and link, so nothing extra is needed
  for a mention inside the plan.

### 4.5 Permissions

- **The plan's kinds:** the picker lists only what existing reads return.
  The server resolves each link again as the sender when the message is
  taken:
  - a section must be in the agent's own plan, reachable by the sender;
  - a path is normalized, with no `..` and no leading `/`, and never read
    by the server.

  A link that fails resolution gets no excerpt and reaches the model as
  words.
- **Integration objects (Dean, decision 4):** the list shows hits from your
  own connections, and a pick inserts the title and link. Nothing checks it
  afterwards. A reader of the plan who lacks access to that Linear issue
  sees its title, which is the same as pasting the link.
- **Secrets:** nothing new crosses a line AGENTS.md draws. Section
  excerpts are plan text, and integration titles came from the account's
  own MCP answers, under the 2026-10-13 carve-out. File contents are never
  inlined (Dean, decision 2).

### 4.6 MCP servers and tools, the Codex way

Dean, on the catalog's first answer ("only a hint"): "I'm thinking of how
Codex @-mentions plugins."

**What others do.** 

Checked against source and docs on 2026-10-14.

- **Codex: a mention is a structured instruction plus readiness, never an
  enable.**
  - `@` lists plugins today (`$` lists skills and apps;
    [`mention_syntax.rs`](https://github.com/openai/codex/blob/9d3ae38e13aecaf018c03d5c1331c91f8c985e0f/codex-rs/utils/plugins/src/mention_syntax.rs)).
  - The message stores a structured `Mention { name, path }`, with a path
    like `plugin://<name>@<marketplace>` or `app://<id>`, and parses
    `[@Name](plugin://id)` links in text
    ([#13711](https://github.com/openai/codex/pull/13711),
    [`user_input.rs`](https://github.com/openai/codex/blob/9d3ae38e13aecaf018c03d5c1331c91f8c985e0f/codex-rs/protocol/src/user_input.rs)).
  - Each mentioned plugin adds one developer message, capped at 4 KB:
    "Capabilities from the `X` plugin", "MCP servers from this plugin
    available in this session: …", and "for the user request that
    explicitly selected this plugin, and only for that request … search for
    its tools before falling back"
    ([`injection.rs`](https://github.com/openai/codex/blob/9d3ae38e13aecaf018c03d5c1331c91f8c985e0f/codex-rs/core/src/plugins/injection.rs)).
  - The plugin's servers become "required", so the turn waits for them to
    start.
  - Every plugin tool's description says "This tool is part of plugin
    `X`", mentioned or not ([#13510](https://github.com/openai/codex/pull/13510)).
  - **A disabled or uninstalled plugin's mention is silently ignored.** It
    is matched only against enabled plugins
    ([`mentions.rs`](https://github.com/openai/codex/blob/9d3ae38e13aecaf018c03d5c1331c91f8c985e0f/codex-rs/core/src/plugins/mentions.rs)).
  - #13510 once made a mentioned plugin's enabled apps callable "for this
    turn without persisting those connectors as sticky user selections".
    That path no longer appears on main.
- **Claude Code tried toggling and removed it.** 2.0.10 added "Enable/disable
  MCP servers by @mentioning". 2.1.6 removed it: "use `/mcp enable <name>`
  instead" ([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
  - Today `@server:protocol://path` mentions an MCP *resource*, which is
    fetched and attached; it adds no tools
    ([MCP](https://code.claude.com/docs/en/mcp)).
  - There is no tool-level mention.
  - `@agent-<name>` forces a subagent
    ([subagents](https://code.claude.com/docs/en/sub-agents)).
- **Cursor has no MCP mention:** "Ask for a specific tool by name or
  describe what you need" ([MCP](https://cursor.com/docs/context/mcp)).

So the pattern that exists is Codex's: a generic note naming the server and
its tools, scoped to that request. Nobody turns a switched-off server on
through a mention. Claude Code's toggle flipped the stored setting, and it
was withdrawn.

**How Luke hands an agent its servers today:**
- **Attached per turn.** An agent's servers are attached as the turn
  starts (`packages/service/src/agents/agent-runtime/connections.ts`), one MCP
  connection per provider the turn is handed (`servers.ts`).
- **Tools are found by search, not loaded up front.** eve offers them
  through its own two tools: `connection_search` lists a connection's tools,
  and `connection_execute` runs one (`connection-tools.ts`). So the model
  meets a server's tools only by searching for them.
- **Switchable per agent.** The composer's MCP popover writes the agent's
  `disabled_servers`, which is read when the next turn starts. A turn that
  is already running keeps what it was handed. A worker follows its parent's
  switches, and the planning agents get every server the account offers.
- **Tool lists exist.** The popover already lists each server's tools
  with their annotations: `INTEGRATIONS_TOOLS` reads
  `integrationToolsPath(provider)`, and `server-tools-model.ts` draws them.

**What a mention changes, in each case:**

| The server is… | Today, without a mention | With a mention |
|---|---|---|
| On for this agent | Its tools sit behind `connection_search`; the model may never look. | The turn carries a short note naming the server and its tools, so the model uses them without a search first. |
| Off for this agent | Not handed this turn. | Handed for **this turn only**, plus the note (decided, 12; no product does this, see below). The switch in the popover is unchanged, and the next turn without a mention goes back to off. |
| Not connected by the account | Not offered. | Not offered in the list. The row says "Connect Linear" and opens Settings. A typed or pasted mention stays words. |

**The proposal: one generic rule for every server, no per-integration
code.**

- **The chip:** the server's mark and name (`Linear`), or the server's name
  and the tool (`Linear · list_issues`). It is picked from a "Servers" group
  in the `@` list, built from the account's connected servers and the
  popover's tool lists. Its hover card is the popover's own row for that
  server or tool: its tools and badges, and whether it is on for this agent.
- **The server side:**
  - `mentionedContext` adds one note to the mentioned part: "The developer
    pointed you at the Linear server for this message. Its tools are
    `linear__list_issues`, `linear__get_issue`, … Use them through
    `connection_search` and `connection_execute`."
  - A tool mention names that one tool and says to prefer it.
  - The tool names come from the same read the popover uses.
- **Turning a server on for the turn (decided, beyond Codex):**
  - Codex ignores a mention of something disabled, and Claude Code
    withdrew toggle-by-mention.
  - What Luke would do differs from the withdrawn toggle: it never changes
    the stored switch. The server is handed to the one turn whose message
    named it, which is the per-turn scope #13510 first had for apps.
  - The plainer alternative is Codex's exactly. A mention of an off server
    adds nothing, and its chip's card offers "Turn on for this agent",
    which is the popover's own switch.
  - The details:
  - The server standing read (`servers.ts`) takes the turn's mentioned
    providers into account: the providers on for the agent, plus the ones
    mentioned in the message that opens the turn, if the account has
    connected them.
  - The override lasts for that turn. It is never written to
    `disabled_servers`, so the popover reads as before.
  - The read still fails closed: a mention never brings back a server whose
    standing could not be read.
- **A mention in a message that steers a running turn:** that turn keeps
  the servers it was handed. The server joins at the turn's next step only if
  eve's dynamic connection is resolved again. eve tells the model when a
  connection comes or goes, but Luke resolves connections only at
  `turn.started`. In v1, a steering mention of a switched-off server applies
  from the next turn, and the chip's card says so.
- **In the plan:** not offered. Which servers an agent gets is chosen per
  agent, and the plan doesn't pick them.

**The same rule for an integration object.** A Linear issue is something
from the Linear server, so the generic rule covers it with no special case:
- a mention of anything from a connected server brings that server in for
  the turn;
- the note names the object's server ("LUKE-142 is a Linear issue; read it
  through the `linear` connection");
- the stored text stays title and link, as decided.

This keeps the two consistent. It reads Dean's earlier "no special
handling" as "no per-integration code", which is what this is. Without it,
a mentioned issue on a switched-off server can't be read, while a mention of
the server can be. Dean decided it (decision 13).

**The stored text** is a mention like any other, through `mention-link`.
It keeps the internal `luke://mcp/…` form, since a server has no page on
the web ("The link format (settled)"):
- `{kind: mcpServer, provider}` — e.g.
  `[@Linear](luke://mcp/linear)`;
- `{kind: mcpTool, provider, tool}` — e.g.
  `[@Linear · list_issues](luke://mcp/linear/list_issues)`.

**Size:** about +400 lines and 1.5 agent-days.
- Desktop, about +150: the Servers group in the picker, the chip and its
  card from the popover's data, and the "Connect" row.
- Server, about +200: the per-turn override in `servers.ts`, the note in
  `mentionedContext`, and the prompt line.
- Tests:
  - on `getTestDB()`, an off server mentioned is handed for that turn and
    not the next;
  - a server the account hasn't connected is never handed;
  - a failed standing read hands nothing;
  - a tool mention names its tool.

It slots in after PR 5 as **PR 6** (needs 2 and 5). The integration-object
search moves to PR 7, which uses the same per-turn rule.

**As built (#2643, #2653).** Two details settled while building:
- **The note names the connection, not every tool.** Listing a server's
  tools at send time would mean an MCP read with the account's token on
  every message. The note instead tells the agent to find them with
  `connection_search` on that connection, which hands it the same list. A
  tool mention names its tool exactly.
- **Where "this turn only" is kept.** eve resolves a turn's connections at
  `turn.started` without the turn's message, so the servers a message
  mentioned stand on the agent's row (`coding_agent.mentioned_servers`).
  A steer writes them under the conversation's lock as eve hears the
  message, and puts them back if eve refused it. The next turn to start
  takes them, reading and clearing them under the row's lock. A worker
  takes none.

### 4.7 The voice and the planning brain

- **Voice:** not in v1. The brain resolves spoken references with its own
  tools.
- **Luke's notes in the plan:** because the plan now holds mention links,
  the notetaker must keep a `[@…](…)` link intact when it rewrites a
  section. That is one prompt line and one eval (§5.4).

### 4.8 A pasted link becomes a chip (decision 14)

Dean dropped the per-integration search ("Let's skip the per-integration
search"). What stands in its place is generic:
- **What counts.** An http(s) address pasted whole whose host is one of an
  integration's: `linear.app`, `github.com`, `notion.so`, `sentry.io` and
  any host under one of them, and so on. A small host table in
  `integration-wire.ts` is the only per-integration data. Any other address
  pastes as words, as does one pasted inside code.
- **The chip.** The integration's mark and the address's readable form: the
  last steps of its path, a kind's word kept with the step after it
  (`LUKE-142/fix-the-thing`, `relay/pull/123`). There is no title, since
  nothing here asks the provider for one. A press opens the page in the
  browser, and the card says the address.
- **The stored text.** `[@LUKE-142/fix-the-thing](https://linear.app/acme/issue/LUKE-142/fix-the-thing)`:
  title and link, as decision 3 has it.
- **The agent.** Decision 13's rule: the integration's server is handed to
  the turn that takes the message on, even if switched off, and the note
  says "The developer pointed you at <address>, a page of the Linear MCP
  server (connection `linear`)… read it through that connection's tools
  rather than the web."
- **Both places.** The message box and the plan editor take it the same
  way, and Luke's correction guard counts these links like any mention.

## 5. Mentions in the plan document

### 5.1 What it is

The developer types `@` while editing the plan and picks a file, a section
of this plan, or an integration object. The editor writes
`[@label](target)` into the markdown, and both the editor and the read view
draw it as the same chip the composer draws. In the plan, a mention is
mostly a cross-reference:
- "the store change in @session-store.ts";
- "see @Rollout";
- "fixes @LUKE-142".

Every coding agent started on the plan then receives those links in its
brief.

### 5.2 The editor (`apps/desktop/src/renderer/plan-editor/`)

The plan editor is already TipTap, built in its own bundle
(`plan-editor.js`) behind a value-free contract (`contract.ts`). It uses
StarterKit, `@tiptap/markdown`, task lists, tables and images, and keeps
each untouched block's exact source (`document-source.ts`).

- **A `mention` node:** an inline atom with attributes `{label, target}`.
  It is parsed from a markdown link whose label starts with `@`, and
  written back as `[@label](target)`. Everything else stays StarterKit's
  link mark.
  - The parse hooks into the same `marked` tokens `@tiptap/markdown` reads.
  - An untouched block keeps its source byte for byte, as today. Only a
    block with a new or removed mention is re-printed.
  - Link targets and labels are escaped (`]`, `)`, spaces) through
    `mention-link`'s Schema.
- **The `@` trigger:** a small ProseMirror plugin, about 120 lines, or
  `@tiptap/suggestion` 3.31.4 as a new pinned dependency. It reports the
  query and the caret's coordinates and takes ↑↓↵⇥Esc while the list is
  open.
- **The contract grows two callbacks:**
  - `onMention({query, rect} | undefined)`, so the panel draws the shared
    React `MentionPicker` at the caret, and a `choose(mention)` handle back;
  - `drawChip(element, mention)`, so the node's view is drawn by the
    panel's React `MentionChip`. That gives the same glyphs, hover cards
    and press as the composer, and the bundle stays free of React, as the
    contract requires.
- **Luke writing while the developer edits:** `take(sent, merged)` lays
  Luke's merged blocks in. A mention in a block Luke changed arrives as
  markdown and parses into the node like any other.

### 5.3 The read view (`planning/plan-body.tsx` → `markdown-message.tsx`)

- `MarkdownMessage` draws links as non-interactive spans and drops every
  destination but `http(s)` (`safeUrl`, `markdown-message.tsx:222`).
  - It will let a `luke://` target through.
  - It will draw any link whose label starts with `@` as a `MentionChip`.
  - It will leave every other link as it is drawn today.
- The chip is the one control in the plan's words. It opens its subject as
  the composer's chip does, which is a deliberate exception to "a message's
  words must not become an action". It is limited to mention links, whose
  targets are the plan's own or an integration's own page, opened through
  the same doors File tabs and the PR mark already use.
- `drawEdit`, Luke's live writing animation, must draw a chip inside an
  edit in progress. It works on the rendered tree, so a chip arrives whole
  once its link's closing `)` is written.

### 5.4 Luke, the notetaker

- **The prompt:** "Keep a `[@…](…)` link exactly as written when you
  rewrite text around it."
- **An eval** in `test:agent`, the offline brain eval: a section holding
  two mentions is rewritten, and both survive.
- **Not in v1:** Luke writing new mentions of its own. It could, from what
  it reads, but that is later.

### 5.5 Coding agents

An agent's brief is `planMarkdown(plan)`, links included, so the plan's
mentions reach it with no change. The prompt paragraph (§4.4) covers how to
read them.

### 5.6 Section links: no deep link needed, one small PR first

Dean asked whether plan sections need deep links before they can be
mentioned. They don't need an OS-level `luke://` URL scheme. A mention never
leaves the app, and `WEB_OPEN` refuses `luke://` anyway
(`apps/desktop/src/main/ipc/planning-acts.ts:350`). What they do need is
the target format and an in-app opener, and that is worth landing as its own
first PR.

- **The target (a placeholder until Part 1; only `mention-link` knows
  it):** `luke://plan/<planId>#<heading>`, where the heading is
  the heading's own text, percent-encoded. It is not a slug, so nothing is
  lost in translation. It names the first section under that heading, and
  the plan's own target is `luke://plan/<planId>`. This is how the app
  already tells sections apart. `plan-reveal.ts` knows a unit "by its
  heading, never by position", and the history model
  (`plan-history-model.ts`) compares sections by heading.
- **What exists today:**
  - There is no scroll-to-heading in the plan's read view.
  - There is no section id in the markdown.
  - The editor can open with the caret at a section's end, by index
    (`PlanEditorPlacement {section}`, `plan-editor/contract.ts`).
  - Version history draws one section alone, by index
    (`version-view.tsx`).
- **The opener:** given a plan and a heading, open the plan's tab and
  scroll its own scroller to the first section with that heading. The
  renderer's rule is no `scrollIntoView`, as `code-pane.tsx`'s
  `centreWithin` does. A plan section chip's press calls it, from the
  composer, a sent bubble, or the plan itself.
- **Renamed or deleted headings:**
  - The heading no longer matches. The chip draws its label as sent, struck
    through, and its card says "No longer in the plan". A press opens the
    plan at the top.
  - An agent that was sent the mention is unaffected, since it got the
    section's snapshot when the message was sent.
  - A cross-reference inside the plan itself goes stale. The cheap fix is
    for the plan editor to rewrite this plan's own `#Old heading` targets
    when the developer renames that heading. The editor holds the whole
    document, so the rewrite is one transaction.
  - A rename by Luke's notetaker isn't repaired in v1. It shows the gone
    state.
- **Stable ids were considered and refused for now.** A section id would
  have to live in the markdown, for example `## Rollout {#rollout}`.
  - That touches every writer of the plan: Luke, the developer, the
    renderer, and every agent brief.
  - `@tiptap/markdown` doesn't read heading attributes.
  - Plans edited by both people and Luke are mostly appended to, not
    renamed.
  - Heading text plus the gone state is the least complex answer.
- **"Copy link to section":** a section's heading hangs a ⋯ item that
  copies `[@Rollout](luke://plan/<planId>#Rollout)`. Pasted into the
  composer or the plan, it becomes the section's chip. The same link is what
  the `@` list writes.

## 6. Server side, by kind

| Kind | Resolved by | Reads | Excerpt cap |
|---|---|---|---|
| File, folder | `mention-link` decode plus path normalization | Nothing; the agent uses `read_file`/`glob` | none (reference) |
| Plan, section | `readPlan(userId, planId)` as `steer.ts` already does; `planSections` picks the heading | `planMarkdown(plan)` | 12,000 / 4,000 |
| Integration object | Its integration, read from the link's host; handed to the turn by the same per-turn rule as a server mention | Nothing at send; the note names the integration | — |
| Next: PR | Agent summaries' `pullRequest` | Number, title, branch | header only |
| Next: Inbox item, page | Through the plan | Text | 4,000 |
| Picker only | `/api/plans/{id}/mention-search` over your own connections | Hits' title, URL, kind | — |

`mentionedContext(text, sender, agent)` sits beside `eveContent`. It decodes
the mentions, resolves the plan's kinds, cuts the excerpts to the budget, and
answers the extra text part, or nothing.

## 7. The composer moves to TipTap (Dean, #3)

Dean chose the rich editor for the message box: "I am interested in
migrating the message box to the richer editor actually." The composer
and the plan then share one editor, one `mention` node, one picker and one
chip.

I measured the composer code that depends on the textarea today. It is about
2,000 lines: `agent-composer.tsx` 435, `skill-picker.tsx` 507,
`skill-mention.ts` 184, `use-dictation.ts` 324, `dictation-strip.tsx` 191,
`use-agent-composer.ts` 214, and `prompt-input.tsx` 209. Only part of each
touches the field. "Agent-days" means one coding workspace, including review
and babysitting.

### 7.1 The port, piece by piece

| Piece | What changes | Lines | Risk |
|---|---|---|---|
| Editor and the draft | Mount a minimal TipTap (paragraph, text, hard break, history, placeholder) in the composer. Turn the doc into the draft string and back (text, `/name`, links). Keep it controlled: an outside change to the draft (send clears it, Retry restores it, dictation inserts) replaces the doc without losing the caret. | +250 | **High.** A controlled contenteditable is the classic source of lost carets and double inserts. |
| Enter to send | Enter sends, Shift+Enter breaks a line, and both respect IME composition (`isComposing`). This leaves `PromptInputTextarea`. `PromptInput`'s submit reads the field by name and must take the value instead. | +50 | Medium. Japanese and Chinese input must be checked by hand on a Mac. |
| 16,000-character bound | Native `maxLength` becomes a transaction filter that also refuses a paste or pick past the bound. | +30 | Low |
| Image paste, file drop | ProseMirror takes paste and drop first, so `handlePaste` and `handleDrop` hand images and files to the existing `attach`, and text pastes as text. | +45 | Medium. Dropping on the card's edge versus the field must still work. |
| Dictation | `use-dictation.ts` reads `selectionEnd`, sets the caret with `setSelectionRange`, sets the box read-only while recording, and hears its keys on the textarea. These become: map the editor's selection to a string offset (atoms count as their text), insert there, `setEditable(false)`, and keys through `handleKeyDown`. | ~80 changed | **High.** Offsets across atoms are fiddly, and dictation has no automated Mac test. |
| The `/` skill picker | The overlay and its mirror-measuring (`caretPoint`, `MIRRORED`, `chipped`, `chipAt`, the pointer and scroll plumbing) are deleted. A `skill` atom node and a trigger plugin replace them. The list (`SkillMenu`, `MenuNote`) is kept. Pressing a chip goes through the node view. | +250 / −350 | Medium |
| Focus and caret | Focus on mount unless typing elsewhere (`typingElsewhere` already accepts contenteditable). Escape blurs. Disabled and read-only map to `editable`. Auto-grow to 8 lines, the placeholder, and ARIA (`role="textbox"`, `aria-autocomplete`, `aria-activedescendant` on a contenteditable). | +40 | Low–medium |
| Session replay | AGENTS.md: "a new way of drawing words is what would change" what replay sends. A contenteditable is one (§7.2). | +30 | Medium (privacy) |
| Loading TipTap | From the plan editor's existing lazy bundle, fetched as the panel starts, with an inert box until it lands (§7.2). | +60 | Low |
| Tests | `draft-agent-tab.test.ts` (10 tests) and `desktop-inbox.test.ts` type into a `textarea` under jsdom, whose contenteditable support is thin. They move to driving the editor through its handle. New tests cover the round trip, Enter, the bound, paste, dictation insert, and one Backspace removing a chip. | +400 / −80 | Medium. jsdom harness work. |
| **Total** | | **≈ +1,000 / −450** | **2–3 agent-days**, one PR, plus a hand-run Mac pass (IME, dictation, VoiceOver) that CI can't do |

### 7.2 Mitigations for the port's risks

- **Caret and draft sync.**
  - The editor owns the document. `composer.draft` stays a string, but it
    is derived: every transaction serializes the doc and calls `setDraft`.
    The prop is never written back into the editor on render.
  - The outside changes the box knows of become explicit commands on the
    editor's handle:
    - `clear()` after a send is taken;
    - `replace(text)` for Retry restoring a message that didn't go, with
      the caret at its end;
    - `insertAtCaret(text)` for dictation.
  - A guard compares an incoming draft with the last string the editor
    emitted, so an echo is never applied twice.
  - Tests:
    - typing reaches the draft;
    - each command lands once, with the caret where it says;
    - a re-render with the same draft changes nothing.
- **IME and Enter.**
  - The keymap's Enter returns early while composing: `event.isComposing`,
    ProseMirror's `view.composing`, or the 229 key code. So the Enter that
    commits a Japanese or Chinese word never sends.
  - Shift+Enter is a hard break. The submit button's disabled state is
    still what refuses an empty or held send.
  - Tests: a composing Enter doesn't send, and a plain Enter does.
  - Japanese, Chinese and Korean input are checked by hand on a Mac, since
    no CI drives an IME.
- **Dictation offsets: no offsets at all.**
  - When the microphone opens, dictation records the caret as an editor
    position, not a string offset.
  - While recording, the box is `setEditable(false)`, the read-only it
    already asks for. Anything that still changes the doc meanwhile is
    mapped through each transaction's mapping.
  - The heard words are inserted at that mapped position. There is no
    string-offset arithmetic across atoms to get wrong.
  - Escape and Enter during dictation still go to `onFieldKey` first,
    through the editor's `handleKeyDown`.
  - Tests: words land at the caret where recording began, between two
    chips, and at the end.
- **The bundle: lazy, from the existing plan editor bundle, fetched at
  panel start. No textarea fallback.** Of the options sized above, this is
  the choice, for three reasons:
  - **The voice window loads the same `renderer.js` as the panels**
    (`renderer/CLAUDE.md`) and never needs an editor. Putting TipTap's core
    in the main bundle (+60–90 KB gzipped on 758 KB) would make every voice
    window parse it.
  - **TipTap already ships once, in `plan-editor.js`.** A main-bundle copy
    would be a second copy beside it, unless the plan editor were rebuilt
    over the main bundle's.
  - **A textarea fallback means two input paths** to keep equal, plus a
    hand-over mid-typing to get right and test.

  How it works:
  - The bundle becomes "the editor bundle". It gets a second mount,
    `mountComposer(host, props)`, beside `mount`, behind the same value-free
    contract.
  - The panel starts loading it after its first paint (`bundleAtom`, as the
    plan does on hover today). It is a local file, so it has landed long
    before an agent tab is opened.
  - In the rare frame before it lands, the composer draws its card with the
    placeholder, inert and not focusable, and focuses the editor as it
    mounts.
  - A bundle that fails to load says so in the composer's note, with
    Reload, as the plan editor's note does today
    (`plan-document-editor.tsx:486`).
  - `plan-editor.js`'s budget grows by the composer's extensions. That is a
    deliberate move, made in the port PR, and `renderer.js`'s budget is
    unchanged.
- **The session-replay masking check.**
  - Today's config masks every text node (`maskTextSelector: "*"`) and
    blanks out the word attributes (`session-replay.ts:240`). A
    contenteditable's text nodes are text nodes, so they stay masked, and
    the agent tab already carries `ph-no-capture` as the second line.
  - The new risk is attributes. A chip must not carry its target (a path,
    a URL, a heading) in a `data-*` attribute, since only `title`,
    `aria-label`, `alt`, `placeholder`, `src` and `href` are blanked. So the
    target lives in the ProseMirror node's attributes and never in the DOM.
    The chip's DOM carries only its kind.
  - Tests:
    - the composer's and the plan's rendered editor DOM hold no
      attribute value containing the target;
    - `session-replay.test.ts` keeps passing.
  - `PRIVACY.md` gets one line naming the composer's editor.
- **The jsdom test migration.**
  - jsdom has ProseMirror's DOM but no real `beforeinput`, so typing by
    keyboard events doesn't edit a contenteditable there.
  - The composer tests drive the editor through the handle the composer
    itself uses: its mount answers the handle, and the tests type with
    `insertText` commands on it. That is the composer's own public seam,
    not a private export.
  - A shared helper in `apps/desktop/src/renderer/planning/testing/`,
    `typeInComposer(container, text)`, finds the mounted editor and
    dispatches the text. The 10 `draft-agent-tab.test.ts` tests and the
    `desktop-inbox.test.ts` composer test move onto it.
  - What jsdom can't show (real typing, IME, VoiceOver) goes on the Mac
    pass.

### 7.3 The `/` skill picker moves onto the same editor

- **One trigger plugin, two characters.** It is a small ProseMirror plugin
  in the editor bundle, parameterized by its character. It fires when `/` or
  `@` starts a word outside code (`startsWord` / `insideCode`, moved from
  `skill-mention.ts` into `mention-link` so both sides share them). It
  reports the query and the caret's rectangle to the panel and takes
  ↑↓↵⇥Esc while a list is open.
- **The lists stay the panel's React:**
  - `/` draws today's `SkillMenu`, `MenuNote` included: "Reading
    skills…", no skills, read failures, and the Settings door.
  - `@` draws the shared `MentionPicker`.
  - Both stand at the rectangle the plugin reports. This replaces
    `caretPoint`'s mirror measuring.
- **A `skill` atom node** with `{name}`.
  - It serializes as `/name`, so the stored text, the agent's
    `load_skill` instruction, and the sent bubble's `SentWords` parsing all
    stay as they are.
  - Its node view draws today's `.skill-chip` through the panel's
    `drawChip` callback, and a press opens the `SKILL.md`.
  - One Backspace removes it, which ProseMirror does for an atom.
- **A restored draft** (Retry) is parsed back into nodes once the skills
  are read: a `/name` that names a known skill becomes the node, and any
  other `/word` stays words, as today.
- **Deleted with the overlay:** `skill-picker.tsx`'s `caretPoint`,
  `MIRRORED`, `chipped`, `chipAt`, the pointer and scroll plumbing, and
  `withoutTokenBefore`, which the atom makes unnecessary.
- **Later:** the `@` list gains a Skills group whose pick writes the same
  `skill` node (the catalog's recommendation).

### 7.4 The route not taken

Keeping the textarea and inserting plain `@path` text (about +700 lines,
1–1.5 agent-days, no regression risk) was the alternative. The show keeps it
beside the chosen route, marked as not chosen.

## 8. PR order

Sizes are lines added, then lines deleted where some are, and agent-days.
"Needs" means the PR waits for those PRs to be merged.

| # | PR | Needs | Size |
|---|---|---|---|
| 0 | **`feat(desktop): a plan section has a link: copy it from its heading, and opening one scrolls the plan to it`.** The `mention-link` module: a typed `Mention` with `encodeMention`, `decodeMention` and `mentionsIn`, its stored form pending worker 273's Part 1. Also the in-app opener, "Copy link to section", and the gone state (§5.6). | — | +350, 1 day |
| 1 | **`refactor(desktop): the agent composer's field is a TipTap editor, with skills as chips in it`.** No visible change. The editor bundle's `mountComposer`, the draft commands, IME Enter, the bound, paste and drop, dictation at a mapped position, the `skill` node and trigger plugin, the overlay deleted, the replay attribute check, and the jsdom helper (§7). | — | +1,000 / −450, 2–3 days |
| 2 | **`feat(hosted,web): a coding agent's message can mention a file, folder, or plan section, and the agent is handed what it names`.** `mention-link` grows file and folder targets and `mentionsIn`; `mentionedContext` with the section snapshot and budget; its read-back; the prompt paragraph (§4.3–4.4, §6). | 0 | +500, 1–1.5 days |
| 3 | **`feat(desktop): @ in the plan editor mentions files, folders, and sections as chips`.** The `mention` node and its markdown, `@` on the trigger plugin, the shared `MentionPicker` and `MentionChip`, the contract's callbacks, and the in-plan rename rewrite (§5.2, §5.6). | 0, 1 | +600, 2 days |
| 4 | **`feat(desktop,web): the plan's read view draws mentions as chips, and Luke keeps them when it rewrites a section`.** `MarkdownMessage` lets `luke://` through and draws `[@…]` links as chips, inside `drawEdit` too. The notetaker's prompt line and its `test:agent` eval (§5.3–5.4). | 3 | +300, 1 day |
| 5 | **`feat(desktop): @ in the agent composer mentions files, folders, and sections, and a sent message draws them as chips`.** The composer takes the `mention` node and picker from 3; `SentWords` reads the links. | 1, 2, 3 | +350, 1–1.5 days |
| 6 | **`feat(desktop,web): @ mentions an MCP server or one of its tools: the turn gets a note naming them, and a switched-off server is handed for that turn`.** The Servers group in the picker from the popover's tool lists, the note in `mentionedContext`, and the per-turn override in `servers.ts` (§4.6). | 2, 5 | +400, 1.5 days |

**Stacks.** Two chains run in parallel from the start, and they join at
PR 3:
- **Chain 1:** PR 0, then PR 2.
- **Chain 2:** PR 1 (the port), started at once.

Then PR 3, which needs 0 and 1, then 4 and 5. v1 is about +3,100 / −450
lines, about 6 agent-days with the two chains in parallel, or 8–10
one after another. PR 1 is checked by hand on a Mac for IME, dictation and
VoiceOver, since CI can't see the Mac.

**After v1** (catalog status "Next"):
- **7:** ~~the `mention-search` endpoint over your own connections~~.
  Dropped by Dean (decision 14) in favor of pasting a link.
- **8:** a Skills group in the `@` list.
- **9:** line ranges, including ⌥K in a File tab.
- **10:** pull requests, Inbox items and pages.
- **11:** pasting an integration's page gives its chip (decision 14, §4.8).

### What has shipped

| # | PR | State |
|---|---|---|
| docs | This proposal and its show | merged, #2568 |
| 0 | Section links, "Copy link to section", the gone state | merged, #2577 |
| 1 | The composer on TipTap (worker 275) | merged, #2578 |
| 2 | A coding agent's message mentions files, folders, and sections | merged, #2586 |
| 4 | The plan draws mentions as chips; Luke keeps them | merged, #2593 |
| 3 | `@` in the plan editor; a heading rename renames its mentions | merged, #2603 |
| 5 | `@` in the agent's message box; a sent message's chips | merged, #2624 |
| 6a | MCP server and tool mentions on the server: the note, and the turn-only hand-over | merged, #2643 |
| 6b | The MCP servers group in the `@` list | merged, #2653 |
| 8 | The Skills group in the `@` list | merged, #2664 |
| 11 | A pasted page of an integration's becomes a chip | merged, #2668 |
| links | The settled link format, tryluke.dev and GitHub addresses (worker 273) | merged, #2683 |
| 10 | The task's pages and other agents in the `@` list, by their Luke links | #3031 |

## 9. Risks

- **The composer port (PR 1).** It is the riskiest step. It lands with no
  visible change, so a regression reads as a regression. The mitigations
  are in §7.2, and the Mac pass covers what jsdom can't.
- **Markdown exactness in the plan.** A mention must never cause a re-print
  of a block nobody touched (`document-source.ts`'s guarantee). PR 3's
  tests hold that.
- **Luke dropping links.** Luke may rewrite a section and drop its links.
  PR 4's prompt line and eval cover this; a regression shows as a vanished
  chip, never as broken text.
- **Heading renames.** These leave section links in messages and in Luke's
  rewrites in the gone state (§5.6). The developer's own renames in the
  editor rewrite the plan's own references.
- **The model skipping a file it was pointed at.** The prompt says read
  first. If evals show skipping, we tighten the prompt. Pasting the first
  4,000 characters would mean going back to Dean, who chose references.

## 10. Decided

Every question this proposal raised was answered on 2026-10-14 (the
decisions at the top), the link format included.
