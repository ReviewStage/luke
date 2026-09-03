import assert from "node:assert/strict";
import test from "node:test";
import { ISSUE_TRACKER_ID, normalizeTrackedIssue } from "@sidecar/issues";
import {
  maximumWorkspaceNameLength,
  normalizeSession,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
} from "@sidecar/session";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import {
  ACTS,
  isIssueToolName,
  isSessionToolName,
  issueToolAction,
  REALTIME_TOOL,
  REALTIME_TOOL_FAMILY,
  SESSION_LIST_ALL,
  SESSION_LIST_VOICE,
  sessionToolAction,
} from "./acts.js";

const DECIDED_AT = 1_800_000_000_000;

function actionableSession() {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "conductor-1",
      title: "Conductor: luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      canReceiveMessage: true,
      controls: [{ id: "cancel-run", label: "Stop this run", kind: "stop" }],
      detail: { link: "https://app.conductor.build/sessions/conductor-1" },
    },
  );
}

function messageCall(argumentsJson: string, name: string = REALTIME_TOOL.SEND_SESSION_MESSAGE) {
  return { name, argumentsJson };
}

test("a tool call can act only on a session Luke was shown, doing what it advertised", () => {
  const roster = [actionableSession()];
  const identity = '"provider_id":"conductor","provider_session_id":"conductor-1"';

  assert.deepEqual(sessionToolAction(messageCall(`{${identity},"text":"add tests too"}`), roster), {
    kind: "message",
    identity: { providerId: "conductor", providerSessionId: "conductor-1" },
    text: "add tests too",
  });
  assert.deepEqual(
    sessionToolAction(
      messageCall(`{${identity},"control_id":"cancel-run"}`, REALTIME_TOOL.RUN_SESSION_CONTROL),
      roster,
    ),
    {
      kind: "control",
      identity: { providerId: "conductor", providerSessionId: "conductor-1" },
      control: { id: "cancel-run", label: "Stop this run", kind: "stop" },
    },
  );
  // The open action carries the identity and nothing else: the address stays
  // in the main process's registry, where the press reads it back.
  assert.deepEqual(
    sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.OPEN_SESSION), roster),
    {
      kind: "open",
      identity: { providerId: "conductor", providerSessionId: "conductor-1" },
    },
  );

  // A transcript read carries the identity and nothing else — the main
  // process locates the file in its own provider home — and is offered only
  // for a session on this machine.
  assert.deepEqual(
    sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.READ_SESSION_TRANSCRIPT), roster),
    {
      kind: "read-transcript",
      identity: { providerId: "conductor", providerSessionId: "conductor-1" },
    },
  );

  // Every way a call can point somewhere Luke was not shown is a refusal with
  // a reason he can say aloud, never a request that reaches a bridge.
  const refusals = [
    sessionToolAction(messageCall("not json"), roster),
    sessionToolAction(
      messageCall('{"provider_id":"conductor","provider_session_id":"other"}'),
      roster,
    ),
    sessionToolAction(messageCall(`{${identity},"text":""}`), roster),
    sessionToolAction(messageCall(`{${identity},"text":"${"a".repeat(4_100)}"}`), roster),
    sessionToolAction(
      messageCall(`{${identity},"control_id":"terminate"}`, REALTIME_TOOL.RUN_SESSION_CONTROL),
      roster,
    ),
    sessionToolAction(messageCall(`{${identity},"text":"hi"}`, "delete_everything"), roster),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);

  // A session that advertised nothing is offered nothing, out loud too.
  const quiet = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "thread-1",
      title: "Codex: luke",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: DECIDED_AT,
    },
  );
  const silentRefusal = sessionToolAction(
    messageCall('{"provider_id":"codex","provider_session_id":"thread-1","text":"hi"}'),
    [quiet],
  );
  assert.equal(silentRefusal.status, ACT_RESULT_STATUS.REJECTED);
  // No address means nowhere to open, however real the identity is.
  const nowhereToOpen = sessionToolAction(
    messageCall(
      '{"provider_id":"codex","provider_session_id":"thread-1"}',
      REALTIME_TOOL.OPEN_SESSION,
    ),
    [quiet],
  );
  assert.equal(nowhereToOpen.status, ACT_RESULT_STATUS.REJECTED);

  // A cloud session's conversation lives with its provider, not on this
  // machine, so a transcript read is refused rather than guessed at.
  const cloudSession = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "conductor-9",
      title: "Conductor: cloud",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      location: SESSION_LOCATION.CLOUD,
    },
  );
  const nothingToRead = sessionToolAction(
    messageCall(
      '{"provider_id":"conductor","provider_session_id":"conductor-9"}',
      REALTIME_TOOL.READ_SESSION_TRANSCRIPT,
    ),
    [cloudSession],
  );
  assert.equal(nothingToRead.status, ACT_RESULT_STATUS.REJECTED);
});

test("an open ask can pick the app, held to the roster's own associations", () => {
  const held = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "thread-2",
      title: "Codex: luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      detail: { link: "codex://thread/thread-2" },
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: "Superset",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "superset://v2-workspace/workspace-1?terminalId=terminal-1",
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
        },
      ],
    },
  );
  const identity = '"provider_id":"codex","provider_session_id":"thread-2"';

  // The developer's word for the app resolves to the build's id — by display
  // name in any case, or by the id itself — and the action carries that id,
  // never the address behind it.
  assert.deepEqual(
    sessionToolAction(
      messageCall(`{${identity},"application":"superset"}`, REALTIME_TOOL.OPEN_SESSION),
      [held],
    ),
    {
      kind: "open",
      identity: { providerId: "codex", providerSessionId: "thread-2" },
      applicationId: SESSION_APPLICATION_ID.SUPERSET,
    },
  );

  // An ask that names no app keeps the row's own destination.
  assert.deepEqual(
    sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.OPEN_SESSION), [held]),
    { kind: "open", identity: { providerId: "codex", providerSessionId: "thread-2" } },
  );

  // An association without an address opens nothing, and an app the roster
  // never listed opens nothing; each refusal says where the session does open.
  for (const application of ["Conductor", "TextEdit"]) {
    const refusal = sessionToolAction(
      messageCall(`{${identity},"application":"${application}"}`, REALTIME_TOOL.OPEN_SESSION),
      [held],
    );
    assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);
    assert.match(("reason" in refusal ? refusal.reason : "") ?? "", /opens in Superset/);
  }
});

const OFFERED_PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "proj-1",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

/**
 * A build-documented table the way the app declares one: labels for people,
 * ids for the wire, efforts per agent.
 */
const AGENT_TABLE: readonly WorkspaceAgentModels[] = [
  { agent: "claude", models: [{ id: "fable-5", label: "Fable 5" }], efforts: ["low", "max"] },
  { agent: "cursor", models: [{ id: "auto", label: "Cursor Auto" }], efforts: [] },
];

function conductorAgentModels(providerId: string): readonly WorkspaceAgentModels[] {
  return providerId === "conductor" ? AGENT_TABLE : [];
}

test("a creation ask may name a model, by the name the guide lists it under", () => {
  const projects = [OFFERED_PROJECT];
  const identity = '"provider_id":"conductor","project_id":"proj-1"';

  // Named by label, carried as the wire pairing, effort beside it.
  assert.deepEqual(
    sessionToolAction(
      messageCall(`{${identity},"model":"Fable 5","effort":"max"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
      conductorAgentModels,
    ),
    {
      kind: "create-workspace",
      providerId: "conductor",
      providerProjectId: "proj-1",
      agentSelection: { agent: "claude", model: "fable-5", effort: "max" },
    },
  );

  // Every way the naming can leave the documented table is a refusal with a
  // reason Luke can say: a model no table lists, an effort the model's agent
  // does not document, an effort with no model beside it, and a provider the
  // build documents no models for at all.
  const refusals = [
    sessionToolAction(
      messageCall(`{${identity},"model":"GPT-9"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
      conductorAgentModels,
    ),
    sessionToolAction(
      messageCall(
        `{${identity},"model":"Cursor Auto","effort":"max"}`,
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
      conductorAgentModels,
    ),
    sessionToolAction(
      messageCall(`{${identity},"effort":"max"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
      conductorAgentModels,
    ),
    sessionToolAction(
      messageCall(`{${identity},"model":"Fable 5"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);
});

test("an added agent may carry a model, only of the asked-for kind", () => {
  const spawning = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "bucharest-v1",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      spawnableAgents: ["claude", "cursor"],
    },
  );
  const identity = '"provider_id":"conductor","provider_session_id":"chat-1"';

  assert.deepEqual(
    sessionToolAction(
      messageCall(
        `{${identity},"agent":"claude","model":"Fable 5","effort":"max"}`,
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      [spawning],
      [],
      conductorAgentModels,
    ),
    {
      kind: "add-agent",
      identity: { providerId: "conductor", providerSessionId: "chat-1" },
      agent: "claude",
      model: "fable-5",
      effort: "max",
    },
  );

  // The asked-for kind is never re-decided by the model named beside it: a
  // claude model on a cursor agent is a refusal, not a swap.
  const mismatched = sessionToolAction(
    messageCall(
      `{${identity},"agent":"cursor","model":"Fable 5"}`,
      REALTIME_TOOL.ADD_WORKSPACE_AGENT,
    ),
    [spawning],
    [],
    conductorAgentModels,
  );
  assert.equal(mismatched.status, ACT_RESULT_STATUS.REJECTED);
  if (mismatched.status === ACT_RESULT_STATUS.REJECTED) {
    assert.match(mismatched.reason ?? "", /cursor agent runs no model/);
  }
});

test("a creation ask can only name a project Luke was shown", () => {
  const projects = [OFFERED_PROJECT];
  const identity = '"provider_id":"conductor","project_id":"proj-1"';

  assert.deepEqual(
    sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.CREATE_WORKSPACE), [], projects),
    { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
  );
  assert.deepEqual(
    sessionToolAction(
      messageCall(`{${identity},"name":"fix the panel"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
    {
      kind: "create-workspace",
      providerId: "conductor",
      providerProjectId: "proj-1",
      name: "fix the panel",
    },
  );

  // Every way a call can point somewhere Luke was not shown — or carry a name
  // outside its bound — is a refusal with a reason he can say aloud.
  const refusals = [
    sessionToolAction(
      messageCall(
        '{"provider_id":"conductor","project_id":"other"}',
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    sessionToolAction(
      messageCall('{"provider_id":"codex","project_id":"proj-1"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
    sessionToolAction(
      messageCall(
        `{${identity},"name":"${"a".repeat(maximumWorkspaceNameLength + 1)}"}`,
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    // No list, no ask: a roster of sessions is not a list of projects.
    sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.CREATE_WORKSPACE), [
      actionableSession(),
    ]),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);
});

test("an implicit project resolves only when the latest roster has one match", () => {
  assert.deepEqual(
    sessionToolAction(
      messageCall('{"provider_id":"conductor"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT],
    ),
    { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
  );

  const ambiguous = sessionToolAction(
    messageCall('{"provider_id":"conductor"}', REALTIME_TOOL.CREATE_WORKSPACE),
    [],
    [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }],
  );
  assert.equal(ambiguous.status, ACT_RESULT_STATUS.REJECTED);
  // SAFETY: Refused session-tool actions carry a reason string this assertion inspects.
  assert.match((ambiguous as { reason?: string }).reason ?? "", /More than one listed project/);
});

test("the saved defaults settle what a creation ask leaves unnamed", () => {
  const localTwin: ObservedWorkspaceProject = {
    ...OFFERED_PROJECT,
    providerId: "conductor-local",
    providerName: "Conductor (local)",
    providerProjectId: "repo-7",
  };
  const noModels = () => [];

  // A nameless ask between the two Conductors goes to the default provider.
  assert.deepEqual(
    sessionToolAction(
      messageCall("{}", REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT, localTwin],
      noModels,
      "conductor",
    ),
    { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
  );

  // An ask that names its own provider is never overridden by the default.
  assert.deepEqual(
    sessionToolAction(
      messageCall('{"provider_id":"conductor-local"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT, localTwin],
      noModels,
      "conductor",
    ),
    { kind: "create-workspace", providerId: "conductor-local", providerProjectId: "repo-7" },
  );

  // The provider's chosen project settles an ask that names no project.
  assert.deepEqual(
    sessionToolAction(
      messageCall('{"provider_id":"conductor"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }],
      noModels,
      undefined,
      { conductor: "proj-2" },
    ),
    { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-2" },
  );

  // A default provider offering nothing settles nothing: the ask stays
  // ambiguous between the projects actually listed.
  const unsettled = sessionToolAction(
    messageCall("{}", REALTIME_TOOL.CREATE_WORKSPACE),
    [],
    [OFFERED_PROJECT, localTwin],
    noModels,
    "superset",
  );
  assert.equal(unsettled.status, ACT_RESULT_STATUS.REJECTED);

  // A saved project settles which project, never which provider: while no
  // default provider is chosen, an ask still spanning providers stays a
  // question even when exactly one candidate is some provider's chosen
  // project.
  const crossProvider = sessionToolAction(
    messageCall("{}", REALTIME_TOOL.CREATE_WORKSPACE),
    [],
    [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }, localTwin],
    noModels,
    undefined,
    { conductor: "proj-2" },
  );
  assert.equal(crossProvider.status, ACT_RESULT_STATUS.REJECTED);
});

test("another agent can only be added as a kind the session's own entry lists", () => {
  const spawning = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "bucharest-v1",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      spawnableAgents: ["claude", "codex", "cursor"],
    },
  );
  const roster = [spawning, actionableSession()];
  const identity = '"provider_id":"conductor","provider_session_id":"chat-1"';

  assert.deepEqual(
    sessionToolAction(
      messageCall(
        `{${identity},"agent":"codex","name":"xyz feature","task":"Build the XYZ feature"}`,
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
    {
      kind: "add-agent",
      identity: { providerId: "conductor", providerSessionId: "chat-1" },
      agent: "codex",
      name: "xyz feature",
      task: "Build the XYZ feature",
    },
  );
  // Bare is fine too: the agent is the only thing the endpoint cannot default.
  assert.deepEqual(
    sessionToolAction(
      messageCall(`{${identity},"agent":"claude"}`, REALTIME_TOOL.ADD_WORKSPACE_AGENT),
      roster,
    ),
    {
      kind: "add-agent",
      identity: { providerId: "conductor", providerSessionId: "chat-1" },
      agent: "claude",
    },
  );

  const refusals = [
    // An agent kind the entry does not list is refused, not forwarded.
    sessionToolAction(
      messageCall(`{${identity},"agent":"unlisted-agent"}`, REALTIME_TOOL.ADD_WORKSPACE_AGENT),
      roster,
    ),
    // A session that lists no new agents takes no such ask at all.
    sessionToolAction(
      messageCall(
        '{"provider_id":"conductor","provider_session_id":"conductor-1","agent":"claude"}',
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
    // The name and the task keep their bounds.
    sessionToolAction(
      messageCall(
        `{${identity},"agent":"claude","name":"${"a".repeat(maximumWorkspaceNameLength + 1)}"}`,
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
    sessionToolAction(
      messageCall(
        `{${identity},"agent":"claude","task":"${"a".repeat(4_100)}"}`,
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);
});

test("an opening task is held to the project's own word for it", () => {
  const requiresTask: ObservedWorkspaceProject = {
    ...OFFERED_PROJECT,
    providerId: "cursor",
    providerName: "Cursor",
    taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
  };
  const takesNoTask: ObservedWorkspaceProject = {
    ...OFFERED_PROJECT,
    providerId: "codex",
    providerName: "Codex",
    taskSupport: WORKSPACE_TASK_SUPPORT.NONE,
  };
  const projects = [OFFERED_PROJECT, requiresTask, takesNoTask];

  // A task rides through where the project takes one, in the developer's words.
  assert.deepEqual(
    sessionToolAction(
      messageCall(
        '{"provider_id":"cursor","project_id":"proj-1","task":"Add the XYZ feature"}',
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    {
      kind: "create-workspace",
      providerId: "cursor",
      providerProjectId: "proj-1",
      task: "Add the XYZ feature",
    },
  );
  // A project with an optional task is happy either way.
  const bare = sessionToolAction(
    messageCall(
      '{"provider_id":"conductor","project_id":"proj-1"}',
      REALTIME_TOOL.CREATE_WORKSPACE,
    ),
    [],
    projects,
  );
  assert.equal(bare.kind, "create-workspace");

  const refusals = [
    // A project that needs a task cannot be created without one.
    sessionToolAction(
      messageCall('{"provider_id":"cursor","project_id":"proj-1"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
    // A project that takes none is handed none.
    sessionToolAction(
      messageCall(
        '{"provider_id":"codex","project_id":"proj-1","task":"Add the XYZ feature"}',
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    // A task is bounded like the message it is.
    sessionToolAction(
      messageCall(
        `{"provider_id":"cursor","project_id":"proj-1","task":"${"a".repeat(4_100)}"}`,
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);
});

function actionableIssue() {
  const issue = normalizeTrackedIssue(
    { id: ISSUE_TRACKER_ID.LINEAR, displayName: "Linear" },
    {
      trackerIssueId: "issue-uuid-1",
      identifier: "LUKE-123",
      title: "Add Codex support",
      stateName: "In Progress",
      observedAt: DECIDED_AT,
      transitions: [
        { id: "state-done", name: "Done" },
        { id: "state-review", name: "In Review" },
      ],
      canComment: true,
    },
  );
  assert.ok(issue);
  return issue;
}

function issueCall(argumentsJson: string, name: string = REALTIME_TOOL.UPDATE_ISSUE_STATE) {
  return { name, argumentsJson };
}

test("an issue tool call can act only on an issue Luke was shown, going where its tracker allows", () => {
  const roster = [actionableIssue()];
  const identity = '"tracker_id":"linear","issue_id":"LUKE-123"';

  assert.deepEqual(issueToolAction(issueCall(`{${identity},"state":"Done"}`), roster), {
    kind: "issue-state",
    identity: { trackerId: "linear", identifier: "LUKE-123" },
    transition: { id: "state-done", name: "Done" },
  });
  // A spoken state arrives with its case retold rather than copied.
  assert.deepEqual(issueToolAction(issueCall(`{${identity},"state":"done"}`), roster), {
    kind: "issue-state",
    identity: { trackerId: "linear", identifier: "LUKE-123" },
    transition: { id: "state-done", name: "Done" },
  });
  assert.deepEqual(
    issueToolAction(
      issueCall(`{${identity},"body":"deferred to next release"}`, REALTIME_TOOL.COMMENT_ON_ISSUE),
      roster,
    ),
    {
      kind: "issue-comment",
      identity: { trackerId: "linear", identifier: "LUKE-123" },
      body: "deferred to next release",
    },
  );

  // Every way a call can point somewhere Luke was not shown is a refusal with
  // a reason he can say aloud, never a request that reaches a bridge.
  const refusals = [
    issueToolAction(issueCall("not json"), roster),
    issueToolAction(
      issueCall('{"tracker_id":"linear","issue_id":"LUKE-999","state":"Done"}'),
      roster,
    ),
    // The issue's own state is not a transition its tracker advertised.
    issueToolAction(issueCall(`{${identity},"state":"In Progress"}`), roster),
    issueToolAction(issueCall(`{${identity},"state":""}`), roster),
    issueToolAction(issueCall(`{${identity},"body":""}`, REALTIME_TOOL.COMMENT_ON_ISSUE), roster),
    issueToolAction(
      issueCall(`{${identity},"body":"${"a".repeat(4_100)}"}`, REALTIME_TOOL.COMMENT_ON_ISSUE),
      roster,
    ),
    issueToolAction(issueCall(`{${identity},"state":"Done"}`, "delete_everything"), roster),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACT_RESULT_STATUS.REJECTED);

  // An issue that advertised nothing is offered nothing, out loud too.
  const still = normalizeTrackedIssue(
    { id: ISSUE_TRACKER_ID.LINEAR, displayName: "Linear" },
    {
      trackerIssueId: "issue-uuid-2",
      identifier: "LUKE-124",
      title: "Read-only issue",
      stateName: "Todo",
      observedAt: DECIDED_AT,
    },
  );
  assert.ok(still);
  const quietIdentity = '"tracker_id":"linear","issue_id":"LUKE-124"';
  assert.equal(
    issueToolAction(issueCall(`{${quietIdentity},"state":"Done"}`), [still]).status,
    ACT_RESULT_STATUS.REJECTED,
  );
  assert.equal(
    issueToolAction(issueCall(`{${quietIdentity},"body":"hi"}`, REALTIME_TOOL.COMMENT_ON_ISSUE), [
      still,
    ]).status,
    ACT_RESULT_STATUS.REJECTED,
  );
});

test("the session and issue tools answer to their own validators", () => {
  assert.equal(isSessionToolName(REALTIME_TOOL.SEND_SESSION_MESSAGE), true);
  assert.equal(isSessionToolName(REALTIME_TOOL.UPDATE_ISSUE_STATE), false);
  assert.equal(isIssueToolName(REALTIME_TOOL.UPDATE_ISSUE_STATE), true);
  assert.equal(isIssueToolName(REALTIME_TOOL.COMMENT_ON_ISSUE), true);
  assert.equal(isIssueToolName("delete_everything"), false);
  assert.equal(ACTS.CHANGE_APP_SETTING.family, REALTIME_TOOL_FAMILY.APP);
  assert.equal(ACTS.SEND_SESSION_MESSAGE.family, REALTIME_TOOL_FAMILY.SESSION);
  assert.equal(ACTS.UPDATE_ISSUE_STATE.family, REALTIME_TOOL_FAMILY.ISSUE);
});

test("show_panel's filter enum carries the whole vocabulary its validator accepts", () => {
  const filters = ACTS.SHOW_PANEL.schema.parameters.properties.filters;
  const values = filters.items.enum;

  // The enum is what binds the model to real tokens instead of the
  // developer's own words for them — a value the validator accepts but the
  // enum never lists is a narrowing no ask can reach, and the sets must stay
  // the ones the chips draw from so the two cannot drift.
  const scopes = [
    SESSION_LIST_ALL,
    SESSION_LOCATION.LOCAL,
    SESSION_LOCATION.CLOUD,
    SESSION_LIST_VOICE,
  ];
  for (const value of [...scopes, ...PROVIDER_ID_LIST, ...Object.values(SESSION_APPLICATION_ID)]) {
    assert.ok(values.includes(value), `the filter enum never lists "${value}"`);
  }
  // One token is one value however many sets carry it.
  assert.equal(new Set(values).size, values.length);
});
