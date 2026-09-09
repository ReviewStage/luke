import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  normalizeSession,
  type ObservedWorkspaceProject,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import {
  CONTEXT_ITEM_KIND,
  contextItemId,
  maximumVoiceContextSessions,
  maximumVoiceContextWorkspaceProjects,
  sessionContextText,
  workspaceProjectContextText,
} from "./standing-context.js";

const OBSERVED_AT = 1_800_000_000_000;

test("a context item is named apart from every other", () => {
  const first = contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 1);

  // The sequence rises rather than the name being reused: a delete that failed
  // would otherwise leave the old item sitting under the new one's name.
  assert.notEqual(first, contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 2));
  assert.notEqual(first, contextItemId(CONTEXT_ITEM_KIND.WORKSPACE_PROJECTS, 1));
});

test("session context carries only bounded, redacted fields", () => {
  const observed = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "Claude Code: checkout-service",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: OBSERVED_AT,
    },
  );

  const text = sessionContextText([observed]);

  assert.match(text, /Claude Code/);
  // The rule about the internal names is stated once, in the header, and each
  // row carries the name under a plain label.
  assert.match(text, /internal names/);
  assert.match(text, /never to refer to the work out loud/);
  assert.match(text, /title: Claude Code: checkout-service/);
  assert.match(text, /waiting/);
  // The identity is in the roster now — it is what a tool call names a session
  // by, and an opaque id is the user's own data rather than transcript — and
  // what the session can be asked to do rides beside it, so Luke never offers
  // what a provider has not promised.
  assert.match(text, /provider_session_id=session-a/);
  assert.match(text, /messages=false/);
  // A session that reported no address is offered nowhere to open — and the
  // roster says which sessions can be, never where they are.
  assert.match(text, /open=false/);
  assert.doesNotMatch(text, /https:/);

  const linked = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "conductor-1",
      title: "Conductor: luke",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      detail: { link: "https://app.conductor.build/sessions/conductor-1" },
    },
  );
  const linkedText = sessionContextText([linked]);
  assert.match(linkedText, /open=true/);
  assert.doesNotMatch(linkedText, /https:/);
});

test("a chat carries its workspace only as an internal reference", () => {
  const chat = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Revamp the notch panel",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      workspace: { providerWorkspaceId: "workspace-1", name: "lisbon-v2" },
    },
  );

  const text = sessionContextText([chat]);

  assert.match(text, /Revamp the notch panel/);
  assert.match(text, /workspace: lisbon-v2/);

  // An unnamed workspace goes unmentioned rather than leaking its internal id
  // off the machine: the id identifies nothing out loud.
  const unnamed = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-2",
      title: "Chase the memory leak",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      workspace: { providerWorkspaceId: "workspace-internal-uuid" },
    },
  );
  const unnamedText = sessionContextText([unnamed]);
  assert.doesNotMatch(unnamedText, /workspace-internal-uuid/);
  assert.doesNotMatch(unnamedText, /a chat in workspace/);

  // A session no provider grouped says nothing about workspaces at all.
  const ungrouped = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-b",
      title: "checkout-service",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
    },
  );
  assert.doesNotMatch(sessionContextText([ungrouped]), /workspace: /);
});

test("the roster identifies sessions managed by Superset", () => {
  const chat = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "chat-1",
      title: "Fix workspace creation",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      workspace: {
        providerWorkspaceId: "workspace-1",
        name: "power-vacation",
        scopeId: "superset",
        managerName: "Superset",
      },
    },
  );

  assert.match(sessionContextText([chat]), /managed by Superset/);
});

test("the roster names a session's app associations, so 'my Superset Codex session' resolves", () => {
  const annotated = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "codex-1",
      title: "Refit the settings drawer",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: "Superset",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "superset://v2-workspace/workspace-1?terminalId=terminal-1",
        },
      ],
    },
  );

  const text = sessionContextText([annotated]);

  assert.match(text, /associated with Superset/);
  // The association travels by name alone; the terminal address stays on the machine.
  assert.doesNotMatch(text, /superset:\/\//);
  // An association with an exact address is one an open ask may name, so the
  // capability line lists it — by the same name, and never the address.
  assert.match(text, /opens_in=Superset/);

  // A session no app claimed says nothing about associations at all.
  const unclaimed = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "codex-2",
      title: "Chase the flaky test",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
    },
  );
  assert.doesNotMatch(sessionContextText([unclaimed]), /associated with/);
  assert.doesNotMatch(sessionContextText([unclaimed]), /opens_in/);

  // An association without an address identifies the app but opens nothing,
  // so it rides the association line and stays off the capability line.
  const identifiedOnly = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-3",
      title: "Rework the roster",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
        },
      ],
    },
  );
  const identifiedText = sessionContextText([identifiedOnly]);
  assert.match(identifiedText, /associated with Conductor/);
  assert.doesNotMatch(identifiedText, /opens_in/);
});

test("the roster keeps a hosted chat's names as internal references", () => {
  const hosted = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "amber-shoal",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      agent: { id: "claude-code", displayName: "Claude Code" },
    },
  );

  assert.match(sessionContextText([hosted]), /- Claude Code in Conductor — title: amber-shoal/);
});

test("an empty roster says so rather than implying Luke sees nothing at all", () => {
  assert.match(sessionContextText([]), /No coding-agent sessions/);
});

test("the roster carries how long ago each session was last seen, in coarse buckets", () => {
  const minute = 60_000;
  const hour = 60 * minute;
  const now = OBSERVED_AT;
  const rosterAt = (elapsed: number): string => {
    const session = normalizeSession(
      { id: "claude-code", displayName: "Claude Code" },
      {
        providerSessionId: "session-a",
        title: "Bootstrap the desktop shell",
        status: SESSION_STATUS.WORKING,
        lastActivityAt: now - elapsed,
      },
    );
    return sessionContextText([session], now);
  };

  assert.match(rosterAt(30_000), /updated just now/);
  assert.match(rosterAt(4 * minute), /updated just now/);
  assert.match(rosterAt(30 * minute), /updated minutes ago/);
  assert.match(rosterAt(90 * minute), /updated about an hour ago/);
  assert.match(rosterAt(5 * hour), /updated hours ago/);
  assert.match(rosterAt(3 * 24 * hour), /updated a day or more ago/);

  // Provider clock skew (lastActivityAt ahead of now) also reads as "just now".
  assert.match(rosterAt(-minute), /updated just now/);
});

test("the roster text holds still across clock ticks inside one age bucket and moves at its edge", () => {
  const minute = 60_000;
  const lastActivityAt = OBSERVED_AT;
  const session = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "Bootstrap the desktop shell",
      status: SESSION_STATUS.WORKING,
      lastActivityAt,
    },
  );

  // Byte-identical, not merely similar: the roster is re-sent only when its
  // text changes, and text that moved with every minute tick would invalidate
  // the conversation's cached prefix with nothing new to say.
  assert.equal(
    sessionContextText([session], lastActivityAt + 10 * minute),
    sessionContextText([session], lastActivityAt + 45 * minute),
  );
  assert.notEqual(
    sessionContextText([session], lastActivityAt + 45 * minute),
    sessionContextText([session], lastActivityAt + 65 * minute),
  );
});

test("the roster identifies the most recent session and most recent openable chat per provider", () => {
  const newestClaude = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "claude-newest",
      title: "Newest local Claude chat",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 300,
    },
  );
  const openableClaude = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "claude-openable",
      title: "Older openable Claude chat",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: 200,
      detail: { link: "https://claude.ai/session/claude-openable" },
    },
  );
  const codex = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "codex-newest",
      title: "Newest Codex chat",
      status: SESSION_STATUS.COMPLETE,
      lastActivityAt: 100,
      detail: { link: "https://chatgpt.com/codex/tasks/codex-newest" },
    },
  );

  const lines = sessionContextText([newestClaude, openableClaude, codex]).split("\n");
  const newestClaudeLine = lines.find((line) => line.includes("claude-newest")) ?? "";
  const openableClaudeLine = lines.find((line) => line.includes("claude-openable")) ?? "";
  const codexLine = lines.find((line) => line.includes("codex-newest")) ?? "";

  assert.match(newestClaudeLine, /most_recent_for_provider=true/);
  assert.doesNotMatch(newestClaudeLine, /most_recent_openable_for_provider=true/);
  assert.doesNotMatch(openableClaudeLine, /most_recent_for_provider=true/);
  assert.match(openableClaudeLine, /most_recent_openable_for_provider=true/);
  assert.match(codexLine, /most_recent_for_provider=true/);
  assert.match(codexLine, /most_recent_openable_for_provider=true/);
});

test("the roster says what a session is doing and where, in the attention update's own fields", () => {
  const working = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-doing",
      title: "checkout-service",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      detail: {
        repository: "luke",
        branch: "dean/desktop-shell",
        activity: "Bash: pnpm test",
        error: "The request failed",
      },
    },
  );

  const text = sessionContextText([working]);
  // The branch outranks the repository the way the row's own place line reads:
  // one identifier per line, the most specific one.
  assert.match(text, /on branch dean\/desktop-shell/);
  assert.doesNotMatch(text, /in repository luke/);
  assert.match(text, /running Bash: pnpm test/);
  assert.match(text, /error: The request failed/);

  const bare = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-bare",
      title: "checkout-service",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: OBSERVED_AT,
      detail: { repository: "luke" },
    },
  );
  const bareText = sessionContextText([bare]);
  assert.match(bareText, /in repository luke/);
  assert.doesNotMatch(bareText, /running/);
  assert.doesNotMatch(bareText, /error:/);
});

test("the roster says which sessions keep a readable transcript and a pull request, never an address", () => {
  const local = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "thread-local",
      title: "luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: OBSERVED_AT,
    },
  );
  assert.match(sessionContextText([local]), /transcript=true/);

  const cloud = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "conductor-1",
      title: "luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: OBSERVED_AT,
      location: SESSION_LOCATION.CLOUD,
      detail: { change: "https://github.com/example/luke/pull/7" },
    },
  );
  const cloudText = sessionContextText([cloud]);
  assert.match(cloudText, /transcript=false/);
  // The pull request travels as a fact, like openability: the row is where it
  // opens from, and no address belongs in a conversation.
  assert.match(cloudText, /pull_request=true/);
  assert.doesNotMatch(cloudText, /github\.com/);
  assert.doesNotMatch(sessionContextText([local]), /pull_request=true/);
});

test("session context stays bounded when many sessions are observed", () => {
  const sessions = Array.from({ length: maximumVoiceContextSessions + 5 }, (_unused, index) =>
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: `session-${index}`,
        title: `Codex: workspace-${index}`,
        status: SESSION_STATUS.WORKING,
        lastActivityAt: OBSERVED_AT,
      },
    ),
  );

  const lines = sessionContextText(sessions).split("\n").slice(1);

  // The bound holds, and what it cut is said: a session past it must read as
  // unlisted, never as nonexistent.
  assert.equal(lines.length, maximumVoiceContextSessions + 1);
  assert.match(lines.at(-1) ?? "", /5 more observed sessions are not listed/);

  const exactlyAtBound = sessionContextText(sessions.slice(0, maximumVoiceContextSessions))
    .split("\n")
    .slice(1);
  assert.equal(exactlyAtBound.length, maximumVoiceContextSessions);
  assert.doesNotMatch(exactlyAtBound.at(-1) ?? "", /not listed/);
});

test("the bounded roster keeps every provider's most recent openable chat", () => {
  const codexSessions = Array.from({ length: maximumVoiceContextSessions }, (_unused, index) =>
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: `codex-${index}`,
        title: `Codex chat ${index}`,
        status: SESSION_STATUS.WORKING,
        lastActivityAt: 1_000 - index,
        detail: { link: `https://chatgpt.com/codex/tasks/${index}` },
      },
    ),
  );
  const olderClaude = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "claude-openable",
      title: "Claude chat",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: 1,
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: "Superset",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "superset://v2-workspace/one?terminalId=two",
        },
      ],
    },
  );

  const text = sessionContextText([...codexSessions, olderClaude]);

  assert.match(text, /provider_session_id=claude-openable/);
  assert.match(text, /most_recent_openable_for_provider=true/);
  assert.match(text, /1 more observed session is not listed/);
});

test("the roster says which agent kinds a session can start", () => {
  const spawning = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "bucharest-v1",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: OBSERVED_AT,
      advertises: [{ kind: ACTION_KIND.ADD_AGENT, agents: ["claude", "codex", "cursor"] }],
    },
  );

  // The roster says what can be started here, so an ask can name it exactly.
  assert.match(sessionContextText([spawning]), /agents=claude, codex, cursor/);
});

const OFFERED_PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "proj-1",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

test("the projects context lists each project with the identity a call names", () => {
  const text = workspaceProjectContextText([OFFERED_PROJECT]);

  assert.match(text, /Conductor — luke \[provider_id=conductor project_id=proj-1\]/);
  // A project that names its own workspaces says so, or the model would be
  // asked to compose a name the provider refuses.
  assert.doesNotMatch(text, /names its own workspaces/);
  assert.match(
    workspaceProjectContextText([{ ...OFFERED_PROJECT, namesItself: true }]),
    /takes an opening task; names its own workspaces/,
  );
  // An empty list is said in words, or the conversation would be free to
  // imagine somewhere a workspace could go.
  assert.match(workspaceProjectContextText([]), /No provider currently offers/);
});

test("a chosen default project survives the context cap", () => {
  // One more project than the context will list, alphabetical like the
  // normalizer hands them over, with the developer's chosen default sorted
  // dead last — exactly the project the cap would otherwise cut.
  const crowd = Array.from({ length: maximumVoiceContextWorkspaceProjects + 1 }, (_, index) => ({
    ...OFFERED_PROJECT,
    providerProjectId: `proj-${String(index).padStart(2, "0")}`,
    repository: `repo-${String(index).padStart(2, "0")}`,
  }));
  const last = crowd.at(-1);
  assert.ok(last);

  // Uncapped by the choice: without a default the tail stays cut.
  const capless = workspaceProjectContextText(crowd);
  assert.doesNotMatch(capless, new RegExp(last.providerProjectId));

  // The chosen default rides past the cut so the one project a nameless ask
  // lands in stays listed, marked, and steerable.
  const kept = workspaceProjectContextText(crowd, undefined, {
    conductor: last.providerProjectId,
  });
  assert.match(kept, new RegExp(`project_id=${last.providerProjectId}`));
});

test("the projects context says where a nameless ask goes, by id", () => {
  const localTwin: ObservedWorkspaceProject = {
    ...OFFERED_PROJECT,
    providerId: "conductor-local",
    providerName: "Conductor (local)",
    providerProjectId: "repo-7",
  };

  // Two providers wearing the same first word: the default is narrated by
  // provider_id, so the conversation can bind it to one of them instead of
  // asking which Conductor is meant.
  const chosen = workspaceProjectContextText([OFFERED_PROJECT, localTwin], "conductor");
  assert.match(
    chosen,
    /An ask that names no provider creates in Conductor \[provider_id=conductor\]/,
  );

  // A provider's chosen project is marked on its own line.
  const marked = workspaceProjectContextText(
    [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }],
    "conductor",
    { conductor: "proj-2" },
  );
  assert.match(marked, /project_id=proj-2[^\n]*the provider's default project/);
  assert.doesNotMatch(marked, /project_id=proj-1[^\n]*default project/);

  // While no default is chosen the context says the first creation decides;
  // a chosen default that stopped being offered steers nothing.
  assert.match(workspaceProjectContextText([OFFERED_PROJECT]), /No default provider is chosen yet/);
  assert.match(
    workspaceProjectContextText([OFFERED_PROJECT], "superset"),
    /default provider is not currently offering/,
  );

  // Offering is judged against everything offered, not the capped slice: a
  // default provider whose projects all fell past the cut still takes a
  // nameless ask, so the sentence must not disown it.
  const crowdedOut = [
    ...Array.from({ length: maximumVoiceContextWorkspaceProjects }, (_, index) => ({
      ...OFFERED_PROJECT,
      providerProjectId: `proj-${String(index).padStart(2, "0")}`,
    })),
    { ...OFFERED_PROJECT, providerId: "cursor", providerName: "Cursor" },
  ];
  assert.match(
    workspaceProjectContextText(crowdedOut, "cursor"),
    /An ask that names no provider creates in Cursor \[provider_id=cursor\]/,
  );
});
