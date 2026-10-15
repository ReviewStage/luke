# How MCP clients show a tool's description, parameters, and annotations

Researched 2026-10-14. Every claim carries a URL. "Source" means read from the product's open
source; "inferred" means from a forum post, screenshot caption, or third-party guide.

## 0. The MCP spec (latest revision: 2026-07-28)

The latest revision is **2026-07-28**; its changelog is relative to 2025-11-25
(https://modelcontextprotocol.io/specification/2026-07-28/changelog).

`Tool` fields (https://modelcontextprotocol.io/specification/latest/server/tools#tool;
schema at https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts):

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Identifier; SHOULD be 1-128 chars of `A-Za-z0-9_-.`, case-sensitive, unique per server |
| `title` | no | "Intended for UI and end-user contexts", from `BaseMetadata` |
| `description` | no | "Human-readable description"; the schema calls it "a 'hint' to the model" |
| `icons` | no | `Icon[]`: `src` (https or `data:` URI), `mimeType?`, `sizes?` (`"48x48"` or `"any"`), `theme?` (`"light"` / `"dark"`) |
| `inputSchema` | yes | JSON Schema object, `type: "object"` at the root, 2020-12 by default; 2026-07-28 allows any 2020-12 keyword (`oneOf`, `$ref`, `if/then`) |
| `outputSchema` | no | JSON Schema for `structuredContent` |
| `annotations` | no | `ToolAnnotations` (below) |
| `_meta` | no | Extension metadata |

`ToolAnnotations` (same schema.ts), with the spec's defaults:

| Field | Default | Meaning |
| --- | --- | --- |
| `title` | none | "A human-readable title for the tool" |
| `readOnlyHint` | false | "does not modify its environment" |
| `destructiveHint` | true | "may perform destructive updates"; meaningful only when `readOnlyHint == false` |
| `idempotentHint` | false | repeat calls with the same args have no extra effect; meaningful only when not read-only |
| `openWorldHint` | true | interacts with an "open world" of external entities (web search yes, memory no) |

- **Display-name precedence**: "`title`, `annotations.title`, then `name`" (schema.ts, the doc comment on
  `Tool.annotations`). `BaseMetadata.title` says the same thing: when `title` is missing, use the name,
  "except for Tool, where `annotations.title` should be given precedence over using `name`".
- **Trust**: "clients **MUST** consider tool annotations to be untrusted unless they come from trusted
  servers" (tools page); "Clients should never make tool use decisions based on ToolAnnotations received
  from untrusted servers" (schema.ts).
- **UI guidance**: Applications SHOULD "Provide UI that makes clear which tools are being exposed to the
  AI model", show "clear visual indicators when tools are invoked", show confirmation prompts, and "Show
  tool inputs to the user before calling the server" (tools page, User Interaction Model and Security).
- **When each field arrived**:
  - `annotations`: 2025-03-26 (https://modelcontextprotocol.io/specification/2025-03-26/changelog, PR #185)
  - `title` (`BaseMetadata`) and `outputSchema` (structured output): 2025-06-18
    (https://modelcontextprotocol.io/specification/2025-06-18/changelog, PR #663 and PR #371)
  - `icons`: 2025-11-25 (https://modelcontextprotocol.io/specification/2025-11-25/changelog, SEP-973),
    along with the tool-name guidance (SEP-986)
- **State of the ecosystem**: The MCP blog says annotation UX is "largely unexploited": no client filters
  tools by annotation, and "none surface annotations as context in approval prompts"
  (https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/).

## 1. Claude (claude.ai, Claude Desktop)

- **Where tools are listed**: Customize > Connectors > select a connector > **Tool permissions**. Each
  group of tools, or each single tool, is set to **Always allow / Needs approval / Blocked**
  (https://claude.com/docs/connectors/getting-started). Tools are grouped "by type (for example,
  read-only tools, write/delete tools)" (https://support.claude.com/en/articles/11176164). Team and
  Enterprise Owners can set these org-wide, and users can't override them (same URL).
- **How annotations are used**: Directory connectors must give every tool a `title` and a
  `readOnlyHint` or `destructiveHint`. These "determine auto-permissions in Claude. Read-only tools can
  run without per-call confirmation, and destructive tools always prompt"
  (https://claude.com/docs/connectors/building/review-criteria). The developer portal's Tools step
  shows tools "grouped by whether their annotations declare them read-only or write" and flags tools
  missing a title or annotations (https://claude.com/docs/connectors/building/submission). So the
  read/write grouping on the permissions page comes from `readOnlyHint` (inferred from the two docs
  together). `idempotentHint` and `openWorldHint`: not documented.
- **Approval prompt**: offers **Allow once** or **Always allow**; the latter skips the prompt for that
  tool from then on (https://claude.com/docs/connectors/getting-started). Whether the prompt shows the
  call's arguments: not documented.
- **"+" (search and tools) menu**: toggles connectors per conversation, plus a "Tool access" mode
  (Auto / On demand). No per-tool list is documented there (https://support.claude.com/en/articles/11176164).
- **Admin tool policy** (Claude for Government): a table with "an on/off switch for each" tool,
  **Refresh tools**, and **Add tool** by name (https://claude.com/docs/government/connectors/overview).
- **Not documented**: whether the full description is shown (truncated, hover, or expanded), markdown
  rendering, parameter display, use of `title` vs `name` on the permissions page, tool `icons`, and
  keyboard behavior. Desktop extensions (MCPB) declare static `tools` (`name` + `description`) in
  `manifest.json` (https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md); where Claude
  Desktop shows them is not documented.

## 2. ChatGPT (apps / connectors, developer mode)

- **Where tools are listed**: "In app settings there is a details page per app. Use that to toggle tools
  on or off and refresh apps to pull new tools, descriptions, and server instructions from the MCP
  server" (developer-mode guide, archived 2026-10-04:
  https://web.archive.org/web/20261004233713/https://developers.openai.com/api/docs/guides/developer-mode;
  the live URL https://developers.openai.com/api/docs/guides/developer-mode returned 404 on 2026-10-14).
  Whether the details page shows each description, or its parameters: not documented.
- **Parameters at call time**: "For each tool call, you can use the carat to expand and collapse the tool
  call details. Full JSON contents of the tool input and output are available" (same guide). Parameters
  appear as **raw JSON of the call**, not as a schema.
- **How annotations are used**: "We respect the `readOnlyHint` tool annotation. Tools without this hint are
  treated as write actions", and "Write actions by default require confirmation" (same guide). You can
  remember approve or deny "for a given tool for a conversation". New conversations, or a refresh,
  prompt again (same guide).
- **Apps SDK**: requires `readOnlyHint`, `destructiveHint`, and `openWorldHint`; `idempotentHint` is
  optional. `destructiveHint` is there "so the host knows to elicit explicit approval first"; the hints
  "only influence how ChatGPT or Codex frames the tool call to the user". Optional
  `_meta["openai/toolInvocation/invoking"]` / `invoked` give ≤64-char status text while the tool runs
  and after it finishes (https://developers.openai.com/apps-sdk/reference).
- **Not documented**: `title` and `icons` in the UI (the Apps SDK reference doesn't mention `icons`),
  markdown rendering, and keyboard behavior.

## 3. Cursor

- **Where tools are listed**: MCP servers moved into the **Customize** page, where each server has an
  enable toggle (https://cursor.com/docs/context/mcp). Guides say you expand a server in Settings >
  Tools & MCP to toggle individual tools (inferred, third-party:
  https://www.truefoundry.com/blog/mcp-servers-in-cursor-setup-configuration-and-security-guide). Tool
  toggles can't be set in `mcp.json` (inferred from a feature request:
  https://forum.cursor.com/t/add-the-ability-to-pre-configure-which-mcp-tools-are-enabled-disabled-via-the-mcp-json-configuration-file-eliminating-the-need-to-manually-enable-tools-in-the-ui-after-every-cursor-restart/148139).
- **Descriptions and parameters in settings**: A user said on 2026-08-10 that in the new Customize view
  "Tools no longer show descriptions or input params forcing me to use `mcp-inspector`", and that the
  "one tool per line" view makes it harder to see all tools (inferred, forum:
  https://forum.cursor.com/t/new-mcp-configuration-in-customize-is-no-good/167882). Staff pointed to
  `Cmd/Ctrl+Shift+P` > **Open MCPs** as the direct route (same thread).
- **Parameters at call time**: "Click the arrow next to the tool name to see arguments"; chat shows
  "expandable views of arguments and responses" (https://cursor.com/docs/context/mcp).
- **Approval**: "Cursor asks for approval before using MCP tools by default". Admins can set tool
  allowlists, and in Auto-review mode allowlisted tools run immediately (same URL). A 2025 bug: the
  approval prompt read "Calling MCP tool" without the tool's name (inferred, forum:
  https://forum.cursor.com/t/mcp-tool-permission-misses-tool-name/139300).
- **Not documented**: annotations (no mention of `readOnlyHint`), `title`, `icons`, and markdown rendering.

## 4. VS Code (Copilot Chat)

- **Tools picker**: "The tool description is shown in the tools picker, alongside the tool name"
  (https://code.visualstudio.com/api/extension-guides/ai/mcp). Source: each row is a quick-tree item
  with `label: toolReferenceName ?? displayName` and `description: userDescription ?? modelDescription`
  (https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/actions/chatToolPicker.ts).
  In a quick pick, `description` renders as dimmed plain text on the same row, truncated (inferred from
  standard quick-pick behavior). MCP servers are buckets in that file's code ("the bucket directly
  represents the server and stores the toolset"), and each row has a checkbox.
- **Agent Customizations > Tools tab**: tools sit in "collapsible groups"; a search box "filter[s] tool
  groups and individual tools"; a group checkbox toggles the whole group and shows "a mixed state" when
  only some tools are on; each group shows "enabled and total tool counts"
  (https://code.visualstudio.com/docs/agents/run/tools.md). Local harness: **Configure Tools** in the
  chat input, with a search box (same URL).
- **Display name**: the source uses `annotations?.title || title || name`
  (https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpLanguageModelToolContribution.ts).
  **This is the reverse of the spec's order**, which puts `title` first. The docs say `annotations.title`
  is "shown in the Chat view when a tool is invoked"
  (https://code.visualstudio.com/api/extension-guides/ai/mcp).
- **Icons**: "VS Code supports `icons` provided on MCP servers, resources, and tools" (same URL). The
  source asks for a 22px icon (`tool.icons.getUrl(22)`) and falls back to the `tools` codicon.
- **How annotations are used** (source, same contribution file):
  - Without `readOnlyHint` (or with it false), the call needs confirmation. The confirmation title is
    "Run {title}", the message is the tool **description rendered as a `MarkdownString`**, plus a
    standing MCP disclaimer.
  - With `readOnlyHint` true, there is no confirmation; the docs say the same, "VS Code doesn't ask for
    confirmation to run read-only tools".
  - With `openWorldHint` true, `confirmResults` is set: the user approves the *result* before the model
    sees it.
  - `destructiveHint` and `idempotentHint`: not used.
- **Confirmation dialog**: "expand the confirmation dialog to review its input parameters"; some
  confirmations let you edit them ("select the chevron next to the tool name", edit, then **Allow**)
  (https://code.visualstudio.com/docs/agents/run/tools.md). The extension guide says "Users can edit
  model-generated input parameters in the tool confirmation dialog"
  (https://code.visualstudio.com/api/extension-guides/ai/mcp).
- **MCP server view**: Extensions view > **MCP SERVERS - INSTALLED**, through right-click or the gear
  (https://code.visualstudio.com/docs/agent-customization/mcp-servers.md). A per-tool hover there: not
  documented.
- **Keyboard**: `#` in the chat input browses tools and tool sets
  (https://code.visualstudio.com/docs/agents/run/tools.md). No keys are documented for the picker itself
  beyond standard quick-pick behavior.

## 5. Raycast (AI Extensions and MCP)

- **MCP servers**: **Manage MCP Servers** shows "every installed server with its status, tool list, and
  details in one place". The details pane shows server/transport output. Actions: Add Server, Refresh,
  Start, Stop, Restart, Logout, Uninstall (https://manual.raycast.com/ai/model-context-protocol). How each
  tool row looks (description, parameters): not documented.
- **AI extension tools**: the manifest requires a `title` ("shown to the user in the Store and
  Preferences") and a `description` ("displayed in the Store and in Preferences"), and allows an
  optional per-tool `icon` that falls back to the extension icon
  (https://developers.raycast.com/information/manifest). Settings has a section per extension listing
  "the individual commands and the Ask tool it exposes"
  (https://manual.raycast.com/ai/ai-extensions).
- **Approval**: "By default, Raycast approves read-only tools on its own and asks you about the rest"
  (https://manual.raycast.com/ai/model-context-protocol). Whether "read-only" means `readOnlyHint`: not
  documented. When approval is needed, "the chat pauses and shows a card that describes the action";
  "The description is AI-generated, so check it before you allow". With several calls pending, the
  Action Panel adds **Allow All / Deny All** (https://manual.raycast.com/ai/ai-extensions).
- **Extension confirmations**: `Tool.Confirmation` has a `message`, `info` ("name/value pairs that
  represent the side-effects"; a pair is hidden when its value is `undefined`), an `image`, and a
  `style` (`Action.Style.Destructive` for irreversible actions)
  (https://developers.raycast.com/api-reference/tool). These are curated key/value rows, not raw JSON.
- **Keyboard**: Allow is `↵`, Always allow is `⌘↵`, Deny is `Esc`
  (https://manual.raycast.com/ai/ai-extensions).
- **Not documented**: MCP annotations beyond "read-only", MCP `title` and `icons`, markdown rendering, and
  parameter schema display.

## 6. Zed

- **Profiles tool picker**: Agent Panel profile selector > **Configure**, or `agent: manage profiles`;
  the modal configures built-in tools and MCP tools (https://zed.dev/docs/ai/agent-profiles). In the
  source, each row shows the **tool `name` only**, under a muted XSmall server-id header, with a green
  check when enabled. The search placeholder is "Search MCP tools…". No description, no parameters
  (https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/agent_configuration/tool_picker.rs).
- **Description**: in the source, an MCP tool's description goes only to the model
  (`fn description` in
  https://github.com/zed-industries/zed/blob/main/crates/agent/src/tools/context_server_registry.rs).
  No user-facing surface was found.
- **Tool card title**: "Run MCP tool `name`". When the input is an object with a single string field,
  that value is inlined, truncated with "…", and markdown-escaped, "so the primary argument (e.g. a URL,
  path, or query) is visible without expanding the input block" (source, same file).
- **Permissions**: a tool card menu with **Allow once / Deny once / Always for <tool>**; "MCP tools only
  support the tool-level option" (https://zed.dev/docs/ai/tool-permissions). The settings key is
  `mcp:<server>:<tool_name>`, and the default is `"confirm"` (https://zed.dev/docs/ai/mcp).
- **How annotations are used**: none. `read_only_hint` appears only in the protocol types
  (`crates/context_server/src/types.rs`) and nowhere in the agent or UI code (source, GitHub code search
  in zed-industries/zed). Zed doesn't use `title` or `icons`: names only, per the picker source above.
- **Keyboard**: none documented.

## Cross-product summary

| | Description shown to user | Params shown | Annotations used | Display name |
| --- | --- | --- | --- | --- |
| Claude | not documented | not documented | read vs write grouping; read-only auto-runs, destructive prompts | not documented (requires `title`) |
| ChatGPT | not documented (refresh pulls descriptions) | raw JSON of the call, expandable | `readOnlyHint` only gates confirmation | not documented |
| Cursor | missing in the new Customize view (forum) | args expandable in chat | none documented | `name` |
| VS Code | inline in picker; markdown in confirmation | editable fields in confirmation | `readOnlyHint` (skip confirm), `openWorldHint` (confirm results) | `annotations.title` > `title` > `name` |
| Raycast | Store/Preferences (extensions) | curated `info` rows | "read-only" auto-approve | `title` (extensions) |
| Zed | no | single string arg inlined in title | none | `name` |
