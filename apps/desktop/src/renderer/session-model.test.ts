import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_SPEAKING_CAPTION, fixtureSnapshot } from "@sidecar/fixtures";
import {
  ATTENTION_DISPOSITION,
  normalizeSession,
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionControl,
  type SessionProvider,
} from "@sidecar/session";
import { SESSION_URGENCY } from "@sidecar/surface";
import type { AppBootstrap } from "#shared/wire/session";
import {
  actsOnWorkspace,
  arrangeSessions,
  DEFAULT_SESSION_VIEW,
  displaySessions,
  fixtureMentionChips,
  MENTION_CHIP_KIND,
  matchRanges,
  observedAgoLabel,
  SESSION_FILTER,
  SESSION_FILTER_AXIS,
  SESSION_SORT,
  sessionFiltersFromSpoken,
  sessionListRuns,
  sessionRunKeys,
  sessionTally,
  spokenSearchOutcome,
  tallySummary,
  toggledSessionFilters,
  workspaceTrayActions,
  workspaceTrayChange,
} from "./session-model";

const CLAUDE_PROVIDER = { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" };
const CODEX_PROVIDER = { id: PROVIDER_ID.CODEX, displayName: "Codex" };

function bootstrap(fixtureMode: boolean): AppBootstrap {
  // SAFETY: Smoke fixture bootstrap carries only fixtureMode and snapshot for tests.
  return {
    fixtureMode,
    fixture: fixtureSnapshot("smoke"),
  } as AppBootstrap;
}

function liveSession(
  provider: SessionProvider,
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
  const fixtureUrgencies = displaySessions(bootstrap(true), []).map((session) => session.urgency);
  assert.deepEqual(fixtureUrgencies, [
    SESSION_URGENCY.ATTENTION,
    SESSION_URGENCY.WORKING,
    SESSION_URGENCY.WORKING,
    SESSION_URGENCY.WORKING,
    SESSION_URGENCY.COMPLETE,
    SESSION_URGENCY.UNKNOWN,
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
  assert.equal(live[0]?.urgency, SESSION_URGENCY.ATTENTION);
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
      applications: [
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          displayName: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "codex://threads/codex-addressed",
        },
      ],
    }),
    liveSession(CLAUDE_PROVIDER, "claude-unaddressed", SESSION_STATUS.WORKING),
  ]);

  const addressed = live.find((session) => session.id === "codex-addressed");
  assert.equal(addressed?.openable, true);
  assert.equal(addressed?.openApplication, "ChatGPT");
  assert.deepEqual(addressed?.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      name: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      openable: true,
    },
  ]);
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
// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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

test("a row carries the pull request's number when its address names one", () => {
  const live = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-published",
      title: "Session codex-published",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { change: "https://github.com/reviewstage/luke/pull/245" },
    }),
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "claude-unnumbered",
      title: "Session claude-unnumbered",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { change: "https://github.com/reviewstage/luke/pulls" },
    }),
  ]);

  const published = live.find((session) => session.id === "codex-published");
  assert.equal(published?.hasChange, true);
  assert.equal(published?.changeNumber, 245);

  // An address naming no number still earns the chip — only its title falls
  // back to the generic words.
  const unnumbered = live.find((session) => session.id === "claude-unnumbered");
  assert.equal(unnumbered?.hasChange, true);
  assert.equal(unnumbered?.changeNumber, undefined);

  // The fixture's chip carries a number too, so the visual evidence shows the
  // label a live address would earn.
  const cursor = FIXTURE_SESSIONS.find((session) => session.id === "cursor-agent");
  assert.equal(cursor?.hasChange, true);
  assert.equal(cursor?.changeNumber, 31);
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
// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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
  const speaking = normalizeSession(CLAUDE_PROVIDER, {
    providerSessionId: "claude-speaking",
    title: "Speaking session",
    status: SESSION_STATUS.WORKING,
    observedAt: 1_000,
  });

  const [session] = displaySessions(
    bootstrap(false),
    [speaking],
    [
      {
        providerId: speaking.providerId,
        providerSessionId: speaking.providerSessionId,
        decision: { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, decidedAt: 1_000 },
      },
    ],
  );
  assert.equal(session?.urgency, SESSION_URGENCY.ATTENTION);
});

test("attention joins on the whole provider identity and supplies the row detail", () => {
  const codex = liveSession(CODEX_PROVIDER, "shared-id", SESSION_STATUS.WORKING);
  const claude = liveSession(CLAUDE_PROVIDER, "shared-id", SESSION_STATUS.WORKING);
  const sessions = displaySessions(
    bootstrap(false),
    [codex, claude],
    [
      {
        providerId: claude.providerId,
        providerSessionId: claude.providerSessionId,
        decision: {
          disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
          decidedAt: 1_000,
          summary: "Claude needs a review decision.",
        },
      },
      {
        providerId: CODEX_PROVIDER.id,
        providerSessionId: "missing",
        decision: {
          disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
          decidedAt: 1_000,
          summary: "This orphan must not attach to a row.",
        },
      },
    ],
  );

  const byProvider = new Map(sessions.map((session) => [session.providerId, session]));
  assert.equal(byProvider.get(CLAUDE_PROVIDER.id)?.urgency, SESSION_URGENCY.ATTENTION);
  assert.equal(byProvider.get(CLAUDE_PROVIDER.id)?.detail, "Claude needs a review decision.");
  assert.equal(byProvider.get(CODEX_PROVIDER.id)?.urgency, SESSION_URGENCY.WORKING);
  assert.equal(byProvider.get(CODEX_PROVIDER.id)?.detail, "Working");
});

test("the tally counts per state and per app", () => {
  const tally = sessionTally(displaySessions(bootstrap(true), []));

  assert.deepEqual(
    { ...tally, providers: undefined },
    {
      total: 6,
      attention: 1,
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      // Named as well as counted: Luke's face reacts to a session that has just
      // started asking, which the count alone cannot report.
      attentionIds: ["claude-review"],
      working: 3,
      complete: 1,
      idle: 1,
      providers: undefined,
    },
  );
  // Apps follow the order their most urgent session takes, and a chat counts
  // under the app holding it: both Conductor chats land under Conductor's
  // mark whatever agent runs them, the Codex chat under ChatGPT, its lead
  // app, and a chat no app holds — the local Claude Code session, the Devin
  // cloud session — under its provider's own.
  assert.deepEqual(tally.providers, [
    { providerId: PROVIDER_ID.CLAUDE_CODE, provider: "Claude Code", total: 1, attention: 1 },
    { providerId: SESSION_APPLICATION_ID.CHATGPT, provider: "ChatGPT", total: 1, attention: 0 },
    { providerId: SESSION_APPLICATION_ID.CONDUCTOR, provider: "Conductor", total: 2, attention: 0 },
    { providerId: SESSION_APPLICATION_ID.CURSOR, provider: "Cursor", total: 1, attention: 0 },
    { providerId: PROVIDER_ID.DEVIN, provider: "Devin", total: 1, attention: 0 },
  ]);
});

// The wing's marks and the rows are two drawings of the same order, so
// choosing the other sort re-seats the apps with the sessions: a mark that
// stayed put while the rows re-sorted would name the top row's app wrong.
// The counts are counts, and no ordering may change them.
test("the apps re-seat with the rows when the other sort is chosen", () => {
  const recent = sessionTally(FIXTURE_SESSIONS, SESSION_SORT.RECENCY);

  assert.deepEqual(
    recent.providers.map((provider) => provider.providerId),
    [
      SESSION_APPLICATION_ID.CONDUCTOR,
      SESSION_APPLICATION_ID.CHATGPT,
      PROVIDER_ID.CLAUDE_CODE,
      SESSION_APPLICATION_ID.CURSOR,
      PROVIDER_ID.DEVIN,
    ],
  );
  assert.deepEqual(
    { ...recent, providers: undefined },
    { ...sessionTally(FIXTURE_SESSIONS), providers: undefined },
  );
});

test("the spoken summary names the state its own number counts", () => {
  const tally = sessionTally(displaySessions(bootstrap(true), []));

  assert.equal(tallySummary(tally), "1 session needs you");
  assert.equal(tallySummary({ ...tally, attention: 0, working: 3 }), "3 sessions working");
  assert.equal(tallySummary({ ...tally, attention: 0, working: 0 }), "1 session complete");
  assert.equal(
    tallySummary({ ...tally, attention: 0, working: 0, complete: 0 }),
    "6 sessions tracked",
  );
  assert.equal(tallySummary(sessionTally([])), "No sessions tracked");
});

test("the filters offered are grouped by axis, coarse to fine, counted", () => {
  const list = arrangeSessions(FIXTURE_SESSIONS, DEFAULT_SESSION_VIEW);

  assert.deepEqual(list.groups, [
    {
      axis: SESSION_FILTER_AXIS.LOCATION,
      label: "Location",
      options: [
        { filter: SESSION_FILTER.LOCAL, label: "Local", count: 2 },
        { filter: SESSION_FILTER.CLOUD, label: "Cloud", count: 4 },
      ],
    },
    {
      axis: SESSION_FILTER_AXIS.APP,
      label: "App",
      options: [
        {
          filter: SESSION_APPLICATION_ID.CHATGPT,
          label: "ChatGPT",
          count: 1,
          markId: SESSION_APPLICATION_ID.CHATGPT,
        },
        {
          filter: SESSION_APPLICATION_ID.CONDUCTOR,
          label: "Conductor",
          count: 3,
          markId: SESSION_APPLICATION_ID.CONDUCTOR,
        },
        {
          // The app chip counts the chats the Cursor app can open; the agent
          // chip below counts every Cursor chat. Separate ids keep the two
          // questions on their own axes.
          filter: SESSION_APPLICATION_ID.CURSOR,
          label: "Cursor",
          count: 1,
          markId: SESSION_APPLICATION_ID.CURSOR,
        },
      ],
    },
    {
      axis: SESSION_FILTER_AXIS.AGENT,
      label: "Agent",
      options: [
        {
          filter: PROVIDER_ID.CLAUDE_CODE,
          label: "Claude Code",
          // The local Claude session and the Conductor cloud chat whose agent
          // is Claude Code: the agent chip counts hosted chats too.
          count: 2,
          markId: PROVIDER_ID.CLAUDE_CODE,
        },
        { filter: PROVIDER_ID.CODEX, label: "Codex", count: 1, markId: PROVIDER_ID.CODEX },
        { filter: PROVIDER_ID.CURSOR, label: "Cursor", count: 1, markId: PROVIDER_ID.CURSOR },
        { filter: PROVIDER_ID.DEVIN, label: "Devin", count: 1, markId: PROVIDER_ID.DEVIN },
      ],
    },
  ]);
});

test("the voice filter narrows to realtime voice chats and has a spoken name", () => {
  const sessions = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-voice",
      title: "Voice chat",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      realtimeVoice: true,
    }),
    liveSession(CODEX_PROVIDER, "codex-typed", SESSION_STATUS.COMPLETE),
  ]);

  const list = arrangeSessions(sessions, DEFAULT_SESSION_VIEW);
  assert.deepEqual(list.groups, [
    {
      axis: SESSION_FILTER_AXIS.KIND,
      label: "Kind",
      options: [{ filter: SESSION_FILTER.VOICE, label: "Voice", count: 1 }],
    },
  ]);
  assert.deepEqual(
    arrangeSessions(sessions, {
      ...DEFAULT_SESSION_VIEW,
      filters: [SESSION_FILTER.VOICE],
    }).sessions.map((session) => session.id),
    ["codex-voice"],
  );
  assert.deepEqual(sessionFiltersFromSpoken([SESSION_FILTER.VOICE]), [SESSION_FILTER.VOICE]);
});

test("a spoken narrowing of several values reads as the matching chips combined", () => {
  assert.deepEqual(
    sessionFiltersFromSpoken([SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX, SESSION_FILTER.VOICE]),
    [SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX, SESSION_FILTER.VOICE],
  );
  // A repeated value is one chip, not a tighter ask.
  assert.deepEqual(sessionFiltersFromSpoken([SESSION_FILTER.CLOUD, SESSION_FILTER.CLOUD]), [
    SESSION_FILTER.CLOUD,
  ]);
  // The whole list is the empty selection.
  assert.deepEqual(sessionFiltersFromSpoken(["all"]), []);
  // A value no chip of this build holds makes the whole ask nothing rather
  // than a guess: a selection quietly missing one of its values would show
  // more than the ask named.
  assert.equal(sessionFiltersFromSpoken([SESSION_FILTER.LOCAL, "not-an-agent"]), undefined);
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
  const offered = arrangeSessions(sessions, DEFAULT_SESSION_VIEW)
    .groups.flatMap((group) => group.options)
    .filter((option) => option.markId !== undefined)
    .map((option) => option.filter);

  // Conductor's chip sits on the app axis rather than among the agents, so
  // the offer is compared as a set: every agent is reachable, wherever seated.
  assert.deepEqual([...offered].sort(), [...PROVIDER_ID_LIST].sort());
  for (const providerId of PROVIDER_ID_LIST) {
    const narrowed = arrangeSessions(sessions, {
      ...DEFAULT_SESSION_VIEW,
      filters: [providerId],
    });
    assert.deepEqual(narrowed.filters, [providerId]);
    assert.deepEqual(
      narrowed.sessions.map((session) => session.id),
      [providerId],
    );
  }
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a level with one answer is not offered as a choice", () => {
  // Two agents, both local: which agent is a real question, where it runs is not.
  const local = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
  ]);
  assert.deepEqual(
    arrangeSessions(local, DEFAULT_SESSION_VIEW).groups.map((group) => ({
      axis: group.axis,
      filters: group.options.map((option) => option.filter),
    })),
    [
      {
        axis: SESSION_FILTER_AXIS.AGENT,
        filters: [PROVIDER_ID.CLAUDE_CODE, PROVIDER_ID.CODEX],
      },
    ],
  );

  // One agent, several sessions: nothing is a question at all.
  const alone = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.COMPLETE),
  ]);
  assert.deepEqual(arrangeSessions(alone, DEFAULT_SESSION_VIEW).groups, []);

  assert.deepEqual(arrangeSessions([], DEFAULT_SESSION_VIEW).groups, []);
});

test("a filter narrows the list without changing what is tracked", () => {
  const cloud = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filters: [SESSION_FILTER.CLOUD],
  });
  const agent = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filters: [PROVIDER_ID.CLAUDE_CODE],
  });

  assert.deepEqual(
    cloud.sessions.map((session) => session.id),
    ["conductor-chat-package", "conductor-chat-tidy", "cursor-agent", "devin-session"],
  );
  // The agent chip reaches the hosted chat too: the Conductor cloud chat
  // whose agent is Claude Code answers the Claude Code narrowing.
  assert.deepEqual(
    agent.sessions.map((session) => session.id),
    ["claude-review", "conductor-chat-package"],
  );
  assert.deepEqual(cloud.filters, [SESSION_FILTER.CLOUD]);
  assert.equal(cloud.total, 6);
  assert.equal(agent.total, 6);
});

// The report's own example: within one axis the chips are alternatives, and
// across axes each is a further narrowing.
test("filters on one axis widen each other and across axes narrow", () => {
  // Local and Cloud together is either place: the whole list.
  const either = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filters: [SESSION_FILTER.LOCAL, SESSION_FILTER.CLOUD],
  });
  assert.equal(either.sessions.length, 6);

  // Cloud beside Conductor is Conductor's cloud chats alone.
  const both = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filters: [SESSION_FILTER.CLOUD, SESSION_APPLICATION_ID.CONDUCTOR],
  });
  assert.deepEqual(
    both.sessions.map((session) => session.id),
    ["conductor-chat-package", "conductor-chat-tidy"],
  );
  assert.deepEqual(both.filters, [SESSION_FILTER.CLOUD, SESSION_APPLICATION_ID.CONDUCTOR]);
});

// Which surviving part of an emptied combination to keep would be a choice,
// and the list correcting itself must not choose — so the selection falls
// back whole.
test("a combination no session answers falls back whole to everything", () => {
  const emptied = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    filters: [SESSION_FILTER.LOCAL, SESSION_APPLICATION_ID.CONDUCTOR, PROVIDER_ID.CURSOR],
  });

  assert.deepEqual(emptied.filters, []);
  assert.equal(emptied.sessions.length, 6);
});

test("a chip press toggles one value in and out of the selection", () => {
  const chosen = toggledSessionFilters([], SESSION_FILTER.CLOUD);
  assert.deepEqual(chosen, [SESSION_FILTER.CLOUD]);
  assert.deepEqual(toggledSessionFilters(chosen, PROVIDER_ID.CODEX), [
    SESSION_FILTER.CLOUD,
    PROVIDER_ID.CODEX,
  ]);
  assert.deepEqual(toggledSessionFilters([SESSION_FILTER.CLOUD], SESSION_FILTER.CLOUD), []);
});

test("a filter whose last session has left falls back to showing everything", () => {
  const noCloud = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.COMPLETE),
  ]);

  for (const filter of [SESSION_FILTER.CLOUD, PROVIDER_ID.CURSOR]) {
    const list = arrangeSessions(noCloud, { ...DEFAULT_SESSION_VIEW, filters: [filter] });
    assert.deepEqual(list.filters, []);
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
    filters: [PROVIDER_ID.CODEX],
  });

  assert.deepEqual(narrowed.filters, [PROVIDER_ID.CODEX]);
  assert.equal(narrowed.sessions.length, 2);
  // No second agent yet, so no chips are offered — the filter outlives them.
  assert.deepEqual(narrowed.groups, []);

  const withClaude = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.COMPLETE),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
  ]);
  const still = arrangeSessions(withClaude, {
    ...DEFAULT_SESSION_VIEW,
    filters: [PROVIDER_ID.CODEX],
  });

  assert.deepEqual(still.filters, [PROVIDER_ID.CODEX]);
  assert.deepEqual(
    still.sessions.map((session) => session.providerId),
    [PROVIDER_ID.CODEX, PROVIDER_ID.CODEX],
  );
});

// The panel stores the selection this returns rather than only drawing it, so
// a selection that emptied is dropped instead of lying dormant behind a list
// that only looks unnarrowed. That write is safe exactly while arranging the
// result again changes nothing.
test("the selection the list settles on is one it would settle on again", () => {
  const oneAgent = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.WORKING),
  ]);

  for (const sessions of [oneAgent, []]) {
    const first = arrangeSessions(sessions, {
      ...DEFAULT_SESSION_VIEW,
      filters: [PROVIDER_ID.CURSOR],
    });
    const second = arrangeSessions(sessions, { ...DEFAULT_SESSION_VIEW, filters: first.filters });

    assert.deepEqual(first.filters, []);
    assert.deepEqual(second.filters, first.filters);
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

  assert.deepEqual(list.groups, []);
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
    ...DEFAULT_SESSION_VIEW,
    filters: [SESSION_FILTER.CLOUD],
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

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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

test("an orchestrator workspace groups sessions from different providers", () => {
  const workspace = {
    providerWorkspaceId: "workspace-superset",
    scopeId: "superset",
    managerName: "Superset",
    name: "power-vacation",
  };
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "claude-chat",
      title: "Claude",
      status: SESSION_STATUS.WORKING,
      observedAt: 2_000,
      workspace,
    }),
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-chat",
      title: "Codex",
      status: SESSION_STATUS.COMPLETE,
      observedAt: 1_000,
      workspace,
    }),
  ]);

  assert.deepEqual(
    sessionListRuns(arrangeSessions(rows, DEFAULT_SESSION_VIEW).sessions).map((run) => run.indexes),
    [[0, 1]],
  );
});

// Superset is a level of its own between where a session runs and which agent
// runs it: the same agent answers its own chip and the Superset chip when
// Superset manages its workspace.
test("sessions Superset manages earn a chip and can be narrowed to", () => {
  const workspace = {
    providerWorkspaceId: "workspace-superset",
    scopeId: "superset",
    managerName: "Superset",
    name: "power-vacation",
  };
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "claude-managed",
      title: "Claude",
      status: SESSION_STATUS.WORKING,
      observedAt: 2_000,
      workspace,
    }),
    liveSession(CODEX_PROVIDER, "codex-loose", SESSION_STATUS.WORKING, 1_000),
  ]);
  const list = arrangeSessions(rows, DEFAULT_SESSION_VIEW);
  assert.equal(rows[0]?.workspace?.managerName, "Superset");

  assert.deepEqual(list.groups, [
    {
      axis: SESSION_FILTER_AXIS.APP,
      label: "App",
      options: [
        {
          filter: SESSION_FILTER.SUPERSET,
          label: "Superset",
          count: 1,
          markId: SESSION_FILTER.SUPERSET,
        },
      ],
    },
    {
      axis: SESSION_FILTER_AXIS.AGENT,
      label: "Agent",
      options: [
        {
          filter: PROVIDER_ID.CLAUDE_CODE,
          label: "Claude Code",
          count: 1,
          markId: PROVIDER_ID.CLAUDE_CODE,
        },
        { filter: PROVIDER_ID.CODEX, label: "Codex", count: 1, markId: PROVIDER_ID.CODEX },
      ],
    },
  ]);

  const narrowed = arrangeSessions(rows, {
    ...DEFAULT_SESSION_VIEW,
    filters: [SESSION_FILTER.SUPERSET],
  });
  assert.deepEqual(narrowed.filters, [SESSION_FILTER.SUPERSET]);
  assert.deepEqual(
    narrowed.sessions.map((session) => session.id),
    ["claude-managed"],
  );
  assert.equal(narrowed.total, 2);

  // The spoken vocabulary is the chips' own, so the same word narrows by voice.
  assert.deepEqual(sessionFiltersFromSpoken(["superset"]), [SESSION_FILTER.SUPERSET]);
});

test("an app filter matches annotations as well as a namesake provider", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-conductor",
      title: "A long Codex title that still keeps its application marks",
      status: SESSION_STATUS.WORKING,
      observedAt: 3_000,
      applications: [
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          displayName: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "codex://threads/codex-conductor",
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
      detail: { link: "codex://threads/codex-conductor" },
    }),
    liveSession(CONDUCTOR_PROVIDER, "conductor-native", SESSION_STATUS.WORKING, 2_000),
    liveSession(CLAUDE_PROVIDER, "claude-loose", SESSION_STATUS.WORKING, 1_000),
  ]);
  const list = arrangeSessions(rows, DEFAULT_SESSION_VIEW);

  assert.deepEqual(
    list.groups
      .flatMap((group) => group.options)
      .find((option) => option.filter === SESSION_APPLICATION_ID.CONDUCTOR),
    {
      filter: SESSION_APPLICATION_ID.CONDUCTOR,
      label: "Conductor",
      count: 2,
      markId: SESSION_APPLICATION_ID.CONDUCTOR,
    },
  );
  assert.deepEqual(
    arrangeSessions(rows, {
      ...DEFAULT_SESSION_VIEW,
      filters: [SESSION_APPLICATION_ID.CONDUCTOR],
    }).sessions.map((session) => session.id),
    ["codex-conductor", "conductor-native"],
  );
  // The report's rule for the app axis: an agent chip beside Conductor's is a
  // further narrowing, so Codex + Conductor is Codex chats associated with
  // Conductor — never Conductor's own chats as well.
  assert.deepEqual(
    arrangeSessions(rows, {
      ...DEFAULT_SESSION_VIEW,
      filters: [PROVIDER_ID.CODEX, SESSION_APPLICATION_ID.CONDUCTOR],
    }).sessions.map((session) => session.id),
    ["codex-conductor"],
  );
  assert.deepEqual(sessionFiltersFromSpoken([SESSION_APPLICATION_ID.CHATGPT]), [
    SESSION_APPLICATION_ID.CHATGPT,
  ]);
});

// A Superset chip counting every session narrows nothing, like a lone
// location or a lone agent — the agents below it are still a real choice.
test("a Superset chip counting every session is not offered", () => {
  const managed = (provider: SessionProvider, id: string) =>
    normalizeSession(provider, {
      providerSessionId: id,
      title: `Session ${id}`,
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      workspace: { providerWorkspaceId: "workspace-superset", scopeId: "superset" },
    });
  const rows = displaySessions(bootstrap(false), [
    managed(CLAUDE_PROVIDER, "claude-managed"),
    managed(CODEX_PROVIDER, "codex-managed"),
  ]);

  assert.deepEqual(
    arrangeSessions(rows, DEFAULT_SESSION_VIEW)
      .groups.flatMap((group) => group.options)
      .map((option) => option.filter),
    [PROVIDER_ID.CLAUDE_CODE, PROVIDER_ID.CODEX],
  );
});

test("a lone chat is a run of one, and namesake workspaces never join", () => {
  // Two workspaces wearing one name: the id is what groups, so each stays a
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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

test("an act aimed at the workspace is the tray's, said once", () => {
  // Every settled chat advertises the same workspace archive; the tray offers
  // it once, carried by the first chat that advertised it, while a chat's own
  // acts — the stop, aimed at its run — stay on the row that owns them.
  const archive = { id: "archive-workspace", label: "Archive", target: "workspace-lisbon" };
  const stop = {
    id: "cancel-run",
    label: "Stop this run",
    kind: SESSION_CONTROL_KIND.STOP,
    target: "run-1",
  };
  const chatOf = (id: string, controls: readonly SessionControl[]) =>
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: id,
      title: `Chat ${id}`,
      status: SESSION_STATUS.COMPLETE,
      observedAt: 1_000,
      controls,
      workspace: { providerWorkspaceId: "workspace-lisbon", name: "lisbon-v2" },
    });

  const rows = displaySessions(bootstrap(false), [
    chatOf("chat-one", [stop, archive]),
    chatOf("chat-two", [archive]),
  ]);

  const acts = workspaceTrayActions(rows);
  assert.deepEqual(
    acts.map((act) => ({ actionId: act.action.id, sessionId: act.session.id })),
    [{ actionId: "archive-workspace", sessionId: "chat-one" }],
  );

  const [first] = rows;
  assert.ok(first);
  const [firstStop, firstArchive] = first.actions;
  assert.ok(firstStop && firstArchive);
  assert.equal(actsOnWorkspace(first, firstStop), false);
  assert.equal(actsOnWorkspace(first, firstArchive), true);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("an ungrouped session's acts never read as a workspace's", () => {
  // A target can only say "the workspace" beside a workspace to say it of: a
  // session no provider grouped keeps every act its own, whatever the target.
  const [row] = displaySessions(bootstrap(false), [
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: "chat-alone",
      title: "Chat alone",
      status: SESSION_STATUS.COMPLETE,
      observedAt: 1_000,
      controls: [{ id: "archive-workspace", label: "Archive", target: "workspace-lisbon" }],
    }),
  ]);
  assert.ok(row);
  const [action] = row.actions;
  assert.ok(action);
  assert.equal(actsOnWorkspace(row, action), false);
  assert.deepEqual(workspaceTrayActions([row]), []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a tray's shared pull request is said once, through the chat that reported it", () => {
  const chatOf = (id: string, change?: string) =>
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: id,
      title: `Chat ${id}`,
      status: SESSION_STATUS.COMPLETE,
      observedAt: 1_000,
      ...(change ? { detail: { change } } : undefined),
      workspace: { providerWorkspaceId: "workspace-lisbon", name: "lisbon-v2" },
    });
  const changeUrl = "https://github.com/example/luke/pull/245";

  // Every chat reporting the one change collapses to one header chip, opened
  // through the first chat that reported it.
  const shared = displaySessions(bootstrap(false), [
    chatOf("chat-one", changeUrl),
    chatOf("chat-two", changeUrl),
  ]);
  const hoisted = workspaceTrayChange(shared);
  assert.equal(hoisted?.session.id, "chat-one");
  assert.equal(hoisted?.changeNumber, 245);

  // A single reporting chat is trivially the workspace's one change, even
  // when its address names no number for the chip to wear.
  const lone = displaySessions(bootstrap(false), [
    chatOf("chat-one", "https://github.com/example/luke/pulls"),
    chatOf("chat-two"),
  ]);
  const loneHoisted = workspaceTrayChange(lone);
  assert.equal(loneHoisted?.session.id, "chat-one");
  assert.equal(loneHoisted?.changeNumber, undefined);

  // Two chats naming different numbers are two changes; the header offering
  // one would hide the other, so each stays on its own row.
  const differing = displaySessions(bootstrap(false), [
    chatOf("chat-one", changeUrl),
    chatOf("chat-two", "https://github.com/example/luke/pull/246"),
  ]);
  assert.equal(workspaceTrayChange(differing), undefined);

  // Reports the numbers cannot compare may be one change or two, and the
  // header must not gamble on which; they stay on their rows.
  const unnumbered = displaySessions(bootstrap(false), [
    chatOf("chat-one", changeUrl),
    chatOf("chat-two", "https://github.com/example/luke/pulls"),
  ]);
  assert.equal(workspaceTrayChange(unnumbered), undefined);

  // A tray with no reported change offers no chip at all.
  assert.equal(
    workspaceTrayChange(displaySessions(bootstrap(false), [chatOf("chat-one")])),
    undefined,
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

test("a query keeps only rows saying every word, wherever each word lands", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "parser",
      title: "Rework the parser",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { branch: "feat/LUKE-123-parser" },
    }),
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "login",
      title: "Fix the login flow",
      status: SESSION_STATUS.WORKING,
      observedAt: 2_000,
    }),
  ]);

  // The words match together across fields — the ticket sits on the branch and
  // the noun in the title — and case never matters: a query is typed, not
  // quoted back at the row.
  const found = arrangeSessions(rows, { ...DEFAULT_SESSION_VIEW, query: "Parser LUKE-123" });

  assert.deepEqual(
    found.sessions.map((session) => session.id),
    ["parser"],
  );
  assert.equal(found.total, 2);
  assert.deepEqual(found.search, {
    tokens: ["parser", "luke-123"],
    searched: 2,
    beyondFilter: 0,
  });
});

test("a query is read against everything the row can say", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CONDUCTOR_PROVIDER, {
      providerSessionId: "chat",
      title: "Chat chat",
      status: SESSION_STATUS.ERROR,
      observedAt: 1_000,
      detail: { repository: "sidecar", model: "claude-opus-5", error: "The build broke" },
      workspace: { providerWorkspaceId: "workspace-1", name: "lisbon-v2" },
    }),
    liveSession(CODEX_PROVIDER, "other", SESSION_STATUS.WORKING),
  ]);

  // The repository, the model on the mark's hover, the workspace the row is a
  // chat of, the agent's own name, and the failure worded under the title.
  for (const query of ["sidecar", "OPUS", "lisbon", "conductor", "build broke"]) {
    const found = arrangeSessions(rows, { ...DEFAULT_SESSION_VIEW, query });
    assert.deepEqual(
      found.sessions.map((session) => session.id),
      ["chat"],
      `query: ${query}`,
    );
  }
});

test("a query finds a session by its status word, even under a busy detail line", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "busy",
      title: "Rework the parser",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
      detail: { activity: "Running the tests" },
    }),
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "stuck",
      title: "Fix the login flow",
      status: SESSION_STATUS.WAITING,
      observedAt: 2_000,
      detail: { activity: "Holding for an approval" },
    }),
  ]);

  // Both detail lines are spent on the provider's own words, so the status
  // word appears nowhere the row draws — the query still answers for the
  // state, and answers for it alone: "working" leaves the waiting row out.
  const working = arrangeSessions(rows, { ...DEFAULT_SESSION_VIEW, query: "working" });
  assert.deepEqual(
    working.sessions.map((session) => session.id),
    ["busy"],
  );

  const waiting = arrangeSessions(rows, { ...DEFAULT_SESSION_VIEW, query: "needs you" });
  assert.deepEqual(
    waiting.sessions.map((session) => session.id),
    ["stuck"],
  );
});

test("a spoken search is told exactly what the list will show", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "parser",
      title: "Rework the parser",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
    }),
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "login",
      title: "Fix the login flow",
      status: SESSION_STATUS.WORKING,
      observedAt: 2_000,
    }),
  ]);

  assert.deepEqual(spokenSearchOutcome(rows, { ...DEFAULT_SESSION_VIEW, query: "parser" }), {
    matches: 1,
  });
  // An emptied search answers with its honest zero rather than a refusal —
  // and when the filter in force is what hides the matches, the note says so
  // the way the list's own empty state does.
  assert.deepEqual(spokenSearchOutcome(rows, { ...DEFAULT_SESSION_VIEW, query: "zanzibar" }), {
    matches: 0,
    note: "No sessions match those words.",
  });
  assert.deepEqual(
    spokenSearchOutcome(rows, {
      ...DEFAULT_SESSION_VIEW,
      filters: [PROVIDER_ID.CODEX],
      query: "parser",
    }),
    {
      matches: 0,
      note: "No shown sessions match, but the filter in force hides 1 session that would.",
    },
  );
});

test("a blank query is no search at all", () => {
  const list = arrangeSessions(FIXTURE_SESSIONS, { ...DEFAULT_SESSION_VIEW, query: "   " });

  assert.equal(list.search, undefined);
  assert.equal(list.sessions.length, FIXTURE_SESSIONS.length);
});

test("a query that matches nothing empties the list and says so", () => {
  const list = arrangeSessions(FIXTURE_SESSIONS, { ...DEFAULT_SESSION_VIEW, query: "zanzibar" });

  // The one narrowing allowed to empty the list: "nothing matches" is a
  // search's honest answer, where a filter falling to nothing is a stale
  // choice to be dropped. What is tracked is still counted in full.
  assert.deepEqual(list.sessions, []);
  assert.equal(list.total, FIXTURE_SESSIONS.length);
  assert.deepEqual(list.search, {
    tokens: ["zanzibar"],
    searched: FIXTURE_SESSIONS.length,
    beyondFilter: 0,
  });
});

test("a query reads within the filter and counts what the filter hides", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(CLAUDE_PROVIDER, {
      providerSessionId: "claude-alpha",
      title: "Alpha rework",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
    }),
    normalizeSession(CODEX_PROVIDER, {
      providerSessionId: "codex-alpha",
      title: "Alpha cleanup",
      status: SESSION_STATUS.WORKING,
      observedAt: 2_000,
    }),
    liveSession(CODEX_PROVIDER, "codex-other", SESSION_STATUS.WORKING, 3_000),
  ]);

  const narrowed = arrangeSessions(rows, {
    ...DEFAULT_SESSION_VIEW,
    filters: [PROVIDER_ID.CLAUDE_CODE],
    query: "alpha",
  });
  assert.deepEqual(
    narrowed.sessions.map((session) => session.id),
    ["claude-alpha"],
  );
  // The Codex match is not shown, but it is never swallowed either.
  assert.deepEqual(narrowed.search, { tokens: ["alpha"], searched: 1, beyondFilter: 1 });

  const emptied = arrangeSessions(rows, {
    ...DEFAULT_SESSION_VIEW,
    filters: [PROVIDER_ID.CLAUDE_CODE],
    query: "cleanup",
  });
  assert.deepEqual(emptied.sessions, []);
  assert.deepEqual(emptied.search, { tokens: ["cleanup"], searched: 1, beyondFilter: 1 });
});

test("searching leaves the chosen ordering and the workspace seating in force", () => {
  // The same word finds the native Conductor chats and a Codex chat carrying
  // Conductor's app association, all in the order the sort chose.
  const recent = arrangeSessions(FIXTURE_SESSIONS, {
    ...DEFAULT_SESSION_VIEW,
    sort: SESSION_SORT.RECENCY,
    query: "conductor",
  });
  assert.deepEqual(
    recent.sessions.map((session) => session.id),
    ["conductor-chat-tidy", "conductor-chat-package", "codex-bootstrap"],
  );

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The native chats stay one tray run; the annotated Codex chat stays loose.
  assert.deepEqual(
    sessionListRuns(recent.sessions).map((run) => ({
      workspaceId: run.workspace?.id,
      indexes: run.indexes,
    })),
    [
      { workspaceId: "conductor-lisbon", indexes: [0, 1] },
      { workspaceId: undefined, indexes: [2] },
    ],
  );
});

test("match ranges are found case-blind and merged where words overlap", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Two words landing on one stretch read as one mark, not nested ones.
  assert.deepEqual(matchRanges("Feat/LUKE-123-parser", ["luke", "ke-123"]), [
    { start: 5, end: 13 },
  ]);
  // Every occurrence is marked, not only the first.
  assert.deepEqual(matchRanges("alpha alpha", ["alpha"]), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
  ]);
  // A line the words did not land on yields nothing to mark.
  assert.deepEqual(matchRanges("nothing here", ["zeta"]), []);
});

// A chat fading out of a narrowed list keeps the slot it was seen in, and a
// stranger's held slot can split it from its workspace's living siblings —
// two runs of one workspace, drawn at once. React abandons the DOM of a child
// whose key another child also wears, which is a blank row left in the list,
// so the keys have to come apart exactly there.
test("a workspace split by a held slot gets one key per run", () => {
  const workspace = { id: "ws-da-nang", name: "da-nang" };
  const rows = [
    { item: { id: "chat-a1" }, leaving: true },
    { item: { id: "codex-1" }, leaving: false },
    { item: { id: "chat-a2" }, leaving: false },
  ];
  const runs = [{ workspace, indexes: [0] }, { indexes: [1] }, { workspace, indexes: [2] }];

  // The living run keeps the workspace's key — the wrapper whose rows hold
  // half-typed drafts is the one that must survive the split healing — and
  // the fading run is keyed by its own chat.
  assert.deepEqual(sessionRunKeys(runs, rows), ["chat-a1", "codex-1", "ws-da-nang"]);
});

test("an unsplit workspace and a lone fading chat both keep the workspace key", () => {
  const workspace = { id: "ws-1", name: "lisbon-v2" };

  // The tray, with one chat mid-fade: still one run, still the workspace's.
  assert.deepEqual(
    sessionRunKeys(
      [{ workspace, indexes: [0, 1] }],
      [
        { item: { id: "chat-1" }, leaving: false },
        { item: { id: "chat-2" }, leaving: true },
      ],
    ),
    ["ws-1"],
  );
  // A workspace whose only chat is leaving keeps its key too, so the fade
  // finishes in the wrapper it started in.
  assert.deepEqual(
    sessionRunKeys([{ workspace, indexes: [0] }], [{ item: { id: "chat-1" }, leaving: true }]),
    ["ws-1"],
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Ungrouped sessions are their own keys, as they always were.
  assert.deepEqual(
    sessionRunKeys([{ indexes: [0] }], [{ item: { id: "codex-1" }, leaving: false }]),
    ["codex-1"],
  );
});

// A hosted chat is the agent's conversation before it is the host's: the row's
// mark, the agent chip, and the search all reach it by the agent, while the
// provider identity stays what the host observed it as.
test("a hosted chat carries its agent for the mark, the chips, and the search", () => {
  const rows = displaySessions(bootstrap(false), [
    normalizeSession(
      { id: PROVIDER_ID.CONDUCTOR, displayName: "Conductor" },
      {
        providerSessionId: "conductor-claude",
        title: "amber-shoal",
        status: SESSION_STATUS.WORKING,
        observedAt: 2_000,
        location: SESSION_LOCATION.CLOUD,
        agent: { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" },
      },
    ),
    liveSession(CODEX_PROVIDER, "codex-loose", SESSION_STATUS.WORKING, 1_000),
  ]);

  assert.equal(rows[0]?.agentId, PROVIDER_ID.CLAUDE_CODE);
  assert.equal(rows[0]?.agent, "Claude Code");
  assert.equal(rows[0]?.providerId, PROVIDER_ID.CONDUCTOR);

  const narrowed = arrangeSessions(rows, {
    ...DEFAULT_SESSION_VIEW,
    filters: [PROVIDER_ID.CLAUDE_CODE],
  });
  assert.deepEqual(
    narrowed.sessions.map((session) => session.id),
    ["conductor-claude"],
  );

  const found = arrangeSessions(rows, { ...DEFAULT_SESSION_VIEW, query: "claude" });
  assert.deepEqual(
    found.sessions.map((session) => session.id),
    ["conductor-claude"],
  );

  // The wing counts the chat under the app holding it — here the hosting
  // provider itself, since no app association was reported — not the agent.
  const tally = sessionTally(rows);
  assert.deepEqual(
    tally.providers.map((provider) => provider.providerId),
    [PROVIDER_ID.CONDUCTOR, PROVIDER_ID.CODEX],
  );
});

test("the fixture's own sentence earns chips for the rows it names", () => {
  const fixture = fixtureSnapshot("smoke");
  const chips = fixtureMentionChips(FIXTURE_SPEAKING_CAPTION, fixture.sessions);

  // Named whole, in the order the sentence says them: two chats by title, the
  // Conductor workspace by name, two more chats. The Codex row is named by a
  // fragment of its long title rather than the whole of it, so it earns
  // nothing — the same refusal a live reply would meet.
  assert.deepEqual(
    chips.map((chip) => chip.title),
    ["Review trust constraints", "lisbon-v2", "Follow a cloud agent", "Watch a cloud session"],
  );
  // Every chip stands for a row the surface is drawing, and wears the mark of
  // the agent having the conversation.
  for (const chip of chips) {
    assert.equal(chip.kind, MENTION_CHIP_KIND.SESSION);
    const row = fixture.sessions.find((session) => session.id === chip.id);
    assert.ok(row);
    assert.equal(chip.markId, row.agentId ?? row.providerId);
  }
});

test("a fixture sentence naming nothing on the roster earns no chips", () => {
  assert.deepEqual(
    fixtureMentionChips("Nothing here names a session.", fixtureSnapshot("smoke").sessions),
    [],
  );
});
