import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  fixtureSnapshot,
  normalizeSession,
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  SESSION_LOCATION,
  SESSION_STATE,
  SESSION_STATUS,
} from "@sidecar/core";
import {
  arrangeSessions,
  DEFAULT_SESSION_VIEW,
  displaySessions,
  observedAgoLabel,
  SESSION_FILTER,
  SESSION_SORT,
  sessionListRuns,
  sessionTally,
  tallyCaption,
  tallySummary,
} from "../src/renderer/session-model";
import type { AppBootstrap } from "../src/shared/contracts";

const CLAUDE_PROVIDER = { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" };
const CODEX_PROVIDER = { id: PROVIDER_ID.CODEX, displayName: "Codex" };

function bootstrap(fixtureMode: boolean): AppBootstrap {
  return {
    fixtureMode,
    fixture: fixtureSnapshot("smoke"),
  } as AppBootstrap;
}

function liveSession(
  provider: typeof CLAUDE_PROVIDER,
  providerSessionId: string,
  status: (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS],
  observedAt = 1_000,
) {
  return normalizeSession(provider, {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status,
    observedAt,
  });
}

const FIXTURE_SESSIONS = displaySessions(bootstrap(true), []);

test("the most urgent sessions are listed first in either data source", () => {
  const fixtureStates = displaySessions(bootstrap(true), []).map((session) => session.state);
  assert.deepEqual(fixtureStates, [
    SESSION_STATE.ATTENTION,
    SESSION_STATE.WORKING,
    SESSION_STATE.WORKING,
    SESSION_STATE.WORKING,
    SESSION_STATE.COMPLETE,
    SESSION_STATE.UNKNOWN,
  ]);

  const live = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.COMPLETE),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.WAITING),
  ]);
  assert.deepEqual(
    live.map((session) => session.id),
    ["codex-2", "claude-1", "codex-1"],
  );
  assert.equal(live[0]?.state, SESSION_STATE.ATTENTION);
  assert.equal(live[0]?.providerId, PROVIDER_ID.CODEX);
});

test("a row carries where its session runs, from either data source", () => {
  const fixture = new Map(
    displaySessions(bootstrap(true), []).map((session) => [session.id, session.location]),
  );

  assert.equal(fixture.get("cursor-agent"), SESSION_LOCATION.CLOUD);
  assert.equal(fixture.get("conductor-chat-tidy"), SESSION_LOCATION.CLOUD);
  assert.equal(fixture.get("codex-bootstrap"), SESSION_LOCATION.LOCAL);

  const live = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-cloud",
      title: "Session codex-cloud",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      location: SESSION_LOCATION.CLOUD,
    }),
    liveSession(CLAUDE_PROVIDER, "claude-here", SESSION_STATUS.WORKING),
  ]);

  assert.equal(live[0]?.location, SESSION_LOCATION.CLOUD);
  assert.equal(live[1]?.location, SESSION_LOCATION.LOCAL);
});

test("a row is a control only where its provider gave an address", () => {
  const live = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-addressed",
      title: "Session codex-addressed",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { link: "codex://threads/codex-addressed" },
    }),
    liveSession(CLAUDE_PROVIDER, "claude-unaddressed", SESSION_STATUS.WORKING),
  ]);

  assert.equal(live.find((session) => session.id === "codex-addressed")?.openable, true);
  assert.equal(live.find((session) => session.id === "claude-unaddressed")?.openable, false);

  // A fixture stands for sessions that are not on the machine drawing them, so
  // no fixture row is ever a control however the panel is being run.
  assert.equal(
    FIXTURE_SESSIONS.every((session) => session.openable === false),
    true,
  );
});

// The sentence under the title is the one place the row states what is
// happening — there is no chip at the other end — so a provider that reported
// nothing must still leave the row reading as Working or Complete.
test("the line under the title says the state when the provider said nothing", () => {
  const [bare] = displaySessions(bootstrap(false), [
    liveSession(CLAUDE_PROVIDER, "claude-quiet", SESSION_STATUS.WORKING),
  ]);
  assert.equal(bare?.detail, "Working");
  assert.equal(bare?.detail, bare?.label);

  const [spoken] = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-busy",
      title: "Session codex-busy",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { activity: "Running tests" },
    }),
  ]);
  assert.equal(spoken?.detail, "Running tests");

  // The fixture's silent row proves the same fallback in the visual evidence.
  const conductor = FIXTURE_SESSIONS.find((session) => session.id === "conductor-chat-tidy");
  assert.equal(conductor?.detail, "Complete");
});

test("a row carries the identifiers that tell it from its neighbours", () => {
  const [live] = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-checkout",
      title: "Session codex-checkout",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { repository: "luke", branch: "dean/session-rows", model: "gpt-5.6-luna" },
    }),
  ]);
  assert.equal(live?.repository, "luke");
  assert.equal(live?.branch, "dean/session-rows");
  assert.equal(live?.model, "gpt-5.6-luna");

  // The fixture keeps one row with a repository and no branch, so the surface's
  // fallback line stays visible in the evidence.
  const devin = FIXTURE_SESSIONS.find((session) => session.id === "devin-session");
  assert.equal(devin?.branch, undefined);
  assert.equal(devin?.repository, "sidecar-native");
});

// The label answers "is this thing alive", so it reports the coarsest unit
// that has begun rather than telling time. A timestamp ahead of the clock is
// clock skew, not the future, and reads as Now.
test("how long ago a session was seen is worded by the unit that has begun", () => {
  const minute = 60_000;
  const now = 100 * 24 * 60 * minute;

  assert.equal(observedAgoLabel(now, now), "Now");
  assert.equal(observedAgoLabel(now - 59_000, now), "Now");
  assert.equal(observedAgoLabel(now + minute, now), "Now");
  assert.equal(observedAgoLabel(now - minute, now), "1m");
  assert.equal(observedAgoLabel(now - 59 * minute, now), "59m");
  assert.equal(observedAgoLabel(now - 60 * minute, now), "1h");
  assert.equal(observedAgoLabel(now - 23 * 60 * minute, now), "23h");
  assert.equal(observedAgoLabel(now - 24 * 60 * minute, now), "1d");
  assert.equal(observedAgoLabel(now - 3 * 24 * 60 * minute, now), "3d");
});

test("a speaking disposition needs a person even while the session works", () => {
  const speaking = normalizeSession(
    CLAUDE_PROVIDER,
    {
      providerSessionId: "claude-speaking",
      title: "Speaking session",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
    },
    { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, decidedAt: 1_000 },
  );

  const [session] = displaySessions(bootstrap(false), [speaking]);
  assert.equal(session?.state, SESSION_STATE.ATTENTION);
});

test("the tally counts per state and per provider", () => {
  const tally = sessionTally(displaySessions(bootstrap(true), []));

  assert.deepEqual(
    { ...tally, providers: undefined },
    {
      total: 6,
      attention: 1,
      // Named as well as counted: Luke's face reacts to a session that has just
      // started asking, which the count alone cannot report.
      attentionIds: ["claude-review"],
      working: 3,
      complete: 1,
      idle: 1,
      state: SESSION_STATE.ATTENTION,
      providers: undefined,
    },
  );
  // Providers follow the order their most urgent session takes, so Conductor's
  // working chat seats it ahead of Cursor's older one and Devin's suspended
  // session — and its two chats count as two sessions under one mark. Five is
  // one more than the wings hold, so the fixture also proves the remainder is
  // counted rather than dropped.
  assert.deepEqual(tally.providers, [
    { providerId: PROVIDER_ID.CLAUDE_CODE, provider: "Claude Code", total: 1, attention: 1 },
    { providerId: PROVIDER_ID.CODEX, provider: "Codex", total: 1, attention: 0 },
    { providerId: PROVIDER_ID.CONDUCTOR, provider: "Conductor", total: 2, attention: 0 },
    { providerId: PROVIDER_ID.CURSOR, provider: "Cursor", total: 1, attention: 0 },
    { providerId: PROVIDER_ID.DEVIN, provider: "Devin", total: 1, attention: 0 },
  ]);
});

// The wing's marks and the rows are two drawings of the same order, so
// choosing the other sort re-seats the providers with the sessions: a mark
// that stayed put while the rows re-sorted would name the top row's agent
// wrong. The counts are counts, and no ordering may change them.
test("the providers re-seat with the rows when the other sort is chosen", () => {
  const recent = sessionTally(FIXTURE_SESSIONS, SESSION_SORT.RECENCY);

  assert.deepEqual(
    recent.providers.map((provider) => provider.providerId),
    [
      PROVIDER_ID.CONDUCTOR,
      PROVIDER_ID.CODEX,
      PROVIDER_ID.CLAUDE_CODE,
      PROVIDER_ID.CURSOR,
      PROVIDER_ID.DEVIN,
    ],
  );
  assert.deepEqual(
    { ...recent, providers: undefined },
    { ...sessionTally(FIXTURE_SESSIONS), providers: undefined },
  );
});

test("the badge state follows the most urgent session", () => {
  const working = sessionTally(
    displaySessions(bootstrap(false), [liveSession(CODEX_PROVIDER, "a", SESSION_STATUS.WORKING)]),
  );
  const complete = sessionTally(
    displaySessions(bootstrap(false), [liveSession(CODEX_PROVIDER, "a", SESSION_STATUS.COMPLETE)]),
  );
  const empty = sessionTally([]);

  assert.equal(working.state, SESSION_STATE.WORKING);
  assert.equal(complete.state, SESSION_STATE.COMPLETE);
  assert.equal(empty.state, SESSION_STATE.UNKNOWN);
});

test("the caption names its own number so the count is never misread", () => {
  const tally = sessionTally(displaySessions(bootstrap(true), []));

  assert.equal(tallyCaption(tally), "1 needs you");
  assert.equal(tallySummary(tally), "6 sessions tracked, 1 needing you");
  assert.equal(tallyCaption({ ...tally, attention: 2 }), "2 need you");
  assert.equal(tallyCaption({ ...tally, attention: 0, working: 3 }), "3 working");
  assert.equal(tallyCaption({ ...tally, attention: 0, working: 0 }), "1 complete");
  assert.equal(tallyCaption({ ...tally, attention: 0, working: 0, complete: 0 }), "tracked");
  assert.equal(tallyCaption(sessionTally([])), "none tracked");
  assert.equal(tallySummary(sessionTally([])), "No sessions tracked");
});

test("the filters offered run from everything to one agent, counted", () => {
  const list = arrangeSessions(FIXTURE_SESSIONS, DEFAULT_SESSION_VIEW);

  assert.deepEqual(list.options, [
    { filter: SESSION_FILTER.ALL, label: "All", count: 6 },
    { filter: SESSION_FILTER.LOCAL, label: "Local", count: 2 },
    { filter: SESSION_FILTER.CLOUD, label: "Cloud", count: 4 },
    {
      filter: PROVIDER_ID.CLAUDE_CODE,
      label: "Claude Code",
      count: 1,
      providerId: PROVIDER_ID.CLAUDE_CODE,
    },
    { filter: PROVIDER_ID.CODEX, label: "Codex", count: 1, providerId: PROVIDER_ID.CODEX },
    {
      filter: PROVIDER_ID.CONDUCTOR,
      label: "Conductor",
      count: 2,
      providerId: PROVIDER_ID.CONDUCTOR,
    },
    { filter: PROVIDER_ID.CURSOR, label: "Cursor", count: 1, providerId: PROVIDER_ID.CURSOR },
    { filter: PROVIDER_ID.DEVIN, label: "Devin", count: 1, providerId: PROVIDER_ID.DEVIN },
  ]);
});

// The fixture above covers the agents it happens to contain. Every agent the
// registry knows has to be reachable, including whichever one was added last:
// an agent with a session on screen and no chip of its own is a row nobody can
// narrow to, and one whose chip does not match its sessions is worse — a filter
// that empties a list the capsule is still counting.
test("every agent this build knows can be narrowed down to", () => {
  const sessions = displaySessions(
    bootstrap(false),
    PROVIDER_ID_LIST.map((providerId, index) =>
      normalizeSession(
        { id: providerId, displayName: providerId },
        {
          providerSessionId: providerId,
          title: providerId,
          status: SESSION_STATUS.WORKING,
          observedAt: 1_000 + index,
        },
      ),
    ),
  );
  const offered = arrangeSessions(sessions, DEFAULT_SESSION_VIEW).options;

  assert.deepEqual(
    offered.filter((option) => option.providerId !== undefined).map((option) => option.filter),
    [...PROVIDER_ID_LIST],
  );
  for (const providerId of PROVIDER_ID_LIST) {
    const narrowed = arrangeSessions(sessions, { ...DEFAULT_SESSION_VIEW, filter: providerId });
    assert.equal(narrowed.filter, providerId);
    assert.deepEqual(
      narrowed.sessions.map((session) => session.id),
      [providerId],
    );
  }
});

test("a level with one answer is not offered as a choice", () => {
  // Two agents, both local: which agent is a real question, where it runs is not.
  const local = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
  ]);
  assert.deepEqual(
    arrangeSessions(local, DEFAULT_SESSION_VIEW).options.map((option) => option.filter),
    [SESSION_FILTER.ALL, PROVIDER_ID.CLAUDE_CODE, PROVIDER_ID.CODEX],
  );

  // One agent, several sessions: nothing below All is a question at all.
  const alone = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.COMPLETE),
  ]);
  assert.deepEqual(
    arrangeSessions(alone, DEFAULT_SESSION_VIEW).options.map((option) => option.filter),
    [SESSION_FILTER.ALL],
  );

  assert.deepEqual(arrangeSessions([], DEFAULT_SESSION_VIEW).options, []);
});

test("a filter narrows the list without changing what is tracked", () => {
  const cloud = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filter: SESSION_FILTER.CLOUD,
  });
  const agent = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filter: PROVIDER_ID.CLAUDE_CODE,
  });

  assert.deepEqual(
    cloud.sessions.map((session) => session.id),
    ["conductor-chat-package", "conductor-chat-tidy", "cursor-agent", "devin-session"],
  );
  assert.deepEqual(
    agent.sessions.map((session) => session.id),
    ["claude-review"],
  );
  assert.equal(cloud.filter, SESSION_FILTER.CLOUD);
  assert.equal(cloud.total, 6);
  assert.equal(agent.total, 6);
});

test("a filter whose last session has left falls back to showing everything", () => {
  const noCloud = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.COMPLETE),
  ]);

  for (const filter of [SESSION_FILTER.CLOUD, PROVIDER_ID.CURSOR]) {
    const list = arrangeSessions(noCloud, { ...DEFAULT_SESSION_VIEW, filter });
    assert.equal(list.filter, SESSION_FILTER.ALL);
    assert.equal(list.sessions.length, 2);
  }
});

// A spoken ask can narrow to the only agent there is, which no chip offers —
// chips appear only once there is a second value to tell apart. The narrowing
// must survive anyway: it hides nothing while it is the only agent, and the
// moment another appears the list stays on what the developer asked to watch
// rather than widening out from under them.
test("a filter that still matches survives even when no chip offers it", () => {
  const codexOnly = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.COMPLETE),
  ]);
  const narrowed = arrangeSessions(codexOnly, {
    ...DEFAULT_SESSION_VIEW,
    filter: PROVIDER_ID.CODEX,
  });

  assert.equal(narrowed.filter, PROVIDER_ID.CODEX);
  assert.equal(narrowed.sessions.length, 2);
  // No second agent yet, so no chips are offered — the filter outlives them.
  assert.deepEqual(
    narrowed.options.map((option) => option.filter),
    [SESSION_FILTER.ALL],
  );

  const withClaude = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.COMPLETE),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
  ]);
  const still = arrangeSessions(withClaude, {
    ...DEFAULT_SESSION_VIEW,
    filter: PROVIDER_ID.CODEX,
  });

  assert.equal(still.filter, PROVIDER_ID.CODEX);
  assert.deepEqual(
    still.sessions.map((session) => session.providerId),
    [PROVIDER_ID.CODEX, PROVIDER_ID.CODEX],
  );
});

// The panel stores the filter this returns rather than only drawing it, so a
// filter that emptied is dropped instead of lying dormant behind an All that
// only looks chosen. That write is safe exactly while arranging the result
// again changes nothing.
test("the filter the list settles on is one it would settle on again", () => {
  const oneAgent = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
  ]);

  for (const sessions of [oneAgent, []]) {
    const first = arrangeSessions(sessions, {
      ...DEFAULT_SESSION_VIEW,
      filter: PROVIDER_ID.CURSOR,
    });
    const second = arrangeSessions(sessions, { ...DEFAULT_SESSION_VIEW, filter: first.filter });

    assert.equal(first.filter, SESSION_FILTER.ALL);
    assert.equal(second.filter, first.filter);
  }
});

test("a session from an unknown agent is counted but never filed under a guess", () => {
  const unknown = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(
      { id: "someone-else", displayName: "Someone Else" },
      "other-1",
      SESSION_STATUS.WORKING,
    ),
  ]);
  const list = arrangeSessions(unknown, DEFAULT_SESSION_VIEW);

  assert.equal(list.options.length, 1);
  assert.deepEqual(list.options[0], { filter: SESSION_FILTER.ALL, label: "All", count: 2 });
  assert.equal(list.sessions.length, 2);
});

test("the two orderings answer different questions about the same sessions", () => {
  const urgent = arrangeSessions(FIXTURE_SESSIONS, DEFAULT_SESSION_VIEW);
  const recent = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    sort: SESSION_SORT.RECENCY,
  });

  // In either order Conductor's two chats sit together: under urgency the
  // working chat earns the seat and its finished sibling follows; under
  // recency the finished chat, seen last, leads and the working one follows.
  assert.deepEqual(
    urgent.sessions.map((session) => session.id),
    [
      "claude-review",
      "codex-bootstrap",
      "conductor-chat-package",
      "conductor-chat-tidy",
      "cursor-agent",
      "devin-session",
    ],
  );
  assert.deepEqual(
    recent.sessions.map((session) => session.id),
    [
      "conductor-chat-tidy",
      "conductor-chat-package",
      "codex-bootstrap",
      "claude-review",
      "cursor-agent",
      "devin-session",
    ],
  );
});

test("filtering leaves the chosen ordering in force", () => {
  const recentCloud = arrangeSessions(FIXTURE_SESSIONS, {
    filter: SESSION_FILTER.CLOUD,
    sort: SESSION_SORT.RECENCY,
  });

  assert.deepEqual(
    recentCloud.sessions.map((session) => session.id),
    ["conductor-chat-tidy", "conductor-chat-package", "cursor-agent", "devin-session"],
  );
});

test("sessions of one state are ordered by which moved most recently", () => {
  const working = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "stale", SESSION_STATUS.WORKING, 1_000),
    liveSession(CLAUDE_PROVIDER, "fresh", SESSION_STATUS.WORKING, 9_000),
  ]);

  assert.deepEqual(
    arrangeSessions(working, DEFAULT_SESSION_VIEW).sessions.map((session) => session.id),
    ["fresh", "stale"],
  );
});

const CONDUCTOR_PROVIDER = { id: PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };

test("chats of one workspace sit together and read as one tray run", () => {
  const chatOf = (
    id: string,
    status: (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS],
    observedAt: number,
  ) =>
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: id,
      title: `Chat ${id}`,
      status,
      observedAt,
      detail: { repository: "luke" },
      workspace: { providerWorkspaceId: "workspace-lisbon", name: "lisbon-v2" },
    });

  const rows = displaySessions(bootstrap(false), [
    chatOf("chat-asking", SESSION_STATUS.WAITING, 1_000),
    liveSession(CODEX_PROVIDER, "codex-between", SESSION_STATUS.WORKING, 5_000),
    chatOf("chat-finished", SESSION_STATUS.COMPLETE, 9_000),
  ]);
  const arranged = arrangeSessions(rows, DEFAULT_SESSION_VIEW).sessions;

  // The finished chat would have sorted below the stranger; the run pulls it
  // up beside its asking sibling instead, seated where that sibling earned.
  assert.deepEqual(
    arranged.map((session) => session.id),
    ["chat-asking", "chat-finished", "codex-between"],
  );
  // The tray is one run holding both chats — carrying the checkout its header
  // names — and the stranger is a run of one with no workspace at all.
  assert.deepEqual(sessionListRuns(arranged), [
    {
      workspace: { id: "workspace-lisbon", name: "lisbon-v2" },
      repository: "luke",
      indexes: [0, 1],
    },
    { indexes: [2] },
  ]);
});

test("a lone chat is a run of one, and namesake workspaces never join", () => {
  // Two workspaces wearing one name: the id is what groups, so each stays a
  // run of its own — drawn as a plain row, not a tray — rather than joining
  // under the name they happen to share.
  const chatOf = (id: string, workspaceId: string) =>
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: id,
      title: `Chat ${id}`,
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      workspace: { providerWorkspaceId: workspaceId, name: "lisbon-v2" },
    });

  const rows = displaySessions(bootstrap(false), [
    chatOf("chat-one", "workspace-one"),
    chatOf("chat-two", "workspace-two"),
  ]);
  const arranged = arrangeSessions(rows, DEFAULT_SESSION_VIEW).sessions;

  assert.deepEqual(
    sessionListRuns(arranged).map((run) => ({
      workspaceId: run.workspace?.id,
      indexes: run.indexes,
    })),
    [
      { workspaceId: "workspace-one", indexes: [0] },
      { workspaceId: "workspace-two", indexes: [1] },
    ],
  );
});

test("a row carries its workspace by name, falling back to the id", () => {
  const [named] = displaySessions(bootstrap(false), [
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: "chat-named",
      title: "Chat named",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      workspace: { providerWorkspaceId: "workspace-1", name: "lisbon-v2" },
    }),
  ]);
  assert.deepEqual(named?.workspace, { id: "workspace-1", name: "lisbon-v2" });

  const [unnamed] = displaySessions(bootstrap(false), [
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: "chat-unnamed",
      title: "Chat unnamed",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      workspace: { providerWorkspaceId: "workspace-2" },
    }),
  ]);
  assert.deepEqual(unnamed?.workspace, { id: "workspace-2", name: "workspace-2" });

  const [ungrouped] = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
  ]);
  assert.equal(ungrouped?.workspace, undefined);
});

test("a row offers writes only where its provider promised them", () => {
  const quiet = liveSession(CLAUDE_PROVIDER, "local", SESSION_STATUS.WORKING);
  const writable = normalizeSession(CODEX_PROVIDER, {
    providerSessionId: "cloud",
    title: "Session cloud",
    status: SESSION_STATUS.WAITING,
    observedAt: 1_000,
    canReceiveMessage: true,
    controls: [{ id: "approve-plan", label: "Approve the plan" }],
  });

  const rows = displaySessions(bootstrap(false), [quiet, writable]);
  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.equal(byId.get("local")?.canMessage, false);
  assert.deepEqual(byId.get("local")?.actions, []);
  assert.equal(byId.get("cloud")?.canMessage, true);
  assert.deepEqual(byId.get("cloud")?.actions, [{ id: "approve-plan", label: "Approve the plan" }]);
  // The fixture draws the affordances so the evidence shows them, exactly
  // where a live session would have them: the composer on the suspended Devin
  // row, the stop on the working Cursor agent, and nothing anywhere else.
  const fixtureById = new Map(FIXTURE_SESSIONS.map((row) => [row.id, row]));
  assert.equal(fixtureById.get("devin-session")?.canMessage, true);
  assert.deepEqual(fixtureById.get("cursor-agent")?.actions, [
    { id: "cancel-run", label: "Stop this run", kind: "stop" },
  ]);
  for (const row of FIXTURE_SESSIONS) {
    if (row.id === "devin-session") continue;
    assert.equal(row.canMessage, false);
  }
});
