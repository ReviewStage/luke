import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CONVERSATION_ENTRY_SPEAKER,
  CONVERSATION_THINKING_LABEL,
  ConversationClearButton,
  ConversationPanel,
  conversationEntryPresentation,
  thinkingElapsedLabel,
} from "./conversation-panel";

const NOW = Date.parse("2026-09-08T17:30:00.000Z");
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

test("conversation asks are shown as the developer's own words", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.TYPED_ASK), {
    speaker: CONVERSATION_ENTRY_SPEAKER.YOU,
    label: "You",
  });
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.SPOKEN_ASK), {
    speaker: CONVERSATION_ENTRY_SPEAKER.YOU,
    label: "You",
  });
});

test("Luke replies and announcements use the received-message side", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.REPLY), {
    speaker: CONVERSATION_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.ANNOUNCEMENT), {
    speaker: CONVERSATION_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
});

test("session actions remain quiet events between messages", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.ACTION), {
    speaker: CONVERSATION_ENTRY_SPEAKER.EVENT,
    label: "At your request",
  });
});

test("an action Luke took on his own judgment is the same quiet row under his own name, never the developer's request", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.OWN_ACTION), {
    speaker: CONVERSATION_ENTRY_SPEAKER.EVENT,
    label: "Luke, on his own judgment",
  });
});

test("an action draws as a row led by the mark of its kind, with no bubble and no copy", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ACTION,
          words: 'sent a message to "checkout-service": "please add tests"',
          recordedAt: NOW,
          action: { kind: ACTION_KIND.MESSAGE, runId: "run-1" },
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(markup, /class="conversation-entry" data-speaker="event" data-origin="ask"/);
  assert.match(markup, /<small class="visually-hidden">At your request<\/small>/);
  // The mark leads the words inside the row, and the stamp stands outside it.
  assert.match(
    markup,
    /<span class="conversation-action"><span class="conversation-action-mark" aria-hidden="true"><svg class="icon-button-glyph"/,
  );
  assert.match(markup, /<\/div><time class="conversation-time"/);
  assert.doesNotMatch(markup, /conversation-bubble|conversation-copy|conversation-turn/);
  // No identity and no provider on the action: the words end with no mark.
  assert.doesNotMatch(markup, /conversation-action-provider/);
  // A line an earlier build recorded without its kind keeps the mark's room and fills it with nothing.
  const unmarked = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.ACTION, words: 'opened "checkout-service"' }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(unmarked, /<span class="conversation-action-mark" aria-hidden="true"><\/span>/);
});

test("an action row is worded from its record and the roster, and from its recorded words when it cannot be", () => {
  const entry = {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: 'sent a message to "checkout-service": "please add tests"',
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
    action: { kind: ACTION_KIND.MESSAGE, runId: "run-1", text: "please add tests" },
  };
  const render = (sessions: Parameters<typeof ConversationPanel>[0]["sessions"]) =>
    renderToStaticMarkup(
      createElement(ConversationPanel, {
        entries: [entry],
        sessions,
        now: NOW,
        ask: async () => undefined,
        onAskEngaged: () => undefined,
      }),
    );
  const composed = render([
    {
      id: "session-a",
      title: "checkout",
      providerId: "claude-code",
      provider: "Claude Code",
      applications: [],
      detail: "Working",
      urgency: "urgency-working",
      label: "Working",
      location: "local",
      lastActivityAt: 0,
      openable: false,
      canMessage: true,
      actions: [],
      hasChange: false,
    },
  ]);
  // The session by its current name, set apart, in a sentence the build wrote.
  assert.match(
    composed,
    /<span class="conversation-words"><span>Sent a message to <\/span><span class="conversation-action-name">checkout<\/span><span>: &quot;please add tests&quot;<\/span><\/span>/,
  );
  assert.doesNotMatch(composed, /checkout-service|class="markdown/);
  // Without the session on the roster, the words recorded at the time stand.
  const recorded = render([]);
  assert.match(
    recorded,
    /<div class="markdown conversation-words"><p>sent a message to &quot;checkout-service&quot;/,
  );
});

test("an action row ends on the mark of the provider it reached", () => {
  const render = (entry: Parameters<typeof ConversationPanel>[0]["entries"][number]) =>
    renderToStaticMarkup(
      createElement(ConversationPanel, {
        entries: [entry],
        now: NOW,
        ask: async () => undefined,
        onAskEngaged: () => undefined,
      }),
    );
  // An action on a session wears the session's own provider.
  const onSession = render({
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: 'sent a message to "checkout-service": "please add tests"',
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
    action: { kind: ACTION_KIND.MESSAGE, runId: "run-1" },
  });
  assert.match(
    onSession,
    /<\/div><span class="conversation-action-provider" aria-hidden="true"><svg class="provider-mark" data-mark="claude-code"/,
  );
  // A creation has no session, so its line names the provider it asked.
  const creation = render({
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: 'asked conductor to create a workspace named "Notch panel clipping"',
    action: { kind: ACTION_KIND.CREATE_WORKSPACE, runId: "run-2", providerId: "conductor" },
  });
  assert.match(creation, /class="provider-mark" data-mark="conductor"/);
});

test("an action Luke took on his own is signed with his face and never wears a reply's bubble", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.OWN_ACTION,
          words: 'ran "Retry" on "checkout-service"',
          action: { kind: ACTION_KIND.CONTROL, runId: "wake-1" },
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(markup, /data-speaker="event" data-origin="own"/);
  assert.match(markup, /<small class="visually-hidden">Luke, on his own judgment<\/small>/);
  assert.match(
    markup,
    /class="conversation-action-mark" aria-hidden="true"><svg class="luke-face"/,
  );
  assert.doesNotMatch(markup, /data-speaker="luke"|conversation-copy/);
});

test("the actions one run carried fold under a count once the run ends, and stand open while it runs", () => {
  const run = {
    runId: "run-1",
    submissionId: "sub-1",
    origin: "typed",
    question: "ship it and open it",
    revision: 1,
    acceptedAt: 1,
    performedActions: 0,
    unknownActions: 0,
  } as const;
  const render = (status: "running" | "succeeded") =>
    renderToStaticMarkup(
      createElement(ConversationPanel, {
        entries: [
          {
            kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
            words: "ship it and open it",
            requestId: "run-1",
          },
          {
            kind: CONVERSATION_ENTRY_KIND.ACTION,
            words: 'sent a message to "checkout-service": "ship it"',
            action: { kind: ACTION_KIND.MESSAGE, runId: "run-1" },
          },
          {
            kind: CONVERSATION_ENTRY_KIND.ACTION,
            words: 'opened "checkout-service"',
            action: { kind: ACTION_KIND.OPEN, runId: "run-1" },
          },
          { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Done.", requestId: "run-1" },
        ],
        requests: [{ ...run, status }],
        now: NOW,
        ask: async () => undefined,
        onAskEngaged: () => undefined,
      }),
    );
  const working = render("running");
  assert.match(working, /<li class="conversation-turn" data-open="true">/);
  assert.match(
    working,
    /class="conversation-turn-toggle" aria-expanded="true" aria-controls="([^"]+)"/,
  );
  assert.match(working, /<span>2 actions<\/span>/);
  assert.equal(working.match(/class="conversation-action"/g)?.length, 2);
  assert.doesNotMatch(working, /hidden=""/);

  const settled = render("succeeded");
  assert.match(settled, /<li class="conversation-turn">/);
  assert.match(settled, /aria-expanded="false"/);
  assert.match(settled, /<ol id="[^"]+" class="conversation-turn-actions" hidden="">/);
  // The ask before the turn and the reply after it stay lines of their own.
  assert.match(settled, /data-speaker="you"/);
  assert.match(settled, /data-speaker="luke"/);
  // The toggle names the list it folds.
  const controls = settled.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(controls);
  assert.match(settled, new RegExp(`<ol id="${controls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("a turn Luke opened himself stands open while it is the newest line, and folds once anything follows", () => {
  const retried = {
    kind: CONVERSATION_ENTRY_KIND.OWN_ACTION,
    words: 'ran "Retry" on "amber-shoal"',
    action: { kind: ACTION_KIND.CONTROL, runId: "wake-1" },
  };
  const opened = {
    kind: CONVERSATION_ENTRY_KIND.OWN_ACTION,
    words: 'opened "amber-shoal"',
    action: { kind: ACTION_KIND.OPEN, runId: "wake-1" },
  };
  const render = (entries: readonly ConversationEntry[], live: readonly ConversationEntry[] = []) =>
    renderToStaticMarkup(
      createElement(ConversationPanel, {
        entries,
        live,
        now: NOW,
        ask: async () => undefined,
        onAskEngaged: () => undefined,
      }),
    );
  // No request record stands for a wake, so the tail is the only sign the turn is still going.
  assert.match(render([retried, opened]), /<li class="conversation-turn" data-open="true">/);
  const announced = render([
    retried,
    opened,
    { kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "I retried amber-shoal." },
  ]);
  assert.match(announced, /<li class="conversation-turn">/);
  // The announcement still being said counts as something after it.
  const speaking = render(
    [retried, opened],
    [{ kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "I retried" }],
  );
  assert.match(speaking, /<li class="conversation-turn">/);
});

test("a turn of one action is the row it is, and two runs' actions never fold together", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ACTION,
          words: 'opened "checkout-service"',
          action: { kind: ACTION_KIND.OPEN, runId: "run-1" },
        },
        {
          kind: CONVERSATION_ENTRY_KIND.ACTION,
          words: 'opened "lisbon-v2"',
          action: { kind: ACTION_KIND.OPEN, runId: "run-2" },
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.doesNotMatch(markup, /conversation-turn/);
  assert.equal(markup.match(/class="conversation-action"/g)?.length, 2);
});

test("an announcement shows its spoken transcript", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
          words: "Checkout is ready.",
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /data-speaker="luke"/);
  assert.match(markup, />Checkout is ready\.<\/p>/);
  assert.doesNotMatch(markup, /provider:|running:/);
});

test("a reply keeps its lines through the thread and draws as the Markdown it was written in", () => {
  const entries = appendConversationThreadEntry([], {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Two things:\n\n- **lisbon-v2** is waiting\n- `deploy` finished\n\n```sh\ngit push\n```",
  });
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries,
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /<p>Two things:<\/p>/);
  assert.match(markup, /<li><strong>lisbon-v2<\/strong> is waiting<\/li>/);
  assert.match(markup, /<li><code>deploy<\/code> finished<\/li>/);
  assert.match(markup, /<pre><code class="language-sh">git push\n<\/code><\/pre>/);
});

test("a recorded entry keeps its local time at the row's edge, outside the bubble", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.REPLY,
          words: "Checkout is ready.",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  // The stamp is the row's last child, after the message closes: it stands in
  // the column the thread's sideways scroll brings in, never on a line of the
  // bubble's own, and the thread scrolls on two nested scrollers, one per axis.
  assert.match(
    markup,
    /<\/div><time class="conversation-time" dateTime="2026-01-02T03:04:00.000Z">[^<]+<\/time><\/li>/,
  );
  assert.match(
    markup,
    /<div class="conversation-scroll"><div class="conversation-pull"><ol class="conversation-list">/,
  );
});

test("the conversation is blocked from optional panel recordings", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "private words" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /class="conversation-view ph-no-capture"/);
  assert.match(markup, /<small class="visually-hidden">You<\/small>/);
  assert.doesNotMatch(markup, /stays in memory|typed or spoken exchange/);
});

test("messages offer a copy control while quiet events offer none", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping." },
        { kind: CONVERSATION_ENTRY_KIND.ACTION, words: "Sent to Codex." },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 2);
  assert.match(markup, /aria-label="Copy message"/);
  assert.match(markup, /icon-button-glyph/);
});

test("a line still being said draws as the bubble it will settle into", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
          words: "ship it",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      live: [{ kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Checkout is" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /data-streaming="true"/);
  assert.match(markup, />Checkout is</);
  // Copying half a sentence serves nobody: the settled ask keeps the one
  // copy control, and a line not yet recorded wears no timestamp.
  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 1);
  assert.equal(markup.match(/class="conversation-time"/g)?.length, 1);
});

test("words still arriving stand the thread up without a settled line", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      live: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Looking now." }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, />Looking now\.</);
  assert.doesNotMatch(markup, />No messages yet</);
  // The clear rides the tab bar beside the panel, never a row of the thread's own.
  assert.doesNotMatch(markup, /conversation-clear/);
});

test("the empty conversation reports only its state", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, />No messages yet</);
  assert.doesNotMatch(markup, /conversation-clear|next typed|stays in memory/);
});

test("the clear control opens as one quiet button, its confirmation not yet asked", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationClearButton, { onClear: () => undefined }),
  );

  assert.match(markup, /<span class="conversation-clear-controls">/);
  assert.match(markup, /class="conversation-clear"[^>]*>Clear</);
  // The second press's words, and the way to stand down, arrive only with the
  // first press.
  assert.doesNotMatch(markup, /conversation-clear-cancel|Clear conversation/);
});

test("the composer stands at the foot of the thread, empty or not", () => {
  const empty = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  // "What needs me?" is worth typing before any line has been recorded.
  assert.match(empty, />No messages yet</);
  assert.match(empty, /id="ask-luke-input"/);

  const threaded = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      askShortcut: "Alt+Space",
    }),
  );
  // One composer, after the list, inside the subtree recordings never see.
  assert.equal(threaded.match(/id="ask-luke-input"/g)?.length, 1);
  assert.ok(threaded.indexOf("</ol>") < threaded.indexOf('id="ask-luke-input"'));
  assert.match(threaded, /aria-keyshortcuts="Alt\+Space"/);
});

test("a run still going draws Luke's turn at the tail, with no control of its own", () => {
  const run = {
    runId: "run-1",
    submissionId: "sub-1",
    origin: "typed",
    question: "ship it",
    revision: 1,
    acceptedAt: NOW,
    performedActions: 0,
    unknownActions: 0,
  } as const;
  const render = (status: "running" | "succeeded", now = NOW) =>
    renderToStaticMarkup(
      createElement(ConversationPanel, {
        entries: [
          { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it", requestId: "run-1" },
        ],
        requests: [{ ...run, status }],
        now,
        ask: async () => undefined,
        onAskEngaged: () => undefined,
        onStop: () => undefined,
      }),
    );
  const pending = render("running");
  // Luke's side, after the ask, wearing the success hop on repeat, with the
  // reader's line as the live region and nothing to press.
  assert.match(pending, /data-speaker="luke" data-thinking="true"/);
  assert.match(pending, /<\/li><li class="conversation-entry" data-speaker="luke" data-thinking/);
  assert.match(pending, /class="conversation-thinking"/);
  assert.match(pending, /data-motion="success" data-repeat="true"/);
  assert.match(pending, new RegExp(`role="status">${CONVERSATION_THINKING_LABEL}`));
  assert.doesNotMatch(pending, /conversation-cancel|conversation-pending|Cancel/);
  // Under ten seconds the wait says nothing of its age; past it, how long.
  assert.doesNotMatch(pending, /Still thinking/);
  assert.match(render("running", NOW + 71_000), /Still thinking · 1:11/);
  // Still inside the blocked subtree: a wait is drawn beside words a recording never sees.
  assert.match(pending, /ph-no-capture/);
  // The composer's disc is the stop, in both of its states.
  assert.match(pending, /data-turn="luke"/);
  assert.match(pending, /aria-label="Stop Luke&#x27;s reply"/);
  const settled = render("succeeded");
  assert.doesNotMatch(settled, /conversation-thinking|data-thinking/);
  // A spoken ask is the same lifecycle: its transcript, tied to its run, waits too.
  const spoken = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: "ship it", requestId: "run-1" }],
      requests: [{ ...run, origin: "spoken", status: "running" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(spoken, /class="conversation-thinking"/);
});

test("the wait's age is worded once it is worth a word", () => {
  assert.equal(thinkingElapsedLabel(NOW, NOW + 9_999), undefined);
  assert.equal(thinkingElapsedLabel(NOW, NOW + 10_000), "Still thinking · 0:10");
  assert.equal(thinkingElapsedLabel(NOW, NOW + 605_000), "Still thinking · 10:05");
});

test("a line that followed a long silence is dated over it, in the quiet event voice", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it", recordedAt: NOW - 9 * DAY_MS },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping.", recordedAt: NOW - 9 * DAY_MS },
        {
          kind: CONVERSATION_ENTRY_KIND.ACTION,
          words: "Sent to Codex.",
          recordedAt: NOW - 2 * DAY_MS,
        },
        {
          kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
          words: "status?",
          recordedAt: NOW - HOUR_MS / 2,
        },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Quiet.", recordedAt: NOW - HOUR_MS / 4 },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  // The first recorded line is dated, then every line an hour or more after
  // the one before it; a reply half an hour on answers the ask and draws none.
  const breaks = [...markup.matchAll(/<li class="conversation-break">/g)];
  assert.equal(breaks.length, 3);
  assert.ok(
    markup.indexOf('<li class="conversation-break">') < markup.indexOf("conversation-entry"),
  );
  const dates = [...markup.matchAll(/dateTime="([^"]+)"[^>]*><strong>([^<]+)<\/strong>/g)].map(
    (match) => [match[1], match[2]],
  );
  assert.deepEqual(dates, [
    [
      new Date(NOW - 9 * DAY_MS).toISOString(),
      new Date(NOW - 9 * DAY_MS).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    ],
    [
      new Date(NOW - 2 * DAY_MS).toISOString(),
      new Date(NOW - 2 * DAY_MS).toLocaleDateString(undefined, { weekday: "long" }),
    ],
    [new Date(NOW - HOUR_MS / 2).toISOString(), "Today"],
  ]);
  // The date is the thread's own line, never a message: no bubble, no copy control.
  assert.match(
    markup,
    /<li class="conversation-break"><time class="conversation-break-time" dateTime="[^"]+"><strong>/,
  );
  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 4);
});

test("lines with no stamp draw no date over them", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping." },
      ],
      live: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Still" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.doesNotMatch(markup, /conversation-break/);
});
