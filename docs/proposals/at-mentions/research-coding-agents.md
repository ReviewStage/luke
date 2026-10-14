# @-mentions (context references) in AI coding-agent composers

Research for a product proposal, read from current docs on 2026-10-14. Every
claim carries a URL. Where docs say nothing it says **not documented**. Where
docs were silent and open source exists (Zed, Codex CLI), the claim cites
source at a pinned commit and is marked "(source)". Old documentation read from
Wayback or mirrors is marked **[legacy]**.

Doc moves worth knowing before following any link:

- Cursor's `docs.cursor.com/context/@-symbols/*` pages now redirect to
  `cursor.com/docs`, and `cursor.com/docs/context/mentions` redirects to
  `/docs/agent/prompting`.
- Codex's `developers.openai.com/codex/...` returns 308 redirects to
  `learn.chatgpt.com/docs/...`. The Codex app now lives inside the ChatGPT
  desktop app.
- `docs.windsurf.com` returns 307 redirects to `docs.devin.ai/desktop/...`.
  Windsurf is now "Devin Desktop", and Cascade is one of its two local agents.
- VS Code's Copilot docs moved to `/docs/agents/...` and `/docs/chat/...`.
  `chat/chat-tools` is a 404; its replacement is `/docs/agents/run/tools`.

---

## 1. Cursor

The current docs say little about mentions: the `@` trigger, a handful of
kinds, and one-line guidance. Most detail comes from release notes and old docs.

**1. Trigger and entry points**
- `@` in the chat input: "Type `@` in the chat input to attach specific context
  to your prompt. Start typing after `@` and Cursor shows matching
  suggestions." https://cursor.com/docs/agent/prompting
- You can use several: "Type `@` multiple times to attach several files,
  folders, or other context items." https://cursor.com/help/customization/context
- Shortcuts (https://cursor.com/docs/reference/keyboard-shortcuts):
  - `Cmd+Shift+L` is "Add selection to Chat"; `Cmd+L` is "Add selection to new chat".
  - `Cmd+V` with code on the clipboard is "Add clipboard as context";
    `Cmd+Shift+V` is "Add copied code as text context".
- Images can be dragged in or pasted. https://cursor.com/docs/agent/prompting
- The Agents Window (3.23, Oct 1 2026) lets you "drop, paste, or attach a file or
  folder from your computer into the prompt" of a remote agent. It "copies it to
  that machine and mentions the copy."
  https://cursor.com/docs/release-notes/agents-window#oct-1-2026
- Cloud agents have a "+ menu" for files (3.21).
  https://cursor.com/docs/release-notes/agents-window#sep-17-2026
- `/` is a separate menu, for skills. https://cursor.com/docs/agent/prompting
- The CLI also uses `@`: "Select files and folders to include in context with
  @." https://cursor.com/docs/cli/using
- **[legacy]** You could "drag files from the sidebar directly into Agent."
  https://web.archive.org/web/20250716115619/https://docs.cursor.com/context/@-symbols/@-files-and-folders

**2. Picker UI**
- Typing filters the list ("shows matching suggestions"). Whether matching is
  fuzzy, and how recents or open files are ordered, is **not documented**.
  https://cursor.com/docs/agent/prompting
- Folders drill down: "type `/` after selecting a folder to navigate deeper."
  https://cursor.com/docs/agent/prompting
- The menu has category rows:
  - "the Branch row and past chats appear right away" (Agents Window 3.24).
    https://cursor.com/docs/release-notes/agents-window#oct-9-2026
  - "Past chat transcripts are now surfaced directly in at-mention search
    results" (3.0). https://cursor.com/changelog/3-0
  - Files excluded by `.cursorignore` are no longer suggested (3.19).
    https://cursor.com/docs/release-notes/ide#sep-2-2026
- **[legacy]** The picker was two-level with arrow-key navigation: "navigate
  through the list of suggestions using the up/down arrow keys … hit Enter to
  select … If the suggestion is a category, such as Files, the suggestions will
  be filtered to only show the most relevant items within that category." It
  showed "a preview of the file's path" to tell same-named files apart.
  https://www.aidoczh.com/cursor/context/@-symbols/overview.html (a third-party
  mirror of the old docs)
- Current keyboard handling, including Tab and Esc, is **not documented**.

**3. Chip rendering and editing**
- "Files and directories are now shown inline as pills. We've also improved
  copy/pasting prompts with tagged context" (2.0, Oct 29 2025).
  https://cursor.com/changelog/2-0
- Code pasted from files and the terminal "is now explicitly mentioned in Chat"
  (1.7). https://cursor.com/changelog/1-7
- @-mention text gets truncated in the UI: 2.4 fixed it being cut off on Windows.
  https://cursor.com/changelog/2-4
- Sent messages keep their chips ("Docs chips in older conversations still
  display", 3.21). https://cursor.com/docs/release-notes/ide#sep-17-2026
- "Removing a file's mention from a cloud agent prompt now stops that file from
  being uploaded" (3.20). The mention is the attachment.
  https://cursor.com/docs/release-notes/agents-window#sep-10-2026
- In the CLI, "Large pastes stay collapsed as a pill … while the agent receives
  their full content." https://cursor.com/docs/release-notes
- **[legacy, 0.50]** "If a folder (or file) is too large to be included, you'll
  see a small icon on the context pill." https://cursor.com/changelog/0-50
- The icon, the label format, and whether Backspace or an x deletes a chip are
  **not documented**.

**4. What the model receives**
- For chat @file, whether content is inlined or referenced is **not documented**.
  The docs frame mentions as optional: "If you're not sure which files matter,
  skip it — Agent finds relevant files through its own search."
  https://cursor.com/docs/agent/prompting
- In rules, a file mention is a reference: "Agent reads the file with its tools
  when it needs the content. The file's contents are not inlined into the
  prompt, and this is the same in the editor, the CLI, and Cloud Agents."
  https://cursor.com/docs/rules
- Folders: a staff forum post (Oct 31 2025) says "@ing a folder sends a file
  tree of the folder's contents to the model." Full folder content "has been
  removed in the latest version."
  https://forum.cursor.com/t/cursor-2-0-missing-full-folder-context/140027
- Side chats: "@-mention the side chat in the main thread. Cursor pulls that
  side chat's context into the main conversation."
  https://cursor.com/help/ai-features/side-chats
- Projects (cloud): when you @-mention another agent to a Project coordinator,
  "the coordinator can read that agent's transcript and send it messages."
  https://cursor.com/docs/release-notes/cloud-agents#oct-5-2026
- **[legacy]** "Large files and folders are automatically condensed to fit
  within context limits."
  https://web.archive.org/web/20250716115619/https://docs.cursor.com/context/@-symbols/@-files-and-folders
- **[legacy]** Long files were chunked and reranked "based on relevance to the
  query." https://www.aidoczh.com/cursor/context/@-symbols/@-files.html
- **[legacy]** @Past Chats sent "summarized versions of your previous chats."
  https://web.archive.org/web/2025/https://docs.cursor.com/context/@-symbols/@-summarized-composers

**5. Size limits**
- The local editor documents no file size, token cap, or mention count.
  https://cursor.com/docs/agent/prompting
- Cloud agents (3.21): "any non-image file up to 10 MB".
  https://cursor.com/docs/release-notes/agents-window#sep-17-2026
- Folder drops (3.23): "Up to 20 files are attached per drop."
  https://cursor.com/docs/release-notes/agents-window#oct-1-2026
- cursor.com/agents: "documents and images have a 4 MB per-file limit."
  https://cursor.com/help/ai-features/cloud-agents
- `.cursorignore` blocks "Code accessible via @ mention references."
  https://cursor.com/docs/reference/ignore-file

**Mention kinds now (2026-10).** Source for the first six:
https://cursor.com/docs/agent/prompting
- Files & Folders
- @Terminals
- @Chats
- @Commit ("Diff of Working State")
- @Branch ("Diff with Main")
- @Browser
- @rule-name, for manual rules: https://cursor.com/docs/rules
- @side chat: https://cursor.com/help/ai-features/side-chats
- @agent, in Projects: https://cursor.com/docs/release-notes/cloud-agents#oct-5-2026
- Outside the editor, @Cursor in Slack ("Cloud Agents read the entire thread for
  context"): https://cursor.com/docs/integrations/slack
- Outside the editor, @cursor on GitHub and Linear: https://cursor.com/docs/cloud-agent

**Removed.**
- @Definitions, @Web, @Link, @Recent Changes, @Linter Errors "and others" went
  in 2.0 (Oct 2025), because "Agent can now self-gather context."
  https://cursor.com/changelog/2-0
- @Codebase went around 0.46–0.48, per the forum.
  https://forum.cursor.com/t/has-codebase-been-removed/56484
- @Docs was removed from the menu in 3.21 (Sep 17 2026); it "had already stopped
  adding documentation to agent context."
  https://cursor.com/docs/release-notes/ide#sep-17-2026
- @Git was replaced by @Commit and @Branch. @Code, @Notepads, and @Summarized
  Composers are no longer listed.
  https://www.aidoczh.com/cursor/context/@-symbols/overview.html

---

## 2. Claude Code

### CLI (terminal)

**1. Triggers and entry points**
- `@` is the "File path mention | Trigger file path autocomplete".
  https://code.claude.com/docs/en/interactive-mode
- The same `@` menu lists:
  - MCP resources: "Resources appear alongside files in the autocomplete menu".
    https://code.claude.com/docs/en/mcp#use-mcp-resources
  - Subagents: "Type `@` and pick the subagent from the typeahead".
    https://code.claude.com/docs/en/sub-agents
  - Other live sessions. https://code.claude.com/docs/en/interactive-mode
- Images: paste with `Ctrl+V`, which "Inserts an `[Image #N]` chip at the
  cursor". https://code.claude.com/docs/en/interactive-mode
- Images can also be dragged in, or given as a path.
  https://code.claude.com/docs/en/common-workflows
- When connected to an IDE, the selection and active file are shared
  automatically. https://code.claude.com/docs/en/jetbrains

**2. Picker UI**
- Fuzzy matching uses a "native Rust-based fuzzy finder" (v2.0.34).
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- It is one mixed list, no group headers, with "icons for different suggestion
  types" (v2.1.6). Same changelog.
- Ranking: source files rank above MCP resources with similar names (v2.1.89),
  and a filename match ranks above a folder-only match (v2.1.280). Same changelog.
- Keyboard: "Type `@` to open a path suggestion menu, then press Enter or Tab to
  accept the highlighted path and Enter again to send the message".
  https://code.claude.com/docs/en/common-workflows
- Clicking a folder navigates into it rather than selecting it (v2.1.14).
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- `respectGitignore` (default true) filters the picker. `fileSuggestion` lets you
  plug in your own command; "Claude Code shows at most 15".
  https://code.claude.com/docs/en/settings-reference#filesuggestion
- Recents-first ordering is **not documented**.

**3. Rendering**
- A file mention stays plain `@path` text. Desktop's comparison table calls it
  "Text-based". https://code.claude.com/docs/en/desktop
- The mention is syntax-highlighted in the input (v2.1.235).
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- A subagent pick inserts `@"code-reviewer (agent)"`.
  https://code.claude.com/docs/en/sub-agents
- Image chips `[Image #N]` delete as a unit (v2.1.261).
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Large pastes collapse to `[Pasted text #1 +120 lines]`.
  https://code.claude.com/docs/en/terminal-config#paste-large-content

**4. What the model receives: the content, inlined**
- "Use @ to quickly include files or directories without waiting for Claude to
  read them … This includes the content of the file in the conversation when it
  fits the Read tool's token limit, 25,000 tokens by default. A text file larger
  than 256KB isn't included." https://code.claude.com/docs/en/common-workflows
- "Directory references show file listings, not contents."
  https://code.claude.com/docs/en/common-workflows
- "@ file references add `CLAUDE.md` in the file's directory and parent
  directories to context." https://code.claude.com/docs/en/common-workflows
- MCP resources (`@server:protocol://resource/path`) "are automatically fetched
  and included as attachments when referenced."
  https://code.claude.com/docs/en/mcp#use-mcp-resources
- A subagent mention "controls which subagent Claude invokes, not what prompt it
  receives." https://code.claude.com/docs/en/sub-agents
- To opt out, set `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1`. Claude then "gets the
  mentioned paths with a note to read them using its file tools."
  https://code.claude.com/docs/en/env-vars
- "Large PDFs (>10 pages) now return a lightweight reference when `@` mentioned
  instead of being inlined" (v2.1.30).
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Read deny rules apply to mentions (v2.1.289). Same changelog.

**5. Limits**
- A file over 25k tokens gets "the first page of the file, with a `PARTIAL view`
  notice". https://code.claude.com/docs/en/tools-reference#large-files
- For a file over 256 KB, Claude "is now told the file's size and to read it in
  portions" (v2.1.292).
  https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- MCP resources follow the MCP output limits: a warning at 10k tokens, a cap at
  25k (`MAX_MCP_OUTPUT_TOKENS`). https://code.claude.com/docs/en/mcp
- Mention count: no cap documented. Several per message are fine.
  https://code.claude.com/docs/en/common-workflows

### IDE, desktop, and web
- **VS Code**:
  - `Option+K` / `Alt+K` inserts "an @-mention with the file path and line
    numbers (e.g., `@app.ts#5-10`)".
  - The picker "supports fuzzy matching"; "include a trailing slash for folders".
  - The selection and open file are attached automatically (`attachOpenFile`
    setting); Shift-drag files in; an X removes an attachment.
  - Source: https://code.claude.com/docs/en/vs-code#reference-files-and-folders
- **JetBrains**: `Cmd+Option+K` inserts `@src/auth.ts#L1-99`, and the transcript
  shows `⧉ Selected N lines from <file>`.
  https://code.claude.com/docs/en/jetbrains
- **Desktop (Code tab)**:
  - "type `@` followed by a filename … @mention is not available in cloud or
    WSL sessions".
  - A **+** button attaches images, PDFs, files, skills, and connectors; you can
    also right-click a path and choose "Attach as context".
  - Chip rendering is **not documented**.
  - Source: https://code.claude.com/docs/en/desktop
- **Claude Code on the web**: no `@` behavior is documented on
  https://code.claude.com/docs/en/claude-code-on-the-web, and desktop says
  @mention is not available in cloud sessions.
  - Remote Control of a local session does autocomplete `@` paths, and attached
    files are "passed to Claude as `@` file references".
    https://code.claude.com/docs/en/remote-control
- **CLAUDE.md `@import`**: "a maximum depth of four hops". A file over 4 MiB is
  skipped. https://code.claude.com/docs/en/memory#import-additional-files

---

## 3. GitHub Copilot

### VS Code (Ask / Agent / Plan)

Edit mode was deprecated in 1.110 and removed in 1.126.
https://code.visualstudio.com/updates/v1_110

**1. Triggers and entry points**
- `#` is for context items and tools: "type `#` followed by the context item you
  want to mention … files, folders, code symbols, tools, terminal output, source
  control changes, and more."
  https://code.visualstudio.com/docs/chat/copilot-chat-context
- One `#` menu holds both context items and tools.
  https://code.visualstudio.com/docs/agents/run/tools
- Typed forms:
  - `#file:path`: https://code.visualstudio.com/docs/agent-customization/prompt-files
  - `#folder:`: https://code.visualstudio.com/updates/v1_98
  - `#sym`: https://code.visualstudio.com/updates/v1_96
  - `#chat:`: https://code.visualstudio.com/updates/v1_132
  - `#codebase`, `#fetch`, `#searchResults`, and others
- `@` is for chat participants (`@vscode`, `@terminal`, `@github`).
  https://code.visualstudio.com/docs/agents/reference/ai-features-cheat-sheet
- `@workspace` was dropped from the user docs on 2026-03-09 in favor of
  `#codebase`.
  https://github.com/microsoft/vscode-docs/commit/53692398c25ef7154372ad199f880a4df44ca9a0
  - The FAQ now says "Do I need to use `#codebase`…? No. Agents automatically use
    semantic search when it makes sense."
    https://code.visualstudio.com/docs/agents/reference/workspace-context
- `/` is for commands and prompt files; `!` runs a terminal command directly.
  https://code.visualstudio.com/docs/chat/chat-overview
- The **Add Context** (`+`) button.
  https://code.visualstudio.com/docs/agents/concepts/context
- Drag and drop from Explorer, Search, or editor tabs.
  https://code.visualstudio.com/docs/chat/copilot-chat-context
- You can also drag symbols from Outline (https://code.visualstudio.com/updates/v1_96)
  and Problems (https://code.visualstudio.com/updates/v1_98).
- Paste images and PDFs. https://code.visualstudio.com/updates/v1_128
- A pasted issue or PR URL "remains in the prompt, and VS Code automatically adds
  the item as a context attachment."
  https://code.visualstudio.com/docs/chat/copilot-chat-context
- A pasted symbol becomes `#sym:Name`. https://code.visualstudio.com/updates/v1_112
- Implicit context: the selection and the active file name are always sent.
  - The Ask agent also gets "the contents of the active file".
  - Agent gets "the active file as a suggested attachment that you can add".
  - Source: https://code.visualstudio.com/docs/agents/concepts/context
  - Toggle the suggestion with `Shift+Tab, Enter`.
    https://code.visualstudio.com/updates/v1_101

**2. Picker UI**
- It is two-level: "Select **Add Context** … and select **Files & Folders** or
  **Symbols** from the Quick Pick."
  https://code.visualstudio.com/docs/chat/copilot-chat-context
- Other top-level groups include Issue..., Pull Request..., MCP Resources,
  Source Control, Sessions, and Tools.
  https://code.visualstudio.com/docs/agent-customization/mcp-servers ,
  https://code.visualstudio.com/updates/v1_114
- Inline `#` completion: "completions show for files and symbols and further
  typing enables to filter down". Symbols come "from files you've recently
  worked on". https://code.visualstudio.com/updates/v1_96
- Keyboard: "Use the right arrow key to quickly attach context in the background
  while you keep the context picker open." This is from 2024 and may be stale.
  https://code.visualstudio.com/updates/v1_90
- Fuzzy matching and open-editors-first ordering are **not documented**.

**3. Chip rendering**
- "when you reference context in the prompt text with `#`, they now also appear
  as an attachment pill." https://code.visualstudio.com/updates/v1_100
- In history: "Selecting a file attachment opens the corresponding file and
  range in the editor." https://code.visualstudio.com/updates/v1_92
- Files & Folders shows file-type icons. https://code.visualstudio.com/updates/v1_106
- "press **Delete** to remove attached context items."
  https://code.visualstudio.com/updates/v1_106
- To edit a sent request, click it; "You can modify attachments … and resend".
  https://code.visualstudio.com/updates/v1_103
- An x button, Backspace removal, and how a line range shows on the label are
  **not documented**.

**4. What the model receives**
- How a large attached file is handled is **not documented now**.
  - The old note said full contents went in when they fit, else "an outline of
    the file … functions and their descriptions without implementations", else
    nothing.
  - It was deleted on 2026-03-13.
    https://github.com/microsoft/vscode-docs/commit/22ab8cb6eaf4a6911b7068f3394e84ec0ba2cd6c
- "Explicit context guides the agent toward relevant information but still
  counts toward the context window."
  https://code.visualstudio.com/docs/agents/concepts/context
- `#codebase` is semantic search over an index. It "doesn't add your entire
  workspace to every model request".
  https://code.visualstudio.com/docs/agents/concepts/context
  - "For small projects, the entire workspace can be read directly into the
    agent's context."
    https://code.visualstudio.com/docs/agents/reference/workspace-context
- The agent reads more itself through `#read/readFile`, `#search/*`, and the
  other tools. https://code.visualstudio.com/docs/agents/reference/tools-reference
- The Chat Debug view shows the context that was actually sent.
  https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view

**5. Limits**
- A request can enable at most 128 tools.
  https://code.visualstudio.com/docs/agents/run/tools
- The index handles projects of up to 500,000 files.
  https://code.visualstudio.com/docs/agents/reference/workspace-context
- File size, attachment count, and folder file-count caps are **not documented**.

### Copilot on github.com
- **Trigger:** `@` attaches context here, not participants. "Type `@` in the
  chat prompt box to display a list of items you can attach, such as:
  Discussions, Extensions, Files, Issues, Pull requests, Repositories."
  https://docs.github.com/en/copilot/reference/chat-cheat-sheet?tool=webui
- **Button:** "**+ Add repositories, files, and spaces**", then **Repositories**,
  then search. This is two-level.
  https://docs.github.com/en/copilot/tutorials/explore-a-codebase
- **Upload:** drag and drop, or "+ Upload from computer".
  https://docs.github.com/en/copilot/how-tos/copilot-on-github/chat-with-copilot/chat-in-github
- **Implicit page context:** the page you are on (repo, file, selected lines,
  PR, issue) is used as context.
  https://docs.github.com/en/copilot/how-tos/copilot-on-github/chat-with-copilot/get-started-with-chat
- **Editing:** "You cannot edit any attachments" when you edit a question.
  https://docs.github.com/en/copilot/how-tos/copilot-on-github/chat-with-copilot/chat-in-github
- **What the model receives:**
  - A repo is not loaded whole; Copilot "searches the repository and retrieves
    only the most relevant content".
  - A file in a Space has "its full contents … loaded into Copilot's context
    window", always from `main`.
  - Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/copilot-spaces/create-copilot-spaces
- **Assigning the cloud agent:** an issue sends "the issue title, description,
  any comments that currently exist", as a snapshot that "will not be aware of
  … any further comments."
  https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github
- **Limits:** the cloud agent drops images over 3.00 MiB.
  https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent
  Chat attachment size and count are **not documented**.

---

## 4. Windsurf Cascade (now Devin Desktop)

**1. Triggers and entry points**
- `@` in the Cascade input:
  - `@rule-name` for manual rules: https://docs.devin.ai/desktop/cascade/memories
  - `@skill-name`: https://docs.devin.ai/desktop/cascade/skills
  - The terminal: https://docs.devin.ai/desktop/terminal
  - Plan files: https://docs.devin.ai/desktop/cascade/modes
- "Use `@web` to force a web search", "Use `@docs` to query over a list of docs …
  we can read with high quality", or paste a URL.
  https://docs.devin.ai/desktop/cascade/web-search
- **@conversation:** "reference previous conversations… via an @-mention"
  (https://docs.devin.ai/desktop/cascade/cascade). But v3.10.23 (Sep 10, 2026)
  lists "conversation mentions" among the removed legacy entry points.
  https://docs.devin.ai/desktop/changelog
- Files, directories, functions/classes, remote repos, and `@diff` are
  documented on the plugin Chat page. https://docs.devin.ai/desktop/chat/overview
- Other entry points:
  - `Cmd/Ctrl+L` sends the selection: https://docs.devin.ai/desktop/cascade/cascade
  - `Option+Cmd+L` attaches the current file: https://docs.devin.ai/desktop/changelog
  - Drag files from Explorer (v3.10.27): https://docs.devin.ai/desktop/changelog
  - The preview "Send element" button inserts an `@ mention`:
    https://docs.devin.ai/desktop/previews

**2. Picker UI**
- Grouping, levels, and keyboard handling are **not documented**; there is only
  a video. https://docs.devin.ai/desktop/context-awareness/overview
- "Reduced the priority of Git commits in @ mention search."
  https://docs.devin.ai/desktop/changelog
- `@` does not open when followed by whitespace.
  https://docs.devin.ai/desktop/changelog

**3. Chip rendering**
- "`@`-mention pills in Cascade now show type-specific icons" (v3.5.17).
  https://docs.devin.ai/desktop/changelog
- "editing or reverting a prompt preserves file, directory, skill, and terminal
  @-mentions." https://docs.devin.ai/desktop/changelog
- Deletion and truncation are **not documented**.

**4. What the model receives**
- "An @-mention is a deterministic way of bringing in context, and is guaranteed
  to be part of the context." Whether it is inlined or a reference is **not
  documented**. https://docs.devin.ai/desktop/chat/overview
- Conversations: Cascade retrieves "the conversation summaries and checkpoints,
  and specific parts of the conversation that you query for. It typically will
  not retrieve the full conversation."
  https://docs.devin.ai/desktop/cascade/cascade
- Web and docs are fetched, chunked, and skimmed ("skim to the section we want").
  https://docs.devin.ai/desktop/cascade/web-search
- A skill's full SKILL.md loads only when invoked or `@mention`ed.
  https://docs.devin.ai/desktop/cascade/skills
- A manual rule is included "Only when @mentioned".
  https://docs.devin.ai/desktop/cascade/memories
- Mentioning a plan file lets you "continue implementation with a fresh
  context". https://docs.devin.ai/desktop/cascade/modes

**5. Limits**
- Rules: 6,000 characters for global, 12,000 per workspace file.
  https://docs.devin.ai/desktop/cascade/memories
- "up to 40 invocations per prompt" of tools.
  https://docs.devin.ai/desktop/cascade/cascade
- Function and class mentions work only for indexed AST languages.
  https://docs.devin.ai/desktop/chat/overview
- File size and mention count are **not documented**.

---

## 5. Zed agent panel

The docs list the kinds. Behavior comes from source at commit `b25dc093`, where
`Z` = `https://github.com/zed-industries/zed/blob/b25dc09370229cef7e11673d1d60b5e5713465cd`.

**1. Triggers and entry points**
- `@` mentions "files, directories, symbols, previous threads, skills,
  diagnostics, branch diffs, and URLs to fetch."
  https://zed.dev/docs/ai/agent-panel
- Pasted multi-line code becomes an @-mention "with the file context";
  `agent::PasteRaw` pastes plain text. https://zed.dev/docs/ai/agent-panel
- The `+` menu has a "Selection" item, and there is
  `agent::AddSelectionToThread`. https://zed.dev/docs/ai/agent-panel
- Images can be @-mentioned, dragged, or pasted. https://zed.dev/docs/ai/agent-panel
- Rules were replaced by Skills (v1.4.0); migrated rules stay `@`-mentionable.
  https://zed.dev/docs/ai/rules
- Text threads were removed. https://zed.dev/docs/ai/text-threads

**2. Picker UI (source)**
- A bare `@` shows a "recent" group first: up to 4 recent files and 2 recent
  threads. `Z/crates/agent_ui/src/completion_provider.rs#L1276-L1357`
- Category rows follow: Files & Directories, Symbols, Threads, Selection, Skills,
  Fetch, Diagnostics, and Branch Diff. Some appear only when they apply.
  `Z/crates/agent_ui/src/completion_provider.rs#L1359-L1407`
- It is two-level by keyword: `@file`, `@symbol`, `@thread`, `@fetch`, `@skill`,
  `@diagnostics`, and `@diff` each enter a category.
  `Z/crates/agent_ui/src/completion_provider.rs#L242-L250`
- A plain `@foo` fuzzy-searches files and category names together.
  `Z/crates/agent_ui/src/completion_provider.rs#L1199-L1272`

**3. Chip ("crease") rendering (source)**
- The buffer stores `[@name](uri)`, folded into a button.
  `Z/crates/agent_ui/src/mention_set.rs#L1084-L1148`
- The button is outlined, with a muted per-kind icon and the label in the buffer
  font. It pulses while loading. `Z/crates/agent_ui/src/ui/mention_crease.rs#L85-L141`
- Labels are the file name, symbol, thread title, `Branch Diff (base)`, or the
  URL. Colliding labels get parent path parts added.
  `Z/crates/acp_thread/src/mention.rs#L335-L398`
- The tooltip shows the full path and lines; clicking opens the target.
  `Z/crates/acp_thread/src/mention.rs#L400-L434`
- Deleting the folded text drops the mention. `Z/crates/agent_ui/src/mention_set.rs#L104-L111`
- "Any message that you send to the model is editable."
  https://zed.dev/docs/ai/agent-panel

**4. What the model receives: an inlined snapshot read at mention time (source)**
- Content is loaded when the mention is inserted.
  `Z/crates/agent_ui/src/mention_set.rs#L235-L345`
- The text keeps `[@name](uri)` links. After it comes a block: "`<context>` The
  following items were attached by the user. They are up-to-date and don't need
  to be re-read."
- That block holds `<files>`, `<directories>`, `<symbols>`, `<selections>`,
  `<diffs>`, `<threads>`, `<fetched_urls>`, `<diagnostics>`, and `<skills>`.
  Code goes in fenced blocks tagged `ext path:lines`.
  `Z/crates/agent/src/thread.rs#L329-L585`
- A thread is an LLM-generated "detailed summary", cached, not the transcript.
  `Z/crates/agent_ui/src/mention_set.rs#L608-L643`
- A fetch is an HTTP GET at mention time, with HTML converted to markdown.
  `Z/crates/agent_ui/src/mention_set.rs#L1444-L1521`
- A directory is a link only, which the agent reads with tools. All its files are
  inlined only when the profile has no tools.
  `Z/crates/agent_ui/src/mention_set.rs#L1221-L1327`
- External ACP agents (Claude Agent, Codex) get an `EmbeddedResource` (text plus
  uri) if they support `embeddedContext`, else a bare `ResourceLink`.
  `Z/crates/agent_ui/src/message_editor.rs#L2185-L2228`

**5. Limits**
- A file over `AUTO_OUTLINE_SIZE = 16384` bytes is sent as "# File outline for
  {path}" instead of its text, or the "First 1KB" if there is no outline.
  `Z/crates/agent/src/outline.rs#L10-L92`
- Mention count: no cap found.
- Symbol results are capped at 100.
  `Z/crates/agent_ui/src/completion_provider.rs#L2386`

---

## 6. Devin (Cognition)

**1. Triggers and entry points**
- `@` in the session input: "@Repos", "@Files", "@Macros" (Knowledge),
  "@Playbooks", "@Skills", "@Secrets", and "@Sessions" ("Reference a previous
  Devin session for context"). https://docs.devin.ai/get-started/first-run
- `!macro` attaches a playbook or knowledge item.
  https://docs.devin.ai/product-guides/using-playbooks ,
  https://docs.devin.ai/product-guides/knowledge
- `/name` invokes a skill. https://docs.devin.ai/release-notes/overview
- Attachments:
  - The + button opens a file picker.
  - A dropped folder is "attached as a single zip".
  - A paste of 10k+ characters is attached as a file automatically.
  - Source: https://docs.devin.ai/release-notes/overview
- In Slack, "@Devin in any channel"; it reads the thread history as context.
  https://docs.devin.ai/integrations/slack
- In Linear, Jira, and Teams, use `@Devin` in a comment.
  https://docs.devin.ai/integrations/linear ,
  https://docs.devin.ai/integrations/jira

**2. Picker UI**
- One dropdown. https://docs.devin.ai/get-started/first-run
- "fuzzy bag-of-words matching… Repositories are also ranked first."
  https://docs.devin.ai/release-notes/overview
- "Skills are grouped by repository in the dropdown."
  https://docs.devin.ai/release-notes/overview
- Keyboard handling is **not documented**.

**3. Chip rendering**
- A playbook shows as "a blue pill" with an inline editor, then "a grey
  background in the chat" once sent.
  https://docs.devin.ai/product-guides/using-playbooks
- Sent mentions are "styled deeplinks instead of the raw '@Name (ID)' format",
  and session mentions are clickable. https://docs.devin.ai/release-notes/overview
- "File reference chips for same-named files show enough of the path to tell
  them apart, with the full path on hover" (Oct 7, 2026).
  https://docs.devin.ai/release-notes/overview
- A child session carries its parent summary "as a removable chip".
  https://docs.devin.ai/release-notes/overview
- Deleting a chip is **not documented**.

**4. What the model receives**
- Over ACP, Devin "carries @-mentions as structured resource blocks".
  https://docs.devin.ai/release-notes/overview
- For web sessions, inlined versus referenced is **not documented**, and so is
  whether @Sessions sends a summary or the transcript.
- Secrets are never shown to the model as text. They are bound as environment
  variables, or typed into the browser.
  https://docs.devin.ai/product-guides/secrets
- "Devin will read the entire Knowledge contents" of triggered knowledge.
  https://docs.devin.ai/product-guides/knowledge

**5. Limits**
- Attachments up to 75 MB. https://docs.devin.ai/release-notes/overview
- AGENTS.md is read "up to 16 KiB", with a truncation notice after that.
  https://docs.devin.ai/onboard-devin/agents-md
- Mention count is **not documented**.

---

## 7. OpenAI Codex

**CLI**
- **Triggers:** "Type `@` to search for a file in the workspace and add its path
  to the prompt." https://learn.chatgpt.com/docs/developer-commands.md?surface=cli
  - `/mention` just inserts `@` (source).
    https://github.com/openai/codex/blob/76ed3b484d62ccceb9fa512ff4dd139f421814c3/codex-rs/tui/src/chatwidget/slash_dispatch.rs
  - `$` mentions skills. https://learn.chatgpt.com/docs/skills-and-plugins.md
- **Picker (source):** one popup with typed rows (Plugin, Skill, Task, File, Dir)
  and filter tabs ("All Results", "Filesystem Only", "Plugins") cycled with ←/→.
  - The footer reads: "Enter/Tab insert · Esc close · ↑/↓ select · ←/→ filter".
  - 8 visible rows; file search returns 20 fuzzy matches and respects
    `.gitignore`.
  - Source: `codex-rs/tui/src/bottom_pane/mentions_v2/` at the commit above.
- **Rendering (source):** a file becomes **plain path text**, quoted if it has
  spaces. An image path becomes an `[Image #N]` attachment. Tasks, skills, and
  plugins insert as atomic elements; a task is bound to `thread://<id>`.
  `codex-rs/tui/src/bottom_pane/chat_composer.rs`
- **What the model receives:** only the path. The input item types are `text`,
  `image`, `localImage`, `skill`, and `mention` (for `app://`); there is no
  file-content item. https://learn.chatgpt.com/docs/app-server.md
  - The agent reads files with its tools.
  - MCP resources cannot be @-mentioned; they are tools
    (`read_mcp_resource`). `codex-rs/core/src/tools/handlers/mcp_resource/`
- **Limits:** a message is capped at 1 MiB of characters, and at 16 task mentions
  (`MAX_REFERENCED_TASKS`). `codex-rs/protocol/src/user_input.rs`,
  `codex-rs/tui/src/task_mentions.rs`

**IDE extension**
- "automatically includes your open files as context".
  https://learn.chatgpt.com/docs/prompting.md
- The commands "Add selected text range" and "Add the entire file", plus a
  `/ide-context` toggle.
  https://learn.chatgpt.com/docs/developer-commands.md?surface=ide
- The picker, the chip, and the payload are **not documented**.

**Codex app (ChatGPT desktop)**
- "Use `@` to add context and `$` to choose a skill."
  https://learn.chatgpt.com/docs/pets.md
- An Add context menu (with an MCP submenu), "fuzzy file search", and skills "in
  the `@` menu … alongside other mentions".
  https://learn.chatgpt.com/docs/changelog
- The chip and the payload are **not documented**.

**Cloud and web**
- No `@` file mention is documented. https://learn.chatgpt.com/docs/cloud.md
- `@codex` in GitHub and Linear comments triggers a task.
  https://learn.chatgpt.com/docs/third-party/github.md

---

## Comparison

| Product | Trigger | Picker shape | Chip | Model gets | Documented size rule |
| --- | --- | --- | --- | --- | --- |
| Cursor | `@` (+ `/` skills) | Category rows; `/` drills into folders; legacy two-level | Inline pill (2.0+); kept in history; removing it un-attaches | Not documented for chat; rules: reference read by tool; folders: file tree | Cloud: 10 MB per file, 20 files per drop; none local |
| Claude Code CLI | `@` | One mixed fuzzy list with icons; Enter/Tab | Plain `@path` text (highlighted); images are `[Image #N]` chips | **Inlined** file content up to 25k tokens / 256 KB; dir = listing; MCP resource fetched and attached | 25k tokens (`PARTIAL view` after), 256 KB, PDF >10 pages = reference |
| Copilot VS Code | `#` context/tools, `@` participants, `/` commands | Two-level Quick Pick (Files & Folders, Symbols, Issues, MCP…) + inline `#` completion | Attachment pill; Delete removes; click opens file and range | Not documented now (was full, then outline, then dropped); `#codebase` = semantic search; agent reads more with tools | 128 tools; no file cap documented |
| Copilot github.com | `@` (attach), `/` | `@` list by type; + button two-level | Not documented; attachments not editable | Repo = retrieval; Space file = full content | Cloud agent image 3 MiB |
| Windsurf Cascade | `@` (+ `@web`, `@docs`) | Not documented | Pill with type icon (2026) | "guaranteed to be part of the context"; conversations = summaries and checkpoints (removed Sep 2026) | Rules 6k / 12k chars |
| Zed | `@` (+ `@file`, `@thread` keywords) | Recents, then categories; keyword enters a category; fuzzy | Crease button: icon + label, tooltip path, click opens | **Inlined snapshot** in a `<context>` block; thread = LLM summary; dir = link (agent reads) | >16 KB file sent as outline |
| Devin | `@`, `!macro`, `/skill` | One fuzzy dropdown, repos first | Pills (blue playbook), deeplinks in history, disambiguated paths | Not documented (ACP: resource blocks); secrets never as text | 75 MB attachment; paste >10k chars becomes a file |
| Codex CLI | `@`, `$` | One popup, typed rows, ←/→ filter tabs | Plain path text; tasks/skills atomic | **Path only**, agent reads with tools | 1 MiB message, 16 task mentions |

## Patterns that converged

1. **`@` is the universal trigger** for "attach context". Copilot in VS Code is
   the exception: there `#` attaches context and `@` addresses participants.
   Copilot on github.com uses `@` for attaching.
2. **One menu holds many kinds.** Files, folders, symbols, past chats/threads,
   rules/skills, terminal, git diff, and MCP resources share one popup. Some
   products show category rows or filter tabs (Zed, Codex, Copilot), and some
   one ranked mixed list (Claude Code, Devin).
3. **Fuzzy type-ahead with drill-down.** Several products drill into folders
   (Cursor `/`, Claude Code click, VS Code trailing slash). Zed and Codex show
   recent or contextual items before you type a query.
4. **The keyboard model is the same everywhere it is documented:** ↑/↓ to move,
   Enter or Tab to insert, Esc to close (Codex source, Claude Code docs, legacy
   Cursor).
5. **A mention is an atomic chip with a type icon and a short label.** It
   disambiguates same-named files with parent path parts (Zed, Devin, legacy
   Cursor), shows the full path on hover, opens its target on click, deletes as
   a unit, and stays in sent-message history. Terminal UIs keep plain text
   instead (Claude Code CLI, Codex CLI).
6. **Explicit mentions matter less as agents get tools.** Cursor removed @Web,
   @Codebase, @Definitions, @Linter Errors, and @Docs because "Agent can now
   self-gather context". VS Code says `#codebase` isn't needed. Codex sends
   only paths.
7. **Two payload strategies.** Some products inline a snapshot (Claude Code,
   Zed, Copilot Spaces files); others send a reference the agent reads with a
   tool (Codex, Cursor rules, Zed directories). Inliners cap and degrade
   gracefully:
   - Claude Code sends a partial view at 25k tokens.
   - Zed sends an outline above 16 KB.
   - Copilot (formerly) sent an outline.
   - Large PDFs and folders become references or listings, not content.
8. **Past conversations go in as a summary, not a transcript** (Zed, Windsurf,
   legacy Cursor @Past Chats).
9. **Selection and pastes become mentions automatically.** Examples are Cursor
   `Cmd+L`, Claude Code `Option+K` (`@file#5-10`), Zed paste-as-mention, VS Code
   `#sym` paste, and Devin's paste of over 10k characters becoming a file.
   Line-range syntax (`#L1-99`, `path:start-end`) is common.
10. **Ignore rules filter the picker** (`.gitignore`, `.cursorignore`,
    `respectGitignore`), and deny rules apply to mentions too.
