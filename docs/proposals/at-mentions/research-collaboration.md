# @-mentions in collaboration and chat products

Research for a proposal on @-mentions in an AI agent's composer. Gathered
2026-10-14 from current vendor docs where they could be fetched. "Not
documented" means the vendor's docs, as fetched, do not say. Where a vendor's
help center refused automated fetches (help.openai.com, perplexity.ai answered
403), the claim comes from the search engine's excerpt of that page or from a
third-party source, and is marked that way.

---

## 1. Linear

### Trigger and entry points
- `@` followed by text mentions "a user, issue, project, date, document, or
  pull request" (https://linear.app/docs/editor).
- Typing an identifier works: "you can mention issues with `@ENG-123`";
  pasting an issue ID or URL also links it (https://linear.app/docs/editor).
- Mentions work in issue descriptions, comments, agent guidance fields, and
  documents (https://linear.app/docs/documents).
- Agents: "@mention them in comments or descriptions to trigger their
  functions", or delegate by assigning
  (https://linear.app/docs/agents-in-linear). The built-in Linear Agent is
  reached by "opening an agent chat, using ⌘/Ctrl + J … or by mentioning
  `@Linear` in any comment" (https://linear.app/docs/linear-agent). Skills
  are invoked "with a slash command in the agent input" (same page).
- A third-party agent is mentionable only if it requested the
  `app:mentionable` OAuth scope ("Allow the app to be mentioned in issues,
  documents, and other editor surfaces"); `app:assignable` makes it a
  delegate (https://linear.app/developers/agents.md).

### Picker UI
- One `@` menu mixes people and objects; "matching documents will appear in
  the lowest section", so results are grouped by kind with documents last
  (https://linear.app/docs/documents).
- Search was tuned "so that the most relevant issues show up"; the issue
  mention menu shows "away presence indicators" for people
  (https://linear.app/changelog/2023-08-30-mentions).
- An agent's name and icon are what it shows "in mention and filter menus"
  (https://linear.app/developers/agents.md).
- Fuzzy matching, keyboard navigation, recents ordering, result count: not
  documented.

### Chips, edit/delete, rename, permissions
- Chip appearance and backspace behavior: not documented.
- Referenced issues "are added automatically as related issues", and a
  mentioned person gets an Inbox notification and is subscribed
  (https://linear.app/docs/editor).
- Rename handling: not documented (the stored form is a URL to an ID, see
  below, so the label is resolved at render time by construction, but Linear
  does not say so).
- Permissions: "You cannot @ mention a member in an issue in the private team
  if they are not already a member of the private team"; "The name of the
  private team or issues from that team do not become visible to
  non-members"; but "The API, webhooks, and integrations such as Zapier can
  expose a user's private team and issue titles"
  (https://linear.app/docs/private-teams). What a non-member sees in place of
  a mention chip: not documented.
- Linear Agent "operates within your existing permissions … it can only
  reference or change content that you already have access to"
  (https://linear.app/docs/linear-agent).

### Wire format and what the model receives
- Mentions are plain resource URLs in Markdown: "In the GraphQL API, mentions
  can be created in Markdown by using the plain URL of the resource"; a
  profile URL renders as a user mention, an issue URL as an issue mention
  (https://linear.app/developers/graphql).
- Agents write mentions the same way: "To include mentions in Agent Activity
  content, use plain Linear URLs in Markdown. These will be converted into
  mentions in the UI" (https://linear.app/developers/agent-interaction.md).
- A mention of an agent creates an `AgentSession`; the agent gets a webhook
  whose `promptContext` is "a formatted string containing the session's
  relevant context, such as issue details, comments, and guidance", an XML
  shape with `<issue identifier>`, `<title>`, `<description>`, `<team>`,
  `<label>`, `<parent-issue>`, `<project>`, `<primary-directive-thread>`,
  `<other-thread>`, `<guidance>`; users appear as e.g.
  `<user id="...">name</user>`. Structured fields `agentSession.issue`,
  `agentSession.comment`, `previousComments`, `guidance` sit beside it
  (https://linear.app/developers/agent-interaction.md). So the agent gets a
  snapshot of the surrounding issue and thread, and fetches anything else
  through the API.
- A mentioned document in an agent guidance field: "the agent can reference
  the instructions in that document before performing another action"
  (https://linear.app/docs/documents), i.e. a reference, read on demand.
- Size limits on `promptContext`: not documented. Time limits: webhook reply
  within 5 seconds, first activity within 10 seconds
  (https://linear.app/developers/agent-interaction.md).

---

## 2. Notion

### Trigger and entry points
- `@` + a name for people, `@` + a page title for pages, `@` + a date or
  "today / tomorrow / yesterday" for dates
  (https://www.notion.com/help/comments-mentions-and-reminders).
- Page links also by `[[` or `+` followed by the page name
  (https://www.notion.com/help/create-links-and-backlinks).
- Notion Agent (AI chat): "select `@` at the top of the text field, then
  select a particular page or person", or "@-mention specific pages or people
  directly in your query"; a source picker ("All sources", with connected
  "MCP servers") and a 📎 upload sit beside it
  (https://www.notion.com/help/notion-agent).

### Picker UI
- "A pop up menu will search for them in real-time"; Enter selects
  (https://www.notion.com/help/comments-mentions-and-reminders).
- You can only pick pages you can access (a third-party glossary says an
  inaccessible page "won't appear in the dropdown",
  https://noteforms.com/notion-glossary/page-mention; Notion itself does not
  say).
- Grouping by kind, fuzzy matching, keyboard navigation beyond Enter,
  recents, result count: not documented.

### Chips, edit/delete, rename, permissions
- A page mention is "something more like a hyperlink" and creates a backlink;
  "the new title will automatically reflect that change wherever the page is
  @-mentioned" (https://www.notion.com/help/comments-mentions-and-reminders).
- Relative dates ("today") turn into numbered dates as time passes (same
  page). Group mentions preview up to 10 members on hover (same page).
- Permissions: mentioning someone on a page they cannot access does not
  notify them ("they will not be notified")
  (https://www.notion.com/help/comments-mentions-and-reminders). Backlinks
  are only shown for pages you can access, private ones labeled `Private`,
  and "Users can't use backlinks to open pages that they don't have access
  to" (https://www.notion.com/help/create-links-and-backlinks).
- The in-app "No access" label on an inaccessible page mention, and the look
  of a mention of a deleted page: not documented in Notion's help center. The
  API shows the equivalent: a mention the integration cannot read "is
  returned with only its ID", `plain_text` "Untitled"; an unreadable user
  reads "@Anonymous" (https://developers.notion.com/reference/rich-text).
- Backspace behavior: not documented.

### Wire format and what the model receives
- A mention is a rich-text object with `type: "mention"` and a nested
  `user`, `page` (UUID `id`), `database` (UUID `id`), `date`
  (`start`/`end`), `link_preview` (`url`), or `template_mention`
  (`today`/`now`/`me`); every object also carries a `plain_text` fallback
  (https://developers.notion.com/reference/rich-text). Typed token with an
  id, display text resolved at read time.
- Limits: `text.content` 2000 chars, rich-text arrays 100 elements, 1000
  blocks and 500KB per payload; no mention-specific limit
  (https://developers.notion.com/reference/request-limits).
- Notion Agent: takes "the context of the page you're currently in" (or the
  selected blocks) by default; "Notion Agent has the same permissions you
  do" (https://www.notion.com/help/notion-agent); "only uses information it
  has permission to see" (https://www.notion.com/help/notion-ai-faqs).
- Whether a mentioned page is inlined as a snapshot or retrieved by search,
  and how many or how large pages may be: not documented
  (https://www.notion.com/help/notion-ai-faqs,
  https://www.notion.com/help/guides/how-to-get-better-answers-from-notion-ai).

---

## 3. Slack

### Trigger and entry points
- Type the mention symbol, then "Enter a member's name, or select one from
  the list of members" (https://slack.com/help/articles/205240127-Use-mentions-in-Slack).
- `@here` / `@channel` / `@everyone` broadcast mentions; in channels of six
  or more members Slack asks for confirmation, and admins can restrict them
  (https://slack.com/help/articles/202009646-Notify-a-channel-or-workspace,
  per search excerpt).
- `#` channel links: the composer side is not documented on the help page
  fetched; the wire form is below.
- Slackbot (Slack AI): prompts reference context inline, e.g. "Create an
  agenda for my Thursday meeting with @name using the conversations in
  #channel-name", or links to files and canvases
  (https://slack.com/help/articles/202026038-How-to-work-with-Slackbot).
  Opening Slackbot while viewing a channel, canvas, or record uses that
  context (https://slack.com/help/articles/115004846068-Slack-updates-and-changes,
  per search excerpt).

### Picker UI
- When several people share a display name, the entered name gets "a dotted
  blue box" and a question mark to disambiguate
  (https://slack.com/help/articles/205240127-Use-mentions-in-Slack).
- Grouping, fuzzy matching, keyboard nav, ordering, count: not documented.

### Chips, edit/delete, rename, permissions
- Display names are rendered at view time: "Slack will use the 'display
  name' when rendering all mentions"; the old `<@W123|bronte>` form is
  deprecated (https://docs.slack.dev/changelog/2017-09-the-one-about-usernames/).
  Names "may change at any time … an ID will always remain the same"
  (https://docs.slack.dev/messaging/formatting-message-text).
- Channel IDs are "automatically converted to show the actual name of the
  conversation"; a reader without access to a linked private channel sees
  "only an unclickable `private channel` label"
  (https://docs.slack.dev/messaging/formatting-message-text).
- Deleted profiles: "Full and display names will appear as @deactivateduser"
  (https://slack.com/help/articles/360000360443-Delete-profile-information-from-Slack).
- Notification follows access: a non-member mentioned in a public channel
  gets an Activity notification; in a private channel "the member won't be
  notified and can't see your message until you invite them"
  (https://slack.com/help/articles/205240127-Use-mentions-in-Slack).
- Chip look and backspace behavior: not documented.

### Wire format and what the model receives
- mrkdwn tokens: `<@U012AB3CD>` user, `<#C123ABC456>` channel,
  `<!subteam^ID>` user group, `<!here>` / `<!channel>` / `<!everyone>`,
  `<!date^timestamp^token_string^optional_link|fallback_text>` rendered in
  the reader's timezone; `&`, `<`, `>` escaped as entities; name-based
  `link_names` parsing is deprecated for user mentions
  (https://docs.slack.dev/messaging/formatting-message-text).
- The composer's own output is a `rich_text` block ("all messages sent by
  end-users will have this format",
  https://docs.slack.dev/reference/block-kit/blocks/rich-text-block) whose
  section holds typed elements `user`, `channel`, `usergroup`, `broadcast`,
  `date`, `link`, `emoji`
  (https://docs.slack.dev/reference/block-kit/block-elements/rich-text-section-element.md).
  The `user` element is `{"type":"user","user_id":"U123ABC456"}` with
  optional `style` and `from_llm` ("Indicates whether the user was generated
  by the LLM itself")
  (https://docs.slack.dev/reference/block-kit/block-elements/user-element).
  `broadcast` has `range` here/channel/everyone
  (https://docs.slack.dev/reference/block-kit/block-elements/broadcast-element).
- Slackbot: "Responses from Slackbot are based only on information you can
  view in Slack" (https://slack.com/help/articles/202026038-How-to-work-with-Slackbot).
  Whether a `#channel` in a prompt is inlined or searched, and size limits:
  not documented. For comparison, the Claude app in Slack "can access the 20
  most recent messages" when mentioned in a channel
  (https://slack.com/help/articles/53532192117267-Use-Claude-in-Slack, per
  search excerpt).

---

## 4. ChatGPT

(help.openai.com refuses automated fetches; claims below come from search
excerpts of the named pages unless another URL is given.)

### Trigger and entry points
- Apps / plugins: "mention an available app or plugin with **@**, or select
  **+** and choose it from the available menu"
  (https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt).
  Since July 9, 2026 the app directory moved to the Plugin directory;
  plugins can also be picked from **+** by name or a **Plugins** button
  (https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex).
- Starting a message with an app's name can surface it, and first use
  prompts the user to connect
  (https://openai.com/index/introducing-apps-in-chatgpt/).
- GPTs: since January 2024, paid users "can bring GPTs into a conversation by
  typing '@' and selecting a GPT from the list"
  (https://techcrunch.com/?p=2658709, quoting OpenAI).
- Files: Library files are added from the composer menu ("add from
  library"), with a recent-files strip in the composer; no `@` for files
  documented (https://help.openai.com/en/articles/20001052-file-storage-and-library-in-chatgpt).

### Picker UI
- The `@` menu lists GPTs with a search box
  (https://voicebot.ai/2024/01/29/openai-is-rolling-out-gpt-mentions-in-chatgpt-to-invoke-custom-gpts/).
- A name typed without choosing it from the menu stays plain text
  (https://www.gizmotimes.com/ai/chatgpt-at-symbol-mentions-tools-apps/51422,
  third-party).
- Grouping, keyboard nav, recents, count: not documented.

### Chips, edit/delete, rename, permissions
- A selection shows as "a distinct selected item, chip or labelled entry"
  in the composer (gizmotimes, third-party, as above).
- Scope is one message: a community report says a selected app "does not
  stay as the default in the input box" for later messages
  (https://community.openai.com/t/chatgpt-app-no-longer-stays-selected-in-the-input-box-during-a-session/1387050).
- A mention cannot bypass install, connection, or approval
  (gizmotimes, third-party). Availability "depends on the app, your ChatGPT
  plan, region, workspace, role, model, and the ChatGPT interface"
  (https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt).
- Rename/deletion of an app or GPT, backspace behavior: not documented.

### Wire format and what the model receives
- Wire format of a mention: not documented.
- A mentioned GPT "will have an understanding of the full conversation"
  (https://techcrunch.com/?p=2658709).
- Apps are tools: "Discovery in ChatGPT is model-driven: the assistant
  chooses your app when your tool metadata, descriptions, and past usage
  align" (https://developers.openai.com/apps-sdk/plan/use-case); an @-mention
  forces the choice rather than inlining content.
- Files: 512MB per file, 2M tokens per text/document file, ~50MB per
  spreadsheet, 20MB per image
  (https://help.openai.com/en/articles/8555545-file-uploads-with-chatgpt).

---

## 5. Claude.ai (and Claude Code for contrast)

### Claude.ai
- No `@`-mention in the claude.ai composer is documented. Context is added
  through the **+** button: "Add from Google Drive" then "Search through your
  recently accessed documents or paste the document's URL"; connectors are
  toggled under **Connectors** in the same menu
  (https://support.claude.com/en/articles/10166901-use-google-workspace-connectors).
  One version of that article says "/" also opens the menu (search excerpt of
  the same URL); the fetched version does not.
- Read time and freshness: "When you send your message, Claude accesses and
  processes the document"; Docs "sync directly from Google Drive, so you're
  always working with the latest version"; text only, "Images embedded in
  documents are not processed"; "The files must fit within the conversation's
  context window" (same URL).
- Permissions and deletion: "Claude mirrors your existing permissions"; if
  you lose access, you "won't be able to view its contents in conversations
  where it was previously added", while history is kept (same URL).
- Projects: near the context limit Claude "will automatically enable RAG
  mode to expand your project's capacity by up to 10x", using a project
  knowledge search tool
  (https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects).

### Claude Code (an agent composer with `@`)
- "Type `@` to open a path suggestion menu, then press Enter or Tab to accept
  the highlighted path"; a file reference "includes the content of the file
  in the conversation when it fits the Read tool's token limit, 25,000 tokens
  by default. A text file larger than 256KB isn't included"; directories
  show listings, not contents; a file reference also adds `CLAUDE.md` from
  its directory and parents; MCP resources by `@server:resource`
  (https://code.claude.com/docs/en/common-workflows).
- MCP output warns above 10,000 tokens and caps at 25,000 by default
  (`MAX_MCP_OUTPUT_TOKENS`) (https://code.claude.com/docs/en/mcp).
- The wire form is the literal `@path` text, expanded into an attachment at
  send (same pages).

---

## 6. Raycast AI

- Trigger: "Type `@` in AI Chat, Quick AI, or Root Search and a list of every
  installed AI Extension appears"; chainable ("`@calendar @things …` … the AI
  will analyze both"); on iOS MCP servers are `@`-mentioned "exactly like the
  built-in extensions" (https://manual.raycast.com/ai/ai-extensions.md).
- `@` also adds attachments: "Add context to your next message by clicking
  the attach button in the composer or typing `@`" with sources Files,
  Clipboard History, Browser Tabs, Selected Text, Focused Window, Calendar
  Events (https://manual.raycast.com/ai/ai-chat.md). So one `@` menu carries
  both tools (extensions) and content (attachments).
- What the model receives: an extension mention exposes tools, and "the AI
  figures out which tool to call, with what arguments"; tools needing
  approval pause the chat on a card (https://manual.raycast.com/ai/ai-extensions.md).
  An attachment is content: "Attachments are scoped to the message you send
  them with, but the model can keep referring back to them later"; an
  oversized attachment is saved to a file and the model gets "the start of
  it, plus the path" (https://manual.raycast.com/ai/ai-chat.md).
- Deletion: uninstalling an extension makes "its tools disappear from
  `@-mentions` immediately" (https://manual.raycast.com/ai/ai-extensions.md).
- Picker grouping, fuzzy matching, chip rendering, wire format: not
  documented.

## 7. Perplexity (Comet)

(perplexity.ai refused automated fetches; from search excerpts.)
- Comet's assistant references open tabs with `@tab`, e.g. "Compare the
  pricing information in @tab1 and @tab2"
  (https://www.perplexity.ai/comet/resources/articles/getting-the-best-answers-from-comet).
- Comet "only sends minimal context to Perplexity when needed", such as
  summarizing an open tab
  (https://www.perplexity.ai/help-center/comet/en/articles/12658082-control-what-comet-assistant-can-use).
- Picker, chips, wire format, limits: not documented. No `@` documented in
  Perplexity's main search composer.

---

## Patterns that converged

### Wire format
1. **Store an id, render the name.** Slack (`<@U123>`, `{"type":"user",
   "user_id":…}`), Notion (`mention.page.id`), and Linear (a resource URL)
   all persist a stable identifier and resolve the label when drawn. Slack
   deprecated the `<@id|name>` and name-based forms outright
   (https://docs.slack.dev/changelog/2017-09-the-one-about-usernames/).
2. **A typed node, with a plain-text fallback.** Notion gives every mention a
   `plain_text`; Slack's mrkdwn forms take `|fallback_text` (dates); Linear's
   is a URL, readable even where mentions are not rendered.
3. **The editor's output is a structured document, not text with markup**
   (Slack `rich_text`, Notion rich-text arrays); markup tokens remain the
   input form for apps.
4. **Agents mention back in the same format** (Linear: plain URLs in agent
   Markdown; Slack: `user` element with `from_llm`).

### What the AI receives
5. **Two kinds of mention behind one `@`:** a *capability* (ChatGPT apps and
   GPTs, Raycast extensions, Linear agents), which steers which tool or agent
   runs, and a *content reference* (Notion pages, Claude Code files, Raycast
   attachments, Comet tabs, Linear guidance docs), which supplies context.
6. **Content is inlined up to a budget, then degraded.** Claude Code: 25k
   tokens / 256KB; Raycast: head of the content plus a file path; Claude
   projects: switch to retrieval; Claude Drive files: must fit the context
   window. Most products do not document the limit at all.
7. **Selection is per message**; the content lingers in history (Raycast says
   so; ChatGPT apps do not stay selected).
8. **The surrounding object travels as a snapshot; the rest is fetched.**
   Linear's `promptContext`, Notion's current-page default, Slackbot's
   current view.

### Permissions
9. **The AI acts as the asking user.** Linear Agent, Notion Agent, Slackbot,
   Claude connectors all state it sees only what the user can.
10. **You can only pick what you can see** (Linear private teams, Notion
    picker), but a reader may lack access to what the writer picked, so
    render-time checks exist too: Slack's unclickable "private channel"
    label, Notion API's "Untitled"/"@Anonymous", Notion's `Private`
    backlinks.
11. **Notification follows access**: Notion and Slack do not notify someone
    mentioned somewhere they cannot read.
12. **Leaks happen outside the UI**: Linear warns the API and webhooks can
    expose private titles (https://linear.app/docs/private-teams).

### Rename and deletion
13. **Rename is free when the id is stored**: Notion says titles update
    everywhere; Slack renders current display names.
14. **Deletion leaves a tombstone, not a hole**: Slack's `@deactivateduser`;
    Notion API's id-only "Untitled"; Claude keeps the conversation but hides
    a file's contents once access is lost; Raycast drops an uninstalled
    extension from the picker immediately.
15. **Chip editing (backspace, convert to text) is undocumented everywhere**;
    a proposal will have to choose rather than cite.
