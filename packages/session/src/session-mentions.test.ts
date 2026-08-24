import assert from "node:assert/strict";
import test from "node:test";
import {
  MAXIMUM_MENTIONED_SESSIONS,
  mentionedSessions,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_MENTION_KIND,
  SESSION_STATUS,
  type Session,
  type SessionProvider,
} from "@sidecar/session";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };

function session(
  provider: SessionProvider,
  providerSessionId: string,
  title: string,
  overrides: {
    observedAt?: number;
    workspace?: { providerWorkspaceId: string; name?: string };
  } = {},
): Session {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title,
    status: SESSION_STATUS.WORKING,
    observedAt: overrides.observedAt ?? 100,
    detail: {},
  };
  if (overrides.workspace) observation.workspace = overrides.workspace;
  return normalizeSession(provider, observation);
}

test("names the sessions the reply mentions, in the order they are heard", () => {
  const roster = [
    session(claude, "a", "Checkout service"),
    session(conductor, "b", "Payments schema"),
    session(conductor, "c", "Docs sweep"),
  ];
  assert.deepEqual(
    mentionedSessions(
      "Payments schema is still migrating, and Checkout service just finished.",
      roster,
    ),
    [
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "conductor", providerSessionId: "b" },
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "claude-code", providerSessionId: "a" },
    ],
  );
});

test("matches case aside, but only a whole title with its own edges", () => {
  const roster = [session(claude, "a", "Checkout service")];
  assert.deepEqual(mentionedSessions('I paused "checkout service" for you.', roster), [
    { kind: SESSION_MENTION_KIND.SESSION, providerId: "claude-code", providerSessionId: "a" },
  ]);
  // Inside a longer word is not a mention of this session.
  assert.deepEqual(mentionedSessions("The precheckout services queue is empty.", roster), []);
});

test("an empty or absent caption mentions nothing", () => {
  const roster = [session(claude, "a", "Checkout service")];
  assert.deepEqual(mentionedSessions(undefined, roster), []);
  assert.deepEqual(mentionedSessions("", roster), []);
});

test("a name too short to be attributable earns no chip", () => {
  const roster = [
    session(claude, "a", "Fix"),
    session(conductor, "b", "Long enough title", {
      workspace: { providerWorkspaceId: "ws-1", name: "два" },
    }),
  ];
  assert.deepEqual(mentionedSessions("I can fix that in два for you.", roster), []);
});

test("a title shared by two observed sessions names neither", () => {
  const roster = [
    session(claude, "a", "Untitled session"),
    session(conductor, "b", "untitled session"),
    session(conductor, "c", "Docs sweep"),
  ];
  assert.deepEqual(
    mentionedSessions("The untitled session is waiting, and Docs sweep finished.", roster),
    [{ kind: SESSION_MENTION_KIND.SESSION, providerId: "conductor", providerSessionId: "c" }],
  );
});

test("a workspace named whole resolves to its most recently observed chat", () => {
  const roster = [
    session(conductor, "older-chat", "amber-shoal", {
      observedAt: 100,
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
    session(conductor, "fresher-chat", "gentle-cove", {
      observedAt: 200,
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
  ];
  assert.deepEqual(mentionedSessions("lisbon-v2 is packaging the macOS build.", roster), [
    {
      kind: SESSION_MENTION_KIND.WORKSPACE,
      providerId: "conductor",
      providerSessionId: "fresher-chat",
    },
  ]);
});

test("a workspace named beside its own chat is absorbed by the chat's mention", () => {
  const roster = [
    session(conductor, "older-chat", "amber-shoal", {
      observedAt: 100,
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
    session(conductor, "fresher-chat", "gentle-cove", {
      observedAt: 200,
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
  ];
  // The named chat is the precise way in, however the two are ordered — the
  // freshest-chat fallback must not open gentle-cove out of a sentence that
  // picked amber-shoal.
  const chipForChat = [
    {
      kind: SESSION_MENTION_KIND.SESSION,
      providerId: "conductor",
      providerSessionId: "older-chat",
    },
  ];
  assert.deepEqual(
    mentionedSessions("amber-shoal, in lisbon-v2, is packaging.", roster),
    chipForChat,
  );
  assert.deepEqual(
    mentionedSessions("In lisbon-v2, amber-shoal is packaging.", roster),
    chipForChat,
  );
});

test("naming a workspace and two of its chats draws one chip per chat", () => {
  const roster = [
    session(conductor, "a", "amber-shoal", {
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
    session(conductor, "b", "gentle-cove", {
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
  ];
  assert.deepEqual(
    mentionedSessions("In lisbon-v2, amber-shoal is packaging and gentle-cove finished.", roster),
    [
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "conductor", providerSessionId: "a" },
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "conductor", providerSessionId: "b" },
    ],
  );
});

test("an absorbed workspace frees its slot under the cap", () => {
  // Exactly the cap's worth of titled sessions, plus a workspace mention that
  // is absorbed by its own chat's: every titled session keeps its chip, so
  // the absorbed workspace visibly spent no slot.
  const others = Array.from({ length: MAXIMUM_MENTIONED_SESSIONS - 1 }, (_, index) =>
    session(claude, `other-${index}`, `Errand number ${index}`),
  );
  const roster = [
    session(conductor, "a", "Alpha task", {
      workspace: { providerWorkspaceId: "ws-1", name: "lisbon-v2" },
    }),
    ...others,
  ];
  const spoken = mentionedSessions(
    `lisbon-v2's Alpha task, then ${others.map((other) => other.title).join(", then ")}.`,
    roster,
  );
  assert.deepEqual(
    spoken.map((mention) => mention.providerSessionId),
    ["a", ...others.map((other) => other.providerSessionId)],
  );
});

test("a chat of another workspace absorbs nothing", () => {
  const roster = [
    session(conductor, "a", "amber-shoal", {
      workspace: { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" },
    }),
    session(conductor, "b", "quiet-reef", {
      workspace: { providerWorkspaceId: "ws-porto", name: "porto-novo" },
    }),
  ];
  assert.deepEqual(mentionedSessions("amber-shoal is packaging; porto-novo is idle.", roster), [
    { kind: SESSION_MENTION_KIND.SESSION, providerId: "conductor", providerSessionId: "a" },
    { kind: SESSION_MENTION_KIND.WORKSPACE, providerId: "conductor", providerSessionId: "b" },
  ]);
});

test("a workspace name shared by two distinct workspaces names neither", () => {
  const roster = [
    session(conductor, "a", "amber-shoal", {
      workspace: { providerWorkspaceId: "ws-1", name: "lisbon-v2" },
    }),
    session(claude, "b", "gentle-cove", {
      workspace: { providerWorkspaceId: "ws-1", name: "lisbon-v2" },
    }),
  ];
  assert.deepEqual(mentionedSessions("lisbon-v2 is packaging.", roster), []);
});

test("a name that is both a title and a workspace's stands for neither", () => {
  const roster = [
    session(claude, "solo", "lisbon-v2"),
    session(conductor, "chat", "amber-shoal", {
      workspace: { providerWorkspaceId: "ws-1", name: "lisbon-v2" },
    }),
  ];
  assert.deepEqual(mentionedSessions("lisbon-v2 is packaging.", roster), []);
});

test("mentions past the cap are dropped from the tail of the reply", () => {
  const roster = Array.from({ length: MAXIMUM_MENTIONED_SESSIONS + 1 }, (_, index) =>
    session(claude, `chat-${index}`, `Errand number ${index}`),
  );
  const spoken = mentionedSessions(`${roster.map((chat) => chat.title).join(", then ")}.`, roster);
  assert.equal(spoken.length, MAXIMUM_MENTIONED_SESSIONS);
  assert.deepEqual(
    spoken.map((mention) => mention.providerSessionId),
    roster.slice(0, MAXIMUM_MENTIONED_SESSIONS).map((chat) => chat.providerSessionId),
  );
});

test("only the observed roster can be pointed at, whatever the words claim", () => {
  assert.deepEqual(mentionedSessions("Open the secret admin console now.", []), []);
});

test("a repeated mention counts once, at its first hearing", () => {
  const roster = [session(claude, "a", "Alpha task"), session(claude, "b", "Bravo task")];
  assert.deepEqual(
    mentionedSessions("Bravo task depends on Alpha task, so Bravo task waits.", roster),
    [
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "claude-code", providerSessionId: "b" },
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "claude-code", providerSessionId: "a" },
    ],
  );
});
