# Research: how coding agents show images in their output

For `docs/proposals/agent-output-images.md`. Gathered 2026-10-15. Each
claim carries its source. "(I)" marks an inference rather than something a
source states. A user report in an issue is cited as one, not as the
vendor's word.

## Claude Code

**Sources of images.**

- **MCP tool results.** "When an MCP tool returns a PNG, JPEG, GIF, or WebP
  image, Claude sees the image inline in the conversation … Claude Code also
  saves the original bytes to a file in the session's `tool-results`
  directory" (v2.1.283+) ([MCP](https://code.claude.com/docs/en/mcp)).
  Other image types are saved to disk and Claude gets the path
  ([custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)).
  MCP image results still count against `MAX_MCP_OUTPUT_TOKENS` (25,000 by
  default) ([MCP](https://code.claude.com/docs/en/mcp)).
- **`Read` of an image.** "PNG, JPG, and other image formats are returned as
  visual content … Claude Code resizes and recompresses large images"
  ([tools reference](https://code.claude.com/docs/en/tools-reference)).
- **Browser and computer use.** Computer use downscales screenshots to about
  1372×887 ([computer use](https://code.claude.com/docs/en/computer-use)).
  Claude in Chrome saves a screenshot to disk on request
  ([Chrome](https://code.claude.com/docs/en/chrome)).
- **`SendUserFile`.** "`render` opens the file inline in the client,
  `attach` shows a download card only … Delivery runs through
  Anthropic-hosted infrastructure"
  ([tools reference](https://code.claude.com/docs/en/tools-reference)).

**How each client draws them.**

- **CLI.** A text placeholder, "`[Image]`", even in terminals with graphics
  ([#79706](https://github.com/anthropics/claude-code/issues/79706), open).
  Markdown images "degrade to a link in every form tested"
  ([#87438](https://github.com/anthropics/claude-code/issues/87438)).
  Cmd-click on `[Image #1]` opens the OS viewer
  ([common workflows](https://code.claude.com/docs/en/common-workflows)).
  Inline-rendering requests were closed stale or not planned
  ([#2266](https://github.com/anthropics/claude-code/issues/2266),
  [#29254](https://github.com/anthropics/claude-code/issues/29254)).
  Mods can draw an `Image` element up to 2 MiB on kitty and Ghostty only
  ([mods reference](https://code.claude.com/docs/en/plugins/mods/reference)).
- **Desktop.** Tool calls collapse into summaries
  ([desktop](https://code.claude.com/docs/en/desktop)). Users report
  `Read` images drawn inline as small thumbnails with no zoom
  ([#84503](https://github.com/anthropics/claude-code/issues/84503)), and MCP
  `ImageContent` collapsed or missing for the user
  ([#101011](https://github.com/anthropics/claude-code/issues/101011),
  [#73503](https://github.com/anthropics/claude-code/issues/73503)).
- **Web.** Thumbnails capped at 360 px tall; a click opens a
  fit-to-viewport overlay with no zoom (user report,
  [#90213](https://github.com/anthropics/claude-code/issues/90213)).
- **VS Code.** `Read` PNGs, MCP image blocks and markdown images all show
  `[Image]`; only Chrome screenshots draw as a thumbnail with click to
  enlarge (user report,
  [#95797](https://github.com/anthropics/claude-code/issues/95797)).

**Storage and limits.**

- Sessions are JSONL under `~/.claude/projects/`
  ([sessions](https://code.claude.com/docs/en/sessions)). Triage on
  [#80175](https://github.com/anthropics/claude-code/issues/80175): "A single
  `Read` of a large PNG produces one session-file line containing the
  identical base64 payload twice". Reports of 22 MB of screenshots in a
  73 MB session
  ([#94502](https://github.com/anthropics/claude-code/issues/94502)) and a
  3.8 GB JSONL
  ([#22365](https://github.com/anthropics/claude-code/issues/22365)).
- Images are capped at 2000 px
  ([CHANGELOG 2.1.122](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
  When a request would pass a limit, "Claude Code removes a batch of the
  oldest images and PDFs … Claude can no longer see the removed images"
  ([prompt caching](https://code.claude.com/docs/en/prompt-caching)).

**Privacy.** Claude Code's artifacts: "The CSP blocks every external image
… embeds images as data URIs"
([artifacts](https://code.claude.com/docs/en/artifacts)). The terminal
never draws a markdown image, so nothing is fetched there (I, from
[#87438](https://github.com/anthropics/claude-code/issues/87438)).

## OpenAI Codex (CLI, app, cloud)

Code links are to `openai/codex` `main` at `97ebf2d9`.

**Sources.**

- **`view_image`.** "View a local image file from the filesystem when visual
  inspection is needed"; it returns an `InputImage` with an inline `data:`
  URL ([view_image.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/view_image.rs)).
  App-server clients get `{type: "imageView", id, path}`, a path, not pixels
  ([ThreadItem.ts](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts)).
- **MCP `ImageContent`** becomes an `InputImage` with an inline data URL
  ([models.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs)).
- **Code mode `image()`**, which appends an image item
  ([description.rs](https://github.com/openai/codex/blob/main/codex-rs/code-mode-protocol/src/description.rs)).
- **Image generation.** It is saved under `generated_images`
  ([artifact.rs](https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/src/artifact.rs)),
  and the tool's description says "Avoid printing the full result or its
  base64 image data"
  ([imagegen_description.md](https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/imagegen_description.md)).
- **Cloud.** Codex "can spin up its own browser, look at what it built,
  iterate, and attach a screenshot of the result to the task and GitHub PR"
  ([Introducing upgrades to Codex](https://openai.com/index/introducing-upgrades-to-codex/),
  2025-09-15).

**Drawing.**

- **CLI.** Text placeholders: "Viewed image", "Returned image", "Generated
  Image: … Saved to"
  ([mcp_result.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/history_cell/mcp_result.rs)).
  Kitty and Sixel thumbnails landed 2026-10-15, at most 48×6 cells, "Image
  rows do not enter searchable or selectable text"
  ([transcript_image.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/transcript_image.rs)).
- **App.** A generated image opens an expanded viewer with Focused and Canvas
  views ([image generation](https://learn.chatgpt.com/docs/image-generation.md)).
  Open bugs: MCP `ImageContent` is not drawn for the user
  ([#43497](https://github.com/openai/codex/issues/43497)), the viewer can't
  be closed with Esc
  ([#43807](https://github.com/openai/codex/issues/43807)), and cloud image
  outputs are invisible
  ([#45731](https://github.com/openai/codex/issues/45731)).

**Storage.**

- Images are resized to fit 2048 px
  ([utils/image](https://github.com/openai/codex/blob/main/codex-rs/utils/image/src/lib.rs)).
  An `http(s)` `image_url` is never fetched: "image content omitted because
  remote image URLs are not supported"
  ([image_preparation.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/image_preparation.rs)).
- `AttachmentStore` "preserves attachment bytes as media-typed base64 data
  URLs" by default and can answer a `file_id` instead
  ([attachment-store](https://github.com/openai/codex/blob/main/codex-rs/attachment-store/src/lib.rs),
  PR #42634, #46065). Generated images became attachment references in
  #54398 (2026-10-15).
- The bloat this answers:
  - threads "poisoned by inline base64 tool images"
    ([#18629](https://github.com/openai/codex/issues/18629));
  - 413s that leave threads unrecoverable
    ([#30441](https://github.com/openai/codex/issues/30441));
  - session files of 20+ GB
    ([#37346](https://github.com/openai/codex/issues/37346)) and 98 GB
    ([#40111](https://github.com/openai/codex/issues/40111));
  - an image costs about 230 tokens but 4.2 MB on the wire
    ([#41338](https://github.com/openai/codex/issues/41338)).

**Privacy.** In the desktop app, a remote markdown image is checked with
`url_safe` and drawn only when it answers `safe: true`, failing closed to
"Image unavailable" (user trace,
[#23878](https://github.com/openai/codex/issues/23878)). Cloud blocks
internet access during the agent phase by default
([internet access](https://learn.chatgpt.com/docs/cloud/internet-access.md)).

## Cursor

- **MCP images.** "Cursor attaches returned images to the chat. If the model
  supports images, it analyzes them" ([MCP](https://cursor.com/docs/context/mcp)).
  Inline rendering regressed in 3.16; staff said it "should render inline"
  ([forum](https://forum.cursor.com/t/regression-mcp-tool-image-content-no-longer-renders-in-agent-chat-model-receives-it-ui-does-not/168824),
  2026-08-19). Large base64 screenshots once caused "conversation too long",
  and users were told to return a path instead
  ([forum](https://forum.cursor.com/t/mcp-image-support/48801)).
- **Browser.** The agent "displays browser actions like screenshots and
  actions in the chat" ([browser](https://cursor.com/docs/agent/browser)).
- **Image generation.** "Returned as an inline preview and saved to your
  project's `assets/` folder" ([2.4](https://cursor.com/changelog/2-4)).
- **Cloud agents.** "These artifacts are attached to the PR", opt-in, and
  "GitHub's image proxy requires public URLs, so artifacts in PR
  descriptions use long, unguessable URLs that are viewable without
  authentication"
  ([capabilities](https://cursor.com/docs/cloud-agent/capabilities)). The
  rollout history is in a
  [forum thread](https://forum.cursor.com/t/cursor-cloud-agents-do-not-post-their-screenshots-or-videos-to-pr/152974).
- **Security.** Mermaid diagrams could load remote images, which exfiltrated
  data; the fix: "All remote images are removed from the mermaid diagram
  before rendering"
  ([GHSA-43wj-mwcc-x93p](https://github.com/cursor/cursor/security/advisories/GHSA-43wj-mwcc-x93p),
  CVE-2025-54132; bypass
  [CVE-2025-61589](https://nvd.nist.gov/vuln/detail/CVE-2025-61589)).
- A lightbox or zoom is not documented.

## Devin, Windsurf (Devin Desktop), Replit Agent

- **Devin.** "Devin can capture screenshots and videos of the browser and
  submit them back to you as proof of testing"
  ([session tools](https://docs.devin.ai/work-with-devin/devin-session-tools)).
  Recordings are "attached to messages in your session" and "stored on
  Devin's machine"
  ([testing and recordings](https://docs.devin.ai/work-with-devin/testing-and-recordings)).
  "Devin is also vulnerable to rendering images from untrusted domains"; no
  fix was confirmed
  ([Embrace The Red](https://embracethered.com/blog/posts/2025/devin-can-leak-your-secrets/)).
- **Windsurf**, renamed Devin Desktop in June 2026. Its MCP docs list
  tools, resources, and prompts, and do not mention images
  ([MCP](https://docs.devin.ai/desktop/cascade/mcp)). Image rendering from
  untrusted domains was reported as an exfiltration channel, "no ETA" for a
  fix
  ([Embrace The Red](https://embracethered.com/blog/posts/2025/windsurf-data-exfiltration-vulnerabilities/)).
- **Replit Agent.** App Testing records the browser; "click the video to
  replay the entire testing session"
  ([app testing](https://docs.replit.com/references/agent/app-testing.md)).
  Generated images "are saved directly to your project files"
  ([image generation](https://docs.replit.com/references/agent/image-generation.md)).
  Screenshots in chat are not documented.

## The protocols

- **MCP.** An image block is
  `{"type": "image", "data": "base64-encoded-data", "mimeType": "image/png",
  "annotations": {"audience": ["user"], …}}`. A binary resource carries
  `blob`. A `resource_link` names a URI. The spec gives no size guidance
  ([tools, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).
  MCP Apps default to `img-src 'self' data:`
  ([apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).
- **Anthropic API.** A `tool_result` may hold `image` blocks with a
  `base64`, `url` or `file` source
  ([tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)).
  Limits: 8000×8000 px, or 2000 px each past 20 images; 10 MB per image
  direct (5 MB on Bedrock and Vertex); 32 MB per request
  ([vision](https://platform.claude.com/docs/en/build-with-claude/vision)).
- **OpenAI.** Responses `function_call_output` may be a list of
  `input_text`, `input_image`, `input_file`
  ([function calling](https://developers.openai.com/api/docs/guides/function-calling.md)).
  Chat Completions tool messages are text only.
- **Vercel AI SDK 7** (Luke pins `ai` 7.0.135).
  - `toModelOutput({toolCallId, input, output})` may be async and returns
    `{type: "content", value: [{type: "file", mediaType, data: {type:
    "data", data}}]}`
    ([tool.ts](https://github.com/vercel/ai/blob/main/packages/provider-utils/src/types/tool.ts),
    [v7 migration](https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/23-migration-guide-7-0.mdx)).
  - **The UI part gets the raw `execute()` output, not the model's view**
    ([to-ui-message-chunk.ts](https://github.com/vercel/ai/blob/main/packages/ai/src/ui-message-stream/to-ui-message-chunk.ts)),
    so base64 a tool returns is streamed and persisted.
  - [#9632](https://github.com/vercel/ai/issues/9632) reports "Request Entity
    Too Large" from screenshots piling up.
  - Returning a reference from `execute` and loading bytes in `toModelOutput`
    avoids it (I).
  - AI Elements' `ToolOutput` draws an object as JSON, so an image result is
    a base64 dump
    ([tool.tsx](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/tool.tsx)).
  - Streamdown allows every image by default and warns: "Building an AI chat
    UI? Restrict image origins"
    ([security](https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/security.mdx)).

## Image exfiltration

"An attacker tricks the bot into rendering a Markdown image that leaks data
encoded in the URL to an external server"
([Willison](https://simonwillison.net/tags/markdown-exfiltration/)).
"Generally the easiest leg to remove is the exfiltration vectors"
([Willison](https://simonwillison.net/2025/Sep/26/how-to-stop-ais-lethal-trifecta/)).

| Product | Fix |
| --- | --- |
| ChatGPT | A `url_safe` check, bypassed through bing.com redirects ([Tenable TRA-2025-06](https://www.tenable.com/security/research/tra-2025-06)); "not a solved problem" ([Embrace The Red, 2026](https://embracethered.com/blog/posts/2026/data-exfiltration-mitigation-paper-by-openai/)) |
| Bing Chat | A CSP limiting images to Bing hosts ([post](https://embracethered.com/blog/posts/2023/bing-chat-data-exfiltration-poc-and-fix/)) |
| Google Bard | A CSP allowing `*.googleusercontent.com`, bypassed through Apps Script; fixed by filtering URLs ([post](https://embracethered.com/blog/posts/2023/google-bard-data-exfiltration/)) |
| Claude.ai | Images not drawn until "Show Image" is clicked ([post](https://embracethered.com/blog/posts/2023/anthropic-fixes-claude-data-exfiltration-via-images/)) |
| Copilot Chat | Images not drawn (2024); CamoLeak through GitHub's Camo proxy, fixed by disabling image rendering entirely ([Legit](https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code)) |
| M365 Copilot (EchoLeak, CVE-2025-32711) | Reference-style images past redaction; a CSP-allowed Teams proxy ([Willison](https://simonwillison.net/2025/Jun/11/echoleak/)) |
| GitLab Duo | Links and images limited to trusted domains ([Willison](https://simonwillison.net/2025/May/23/remote-prompt-injection-in-gitlab-duo/)) |
| Cursor | Remote images stripped from Mermaid (above) |
| Amp | Fixed ([post](https://embracethered.com/blog/posts/2025/amp-code-fixed-data-exfiltration-via-images/)) |
| Windsurf, Devin | Not confirmed fixed (above) |

A proxy is not a defence: CamoLeak used pre-signed Camo URLs as an alphabet
(I, from the Legit write-up). An allowlist containing a multi-tenant domain
was bypassed twice (Bard, EchoLeak).

**For Luke** (I). The panel's `img-src` admits
`https://*.googleusercontent.com` (`apps/desktop/src/renderer/index.html:7`)
for profile pictures. That is the domain class Bard's bypass used. So
the transcript must never turn a model-written address into an image
element. Pictures are drawn only from bytes Luke's service read itself,
handed to the window as `data:` URLs.

## Limits

Gathered after Dean asked whether 3 MB and 300 pictures per conversation
were too restrictive.

| Tool | Per image | Per message or call | Per conversation | Source |
| --- | --- | --- | --- | --- |
| Claude API | 10 MB base64 (~7.5 MB raw); 8000 px, or 2000 px past 20 images | 100 or 600 images; 32 MB a request | None stated | [vision](https://platform.claude.com/docs/en/build-with-claude/vision) |
| Anthropic Files API | 500 MB a file | n/a | 1 TB per organization | [files](https://platform.claude.com/docs/en/build-with-claude/files) |
| Claude.ai | 10 MB; 8000 px | 20 | Not documented | [help](https://support.claude.com/en/articles/8241126) |
| Claude Code | Resized to the model's limit; over 500 KB re-encoded as JPEG | MCP output 25,000 tokens by default, images included | Not documented | [MCP](https://code.claude.com/docs/en/mcp), [tools](https://code.claude.com/docs/en/tools-reference) |
| OpenAI API | 2048 px (high) or 6000 px (original); no byte cap | 1,500 images; 512 MB a request | None | [images and vision](https://developers.openai.com/api/docs/guides/images-vision) |
| ChatGPT | 20 MB | Not fixed | "Depends on various factors"; 80 files per 3 hours; 25 GB per user, 100 GB per organization | [help](https://help.openai.com/en/articles/8555545), [help](https://help.openai.com/en/articles/8400551) |
| Codex | Resized to 2048 px (6000 original) | Not documented | Not documented | [utils/image](https://github.com/openai/codex/blob/main/codex-rs/utils/image/src/lib.rs) |
| Cursor | Not documented (users report 5 MB) | Not documented (users report 20) | Not documented | [prompting](https://cursor.com/docs/agent/prompting) |
| GitHub | 10 MB an image | Not documented | Not documented | [attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files) |
| Linear | 10 MB on Free; unlimited on paid | Not documented | Not documented | [pricing](https://linear.app/pricing) |
| Slack | 1 GB a file; previews under 25,000 px a side | 10 files by drag and drop | Unlimited; Free stops at 5 GB | [help](https://slack.com/help/articles/201330736) |
| Notion | 5 MB on Free; 5 GB on paid | n/a | Unlimited | [help](https://www.notion.com/help/images-files-and-media) |
| Discord | 20 MB free (was 10); 50 MB to 1 GB with Nitro | 25 MiB a message | Unlimited | [help](https://support.discord.com/hc/en-us/articles/25444343291031) |

Vercel caps a function's request and response body at 4.5 MB
([limits](https://vercel.com/docs/functions/limitations#request-body-size)),
so a picture read whole through one function answer stays under it.

What holds: per-image bounds run from 5 to 20 MB; nobody publishes a
per-conversation count, and those that bound a conversation do it by
context, upload rate, or storage. A per-conversation count of 300 was
stricter than every tool here.

## Patterns that hold

1. Store image bytes once, apart from the log, and name them by reference.
   Everyone who kept base64 in the transcript hit size walls (Claude Code,
   Codex, AI SDK users).
2. The model's view and the person's view are separate paths, and the
   person's view needs its own design. Several products show the model an
   MCP image the user never sees.
3. An explicit "show the user this file" tool (Claude Code's
   `SendUserFile`, Codex's `generatedImage`, Cursor's artifacts) is how an
   agent puts a picture in front of its developer. A file the agent reads is
   its input.
4. Never draw a remote image a model wrote. No rendering, click-to-load, or a
   strict allowlist are the fixes on record. Only the first has not been
   bypassed.
5. The viewer is simple everywhere: fit, arrows, Esc, download. Nobody ships
   before-and-after comparison of screenshots. Testing evidence is moving to
   video (Devin, Replit, Cursor).
