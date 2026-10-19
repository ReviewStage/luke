# Proposal: Inbox items as threads of document-style messages

Status: **direction chosen by Dean, not built.** Dean chose a thread in
which each message, an agent's or a person's, is a freeform document, and
not an item that is one document as a whole. He asked that replying never
answer the question, and confirmed that a plain reply wakes the agent.
Recommended values on fields (§4) are proposed here, in answer to his
question, and wait on his word. Nothing in §6 is built yet.

The design show is `docs/proposals/inbox-messages/index.html`. It is one
self-contained file that fetches nothing. It is hand-drawn in the desktop's
own palette and type roles (`palettes.css`, `profiles.css`), not built from
the renderer's components, in dark and light. It has three tabs:
**Proposed** (the window's Inbox with a six-message review thread, the two
states of the reply box, and a thread for every kind of ask),
**Every type today** (every block, response, and settled state as
`inbox-pane.tsx` draws them now), and **Notes**. Options, steps, fields, and
the ask's answers respond to presses, and nothing is sent.

Dean's ask: "I want to redesign inbox items to make them more intuitive and
less confusing. Right now I think they're a bit rigidly typed. For example I
think that images and links are at the end and I just want flexibility for
both the agent and the user."

## 1. What is rigid today

- **Blocks are a stack.** An item is a title, up to eight blocks
  (`markdown`, `link`, `code`, `image`), and one response
  (`inbox-wire.ts`). A link, a picture, and a code reference are each a
  full-width row of their own, never inside a sentence or beside each other,
  and a picture has no caption (`ImageBlock` passes `caption={undefined}`).
- **The tool's words set the order.** `post_to_inbox`'s description
  (`coder-host/inbox.ts`) names Markdown, then links, then code, then
  images, and agents write them in that order. That is why pictures and
  links land at the end, though the pane draws blocks in any order.
- **A link block says what Markdown says.** `[@name](url)` in a Markdown
  block is already a chip with a hover card; a link block is a plainer
  underlined link, so the same page reads two ways.
- **Six responses, six shapes.** A choice is a radio list, an approval two
  cards across, a to-do the title as one checkbox however many steps it
  has, a form stacked fields, text the box alone, and none a "Got it".
- **The item is not one thread.** The question, the answer, and the
  thread's messages are three kinds of thing, each drawn its own way.
  Posting again under a key replaces the item, so a follow-up question
  erases the one before it.
- **Two steps to answer, and whether it waits shows late.** The pick is made
  in the item and sent from the box docked under it. Whether the agent
  needs the answer (`needsReply`) is said only after it is sent: "Sent to…"
  or "Saved for the agent to read".

## 2. The thread

An Inbox item is a **thread**: a title and its messages, oldest first, each
by its writer's face and name with a line down the left joining it to the
next, as the comment thread of #3179 already draws. Any member of the
workspace, or the agent, adds a message at any point.

Every message is **a small document** in the plan's Markdown, the same for
an agent and a person:

- `[@name](url)` inline is a chip, as everywhere else.
- `![alt](src "caption")` is a picture with its caption, as in the plan.
  Pictures written next to each other stand side by side, so a before and
  an after read as a pair.
- A link alone on its line expands into a one-line card: a pull request
  with its diff count, a page with its preview, an issue, or the lines of a
  `blob/<sha>/…#L` link drawn as the Code tab's card. Inside a sentence the
  same link stays a chip, as a line link already does in the plan.
- `- [ ]` steps, code fences, and the rest of the plan's Markdown.

The thread's line under its title says how many messages, who wrote them,
and **Waiting on you** while an ask in it is open, the one place colour is
spent. The row in the list shows the same orange dot and the latest
message as its preview.

## 3. Asks and answers

An agent's message may end with an **ask**, drawn as a box closing the
message: what it asks, "Waiting on you", and its answers.

| Ask | Drawn as | Its answers |
| --- | --- | --- |
| `decide` | Options, one perhaps recommended, numbered for the keys | The option picked, or two short options as buttons (Approve, Request changes) |
| `do` | Steps the reader ticks | Mark done, once every step is ticked; Couldn't do it |
| `answer` | Fields, or nothing where the reply's words are the answer | Submit; Answer |

**Replying never answers.** The reply box under the thread only replies: its
one button is Reply ⌘↩, and while an ask is open it says "Replying keeps the
ask open". A reader can talk the question over as long as they like. A plain
reply reaches the agent as an "Inbox message" and wakes it, as a message on
an item's thread does today (Dean, confirmed).

**To answer, press one of the ask's answers.** It attaches to the reply box
as a stamp, which × takes off again, and the send button takes its name:
Approve ⌘↩, Choose "7 days" ⌘↩, Mark done ⌘↩. Sending posts one message, the
reader's words, pictures, and links under the stamp, and the ask settles to
one line naming who answered and how. The agent hears it as an "Inbox
answer", as today.

**One ask is open at a time.** An agent asks again in the same thread by
posting a new message with a new ask, which replaces the open one; the old
ask stays in its message, struck through and marked Replaced. Withdrawing an
ask settles it the same way, with why. A thread with no open ask waits on
nobody.

## 4. Recommended values on fields

Dean asked whether fields will take recommended values. Proposed: **yes,
shown and never filled in.**

- A field may name a recommended value, as a choice names a recommended
  option: `{ type: "number", label: "Hours before expiry", recommended: 24 }`.
  A select's recommendation must be one of its options.
- A text or number field shows the value in muted italics with **Use ⇥**,
  and Tab in the empty field takes it. A select's option and a yes or no
  wear a quiet "recommended" tag, as an option does since
  `inbox-recommended.md`.
- Nothing is pre-filled and Submit counts only what the reader filled in or
  took, which keeps the decision in `inbox-recommended.md` §5 that an answer
  is a deliberate press.

## 5. Shapes

What the agent posts:

```ts
post_to_inbox({
  key: string,
  title?: string,       // the first post under a key opens the thread
  body: string,         // the plan's Markdown; pictures by sandbox path
  ask?:
    | { type: "decide", options: Option[], multiple?: boolean, recommended?: string }
    | { type: "do", steps: string[] }
    | { type: "answer", fields?: Field[] },   // Field gains recommended?
  waits?: boolean,      // was needsReply; defaults by kind
})
withdraw_ask({ key, reason })
read_inbox()
```

A later post under the same key **adds a message** rather than replacing
the item. `reply_inbox` becomes a post with no ask, and `close_inbox_item`
becomes `withdraw_ask`; both old names stay served through the deployment
window (§6, step 6).

What a message is:

```ts
{
  id, author: "agent" | "member", member?,
  body: string,                  // `text` today, kept under that name on the wire
  files?: File[],                // pasted pictures, drawn inline
  ask?: Ask & { status: "open" | "answered" | "replaced" | "withdrawn" },
  answers?: { ask: MessageId, reply, choices?, values?, steps? },
  createdAt,
}
```

Today's types map onto it:

| Today | Proposed |
| --- | --- |
| `markdown`, `link`, `code`, `image` blocks | One message `body` |
| The thread's messages, the answer, the close reason | Messages; an answer is a reply with `answers`; a withdrawal settles the ask |
| `choice` | `decide` with options |
| `approval` | `decide` with two short options, drawn as buttons |
| `task` | `do` with steps |
| `form`, `text` | `answer` with fields, or without |
| `none` | No ask |

**Older desktops keep reading.** A desktop decodes the inbox with
`readServiceAnswer`, which fails the whole read where one item lacks a
required field, and an unknown response cannot be answered. So the service
keeps emitting every item's `title`, `blocks`, `response`, `needsReply`, and
`status`, as a view of its open ask: the asking message's body split into
blocks around its pictures and lone links, and the ask as the nearest v4
response (`decide` → `choice`, `do` → `task`, `answer` → `form` or `text`).
An older desktop's answer by revision is taken as the answer to the open
ask. Stored items read the other way: a v4 item is a thread whose first
message is its blocks joined in order, a link block becoming a lone link,
with its response as that message's ask.

**Chat asks stay as they are.** `chat-wire.ts` re-exports about twenty inbox
names and its asks use `inboxResponseSchema` as their own. The first wire
step forks those aliases, so chat's shapes and their goldens do not move.
Bringing chat asks onto the same ask is left for later.

## 6. The changes, in order

Each step ships alone and leaves older desktops and agents still running on
an earlier deployment working. A coding agent's turn keeps the code of the
deployment it started on for up to 25 hours (`TURN_ABANDON`), so the store
serves the old tools until then.

1. **A message renderer (panel, medium).** `TranscriptWords`, through
   `SentWords`, already draws the Inbox's Markdown and its thread's
   messages. Give it pictures from an item's attachments, on the model of
   `PlanPictures` (`plan-pictures.tsx`), side-by-side pairs, and lone-link
   cards, which nothing in the window draws yet. Draw today's Markdown
   blocks and thread messages through it.
2. **Wire v5, additive (features, medium).** Fork chat's aliases. Add the
   ask, the answers, a field's `recommended`, and an unknown-ask
   placeholder; add optional `ask` and `answers` to `inboxMessageSchema`;
   add the pure mapping of an ask onto a v4 response; move
   `INBOX_WIRE_VERSION` to 5 and record the new JSON-schema goldens.
3. **Expand the tables (database, small).** Nullable `inbox_message.ask`
   and `answers` (jsonb), and `inbox_item.open_ask_message_id`, generated
   with `pnpm db:generate`. Nothing is dropped and nothing is backfilled:
   `blocks`, `response`, and `needs_reply` stay `NOT NULL` and keep being
   written, because the old tools still post through them.
4. **The store writes both shapes (service, large).** A post appends an
   agent message and fills the item's own columns from its ask; the
   revision moves only when the open ask changes, so drafts, the window's
   pending answers, and an older desktop's answer stay keyed to it. An
   answer is a reply message that also fills the item's `answer`. Rows the
   old code wrote are read as threads (§5). An item is `open` while it has
   an open ask, which keeps the open-item limit, the badge, and the notices
   counting the same thing. Pictures in a body are read from the sandbox,
   kept as message attachments, and rewritten to an inbox attachment
   address, on the model of the plan's (`plan-attachment-link.ts`).
5. **Answering by ask (service and host, medium).** The message endpoint
   takes `answers`; the host's act and client carry it. A plain message
   still steers the agent with `inboxThreadMessage`, an answer with
   `inboxAnswerMessage`, so their lead lines and `inboxLineWords` stand.
6. **The agent's tools and instructions (service, medium), once step 4 is
   deployed.** The new `post_to_inbox` input and `withdraw_ask`;
   `reply_inbox` and `close_inbox_item` kept as aliases through the window;
   `read_inbox` answers with threads. The inbox section of `instructions.ts`
   and the tool descriptions say a message is one Markdown body with its
   pictures and links where they belong, which ends the order the old list
   taught. Its golden (`chat-off.json`) and the tests that read the
   descriptions move with it.
7. **The thread in the window (panel, large, in two PRs).** First the pane:
   each message through step 1's renderer, the ask's box with its answers
   (`ChoiceOptions` and `FormFields` reused, steps for `do`, recommended
   field values), the reply box that only replies until an answer is
   attached, and an item from an older service drawn from its legacy fields.
   Then the list and the rest: the row's preview and media from messages
   (`inboxMedia`, `inboxPreview`), `inbox-settling.ts`, the transcript's
   `post_to_inbox` row drawing both the old and the new input
   (`tool-call-model.ts`), and the changelog staging shot, which still names
   `INBOX_RESPONSE.TASK`.
8. **Contract, later (database, small).** Only once nothing writes the
   item's own columns as their source, and only for what no desktop still
   reads: the wire keeps emitting the legacy item fields.

## 7. Open questions

Each has the answer the show draws, which stands unless Dean says otherwise.

1. **Can a person make an ask?** Drawn: no. Agents ask and people reply,
   and a person asking a teammate is a later step.
2. **Who can answer?** Drawn: any member of the workspace, as today, and the
   stamp names who.
3. **Can an agent edit a message it posted?** Drawn: no. It only adds
   messages, so the thread is the history and a changed question is a new
   ask that replaces the old.
4. **Recommended values on fields** (§4): shown with Use ⇥, never filled
   in.
