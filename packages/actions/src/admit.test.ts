import assert from "node:assert/strict";
import test from "node:test";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { ObservedWorkspaceProject as ListedProject, Session } from "@sidecar/session";
import {
  ACTION_KIND,
  ISSUE_TRACKER_ID,
  maximumWorkspaceNameLength,
  normalizeSession,
  normalizeTrackedIssue,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  type TrackedIssue,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import {
  ACTION_FAMILY,
  ACTIONS,
  REALTIME_TOOL,
  type RealtimeFunctionCall,
  realtimeToolFamily,
  SESSION_LIST_ALL,
  SESSION_LIST_VOICE,
  toolAction,
} from "./index.js";
import { withoutAdmission } from "./testing/admitted.js";
import { itemEnum, objectProperties } from "./testing/json-schema.js";

/**
 * One tool call admitted, as the payload alone: the brand and the origin are
 * dropped so a case can say what was admitted without restating either. Every
 * case below reads admission's own answer, which is the only answer there is.
 */
async function sessionToolAction(
  call: RealtimeFunctionCall,
  sessions: readonly Session[],
  workspaceProjects: readonly ListedProject[] = [],
  agentModels: (providerId: string) => readonly WorkspaceAgentModels[] = () => [],
  defaultProviderId?: string,
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
) {
  return withoutAdmission(
    await toolAction(call, {
      origin: RUN_ORIGIN.USER,
      roster: { read: async () => sessions },
      projects: {
        read: async () => workspaceProjects,
        defaults: async () => ({ defaultProviderId, defaultProjectIds }),
        agentModels,
      },
    }),
  );
}

async function issueToolAction(call: RealtimeFunctionCall, issues: readonly TrackedIssue[]) {
  return withoutAdmission(
    await toolAction(call, {
      origin: RUN_ORIGIN.USER,
      roster: { read: async () => [] },
      issues,
    }),
  );
}

const DECIDED_AT = 1_800_000_000_000;

function actionableSession() {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "conductor-1",
      title: "Conductor: luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      advertises: [
        { kind: ACTION_KIND.MESSAGE },
        {
          kind: ACTION_KIND.CONTROL,
          id: "cancel-run",
          label: "Stop this run",
          controlKind: SESSION_CONTROL_KIND.STOP,
        },
      ],
      detail: { link: "https://app.conductor.build/sessions/conductor-1" },
    },
  );
}

function messageCall(argumentsJson: string, name: string = REALTIME_TOOL.SEND_SESSION_MESSAGE) {
  return { name, argumentsJson };
}

test("a tool call can act only on a session Luke was shown, doing what it advertised", async () => {
  const roster = [actionableSession()];
  const identity = '"provider_id":"conductor","provider_session_id":"conductor-1"';

  assert.deepEqual(
    await sessionToolAction(messageCall(`{${identity},"text":"add tests too"}`), roster),
    {
      kind: "message",
      identity: { providerId: "conductor", providerSessionId: "conductor-1" },
      text: "add tests too",
    },
  );
  assert.deepEqual(
    await sessionToolAction(
      messageCall(`{${identity},"control_id":"cancel-run"}`, REALTIME_TOOL.RUN_SESSION_CONTROL),
      roster,
    ),
    {
      kind: "control",
      identity: { providerId: "conductor", providerSessionId: "conductor-1" },
      control: {
        kind: ACTION_KIND.CONTROL,
        id: "cancel-run",
        label: "Stop this run",
        controlKind: SESSION_CONTROL_KIND.STOP,
      },
    },
  );
  // The open action carries the identity and nothing else: the address stays
  // in the main process's registry, where the press reads it back.
  assert.deepEqual(
    await sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.OPEN_SESSION), roster),
    {
      kind: "open",
      identity: { providerId: "conductor", providerSessionId: "conductor-1" },
    },
  );

  // Every way a call can point somewhere Luke was not shown is a refusal with
  // a reason he can say aloud, never a request that reaches a bridge.
  const refusals = [
    await sessionToolAction(messageCall("not json"), roster),
    await sessionToolAction(
      messageCall('{"provider_id":"conductor","provider_session_id":"other"}'),
      roster,
    ),
    await sessionToolAction(messageCall(`{${identity},"text":""}`), roster),
    await sessionToolAction(messageCall(`{${identity},"text":"${"a".repeat(4_100)}"}`), roster),
    await sessionToolAction(
      messageCall(`{${identity},"control_id":"terminate"}`, REALTIME_TOOL.RUN_SESSION_CONTROL),
      roster,
    ),
    await sessionToolAction(messageCall(`{${identity},"text":"hi"}`, "delete_everything"), roster),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);

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
  const silentRefusal = await sessionToolAction(
    messageCall('{"provider_id":"codex","provider_session_id":"thread-1","text":"hi"}'),
    [quiet],
  );
  assert.equal(silentRefusal.status, ACTION_RESULT_STATUS.REJECTED);
  // No address means nowhere to open, however real the identity is.
  const nowhereToOpen = await sessionToolAction(
    messageCall(
      '{"provider_id":"codex","provider_session_id":"thread-1"}',
      REALTIME_TOOL.OPEN_SESSION,
    ),
    [quiet],
  );
  assert.equal(nowhereToOpen.status, ACTION_RESULT_STATUS.REJECTED);

  // The retired spoken transcript reading is no action at all: a call naming it
  // is refused as unknown rather than routed anywhere.
  const retired = await sessionToolAction(
    messageCall(`{${identity}}`, "read_session_transcript"),
    roster,
  );
  assert.equal(retired.status, ACTION_RESULT_STATUS.REJECTED);
});

test("an open ask can pick the app, held to the roster's own associations", async () => {
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
    await sessionToolAction(
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
    await sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.OPEN_SESSION), [held]),
    { kind: "open", identity: { providerId: "codex", providerSessionId: "thread-2" } },
  );

  // An association without an address opens nothing, and an app the roster
  // never listed opens nothing; each refusal says where the session does open.
  for (const application of ["Conductor", "TextEdit"]) {
    const refusal = await sessionToolAction(
      messageCall(`{${identity},"application":"${application}"}`, REALTIME_TOOL.OPEN_SESSION),
      [held],
    );
    assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
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

test("a creation ask may name a model, by the name the guide lists it under", async () => {
  const projects = [OFFERED_PROJECT];
  const identity = '"provider_id":"conductor","project_id":"proj-1"';

  // Named by label, carried as the wire pairing, effort beside it.
  assert.deepEqual(
    await sessionToolAction(
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
    await sessionToolAction(
      messageCall(`{${identity},"model":"GPT-9"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
      conductorAgentModels,
    ),
    await sessionToolAction(
      messageCall(
        `{${identity},"model":"Cursor Auto","effort":"max"}`,
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
      conductorAgentModels,
    ),
    await sessionToolAction(
      messageCall(`{${identity},"effort":"max"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
      conductorAgentModels,
    ),
    await sessionToolAction(
      messageCall(`{${identity},"model":"Fable 5"}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
});

test("an added agent may carry a model, only of the asked-for kind", async () => {
  const spawning = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "bucharest-v1",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      advertises: [{ kind: ACTION_KIND.ADD_AGENT, agents: ["claude", "cursor"] }],
    },
  );
  const identity = '"provider_id":"conductor","provider_session_id":"chat-1"';

  assert.deepEqual(
    await sessionToolAction(
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
  const mismatched = await sessionToolAction(
    messageCall(
      `{${identity},"agent":"cursor","model":"Fable 5"}`,
      REALTIME_TOOL.ADD_WORKSPACE_AGENT,
    ),
    [spawning],
    [],
    conductorAgentModels,
  );
  assert.equal(mismatched.status, ACTION_RESULT_STATUS.REJECTED);
  if (mismatched.status === ACTION_RESULT_STATUS.REJECTED) {
    assert.match(mismatched.reason ?? "", /cursor agent runs no model/);
  }
});

test("a creation ask can only name a project Luke was shown", async () => {
  const projects = [OFFERED_PROJECT];
  const identity = '"provider_id":"conductor","project_id":"proj-1"';

  assert.deepEqual(
    await sessionToolAction(
      messageCall(`{${identity}}`, REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
    { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
  );
  assert.deepEqual(
    await sessionToolAction(
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
    await sessionToolAction(
      messageCall(
        '{"provider_id":"conductor","project_id":"other"}',
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    await sessionToolAction(
      messageCall('{"provider_id":"codex","project_id":"proj-1"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
    await sessionToolAction(
      messageCall(
        `{${identity},"name":"${"a".repeat(maximumWorkspaceNameLength + 1)}"}`,
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    // No list, no ask: a roster of sessions is not a list of projects.
    await sessionToolAction(messageCall(`{${identity}}`, REALTIME_TOOL.CREATE_WORKSPACE), [
      actionableSession(),
    ]),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
});

test("an implicit project resolves only when the latest roster has one match", async () => {
  assert.deepEqual(
    await sessionToolAction(
      messageCall('{"provider_id":"conductor"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT],
    ),
    { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
  );

  const ambiguous = await sessionToolAction(
    messageCall('{"provider_id":"conductor"}', REALTIME_TOOL.CREATE_WORKSPACE),
    [],
    [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }],
  );
  assert.equal(ambiguous.status, ACTION_RESULT_STATUS.REJECTED);
  // SAFETY: Refused session-tool actions carry a reason string this assertion inspects.
  assert.match((ambiguous as { reason?: string }).reason ?? "", /More than one listed project/);
});

test("the saved defaults settle what a creation ask leaves unnamed", async () => {
  const localTwin: ObservedWorkspaceProject = {
    ...OFFERED_PROJECT,
    providerId: "conductor-local",
    providerName: "Conductor (local)",
    providerProjectId: "repo-7",
  };
  const noModels = () => [];

  // A nameless ask between the two Conductors goes to the default provider.
  assert.deepEqual(
    await sessionToolAction(
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
    await sessionToolAction(
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
    await sessionToolAction(
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
  const unsettled = await sessionToolAction(
    messageCall("{}", REALTIME_TOOL.CREATE_WORKSPACE),
    [],
    [OFFERED_PROJECT, localTwin],
    noModels,
    "superset",
  );
  assert.equal(unsettled.status, ACTION_RESULT_STATUS.REJECTED);

  // A saved project settles which project, never which provider: while no
  // default provider is chosen, an ask still spanning providers stays a
  // question even when exactly one candidate is some provider's chosen
  // project.
  const crossProvider = await sessionToolAction(
    messageCall("{}", REALTIME_TOOL.CREATE_WORKSPACE),
    [],
    [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }, localTwin],
    noModels,
    undefined,
    { conductor: "proj-2" },
  );
  assert.equal(crossProvider.status, ACTION_RESULT_STATUS.REJECTED);
});

test("another agent can only be added as a kind the session's own entry lists", async () => {
  const spawning = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "bucharest-v1",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: DECIDED_AT,
      advertises: [{ kind: ACTION_KIND.ADD_AGENT, agents: ["claude", "codex", "cursor"] }],
    },
  );
  const roster = [spawning, actionableSession()];
  const identity = '"provider_id":"conductor","provider_session_id":"chat-1"';

  assert.deepEqual(
    await sessionToolAction(
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
    await sessionToolAction(
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
    await sessionToolAction(
      messageCall(`{${identity},"agent":"unlisted-agent"}`, REALTIME_TOOL.ADD_WORKSPACE_AGENT),
      roster,
    ),
    // A session that lists no new agents takes no such ask at all.
    await sessionToolAction(
      messageCall(
        '{"provider_id":"conductor","provider_session_id":"conductor-1","agent":"claude"}',
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
    // The name and the task keep their bounds.
    await sessionToolAction(
      messageCall(
        `{${identity},"agent":"claude","name":"${"a".repeat(maximumWorkspaceNameLength + 1)}"}`,
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
    await sessionToolAction(
      messageCall(
        `{${identity},"agent":"claude","task":"${"a".repeat(4_100)}"}`,
        REALTIME_TOOL.ADD_WORKSPACE_AGENT,
      ),
      roster,
    ),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
});

test("an opening task is held to the project's own word for it", async () => {
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
    await sessionToolAction(
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
  const bare = await sessionToolAction(
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
    await sessionToolAction(
      messageCall('{"provider_id":"cursor","project_id":"proj-1"}', REALTIME_TOOL.CREATE_WORKSPACE),
      [],
      projects,
    ),
    // A project that takes none is handed none.
    await sessionToolAction(
      messageCall(
        '{"provider_id":"codex","project_id":"proj-1","task":"Add the XYZ feature"}',
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
    // A task is bounded like the message it is.
    await sessionToolAction(
      messageCall(
        `{"provider_id":"cursor","project_id":"proj-1","task":"${"a".repeat(4_100)}"}`,
        REALTIME_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    ),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
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

test("an issue tool call can act only on an issue Luke was shown, going where its tracker allows", async () => {
  const roster = [actionableIssue()];
  const identity = '"tracker_id":"linear","issue_id":"LUKE-123"';

  assert.deepEqual(await issueToolAction(issueCall(`{${identity},"state":"Done"}`), roster), {
    kind: "issue-state",
    identity: { trackerId: "linear", identifier: "LUKE-123" },
    transition: { id: "state-done", name: "Done" },
  });
  // A spoken state arrives with its case retold rather than copied.
  assert.deepEqual(await issueToolAction(issueCall(`{${identity},"state":"done"}`), roster), {
    kind: "issue-state",
    identity: { trackerId: "linear", identifier: "LUKE-123" },
    transition: { id: "state-done", name: "Done" },
  });
  assert.deepEqual(
    await issueToolAction(
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
    await issueToolAction(issueCall("not json"), roster),
    await issueToolAction(
      issueCall('{"tracker_id":"linear","issue_id":"LUKE-999","state":"Done"}'),
      roster,
    ),
    // The issue's own state is not a transition its tracker advertised.
    await issueToolAction(issueCall(`{${identity},"state":"In Progress"}`), roster),
    await issueToolAction(issueCall(`{${identity},"state":""}`), roster),
    await issueToolAction(
      issueCall(`{${identity},"body":""}`, REALTIME_TOOL.COMMENT_ON_ISSUE),
      roster,
    ),
    await issueToolAction(
      issueCall(`{${identity},"body":"${"a".repeat(4_100)}"}`, REALTIME_TOOL.COMMENT_ON_ISSUE),
      roster,
    ),
    await issueToolAction(issueCall(`{${identity},"state":"Done"}`, "delete_everything"), roster),
  ];
  for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);

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
    (await issueToolAction(issueCall(`{${quietIdentity},"state":"Done"}`), [still])).status,
    ACTION_RESULT_STATUS.REJECTED,
  );
  assert.equal(
    (
      await issueToolAction(
        issueCall(`{${quietIdentity},"body":"hi"}`, REALTIME_TOOL.COMMENT_ON_ISSUE),
        [still],
      )
    ).status,
    ACTION_RESULT_STATUS.REJECTED,
  );
});

test("each action belongs to one family", async () => {
  assert.equal(realtimeToolFamily(REALTIME_TOOL.SEND_SESSION_MESSAGE), ACTION_FAMILY.SESSION);
  assert.equal(realtimeToolFamily(REALTIME_TOOL.UPDATE_ISSUE_STATE), ACTION_FAMILY.ISSUE);
  assert.equal(realtimeToolFamily(REALTIME_TOOL.COMMENT_ON_ISSUE), ACTION_FAMILY.ISSUE);
  assert.equal(realtimeToolFamily("delete_everything"), undefined);
  assert.equal(ACTIONS.CHANGE_APP_SETTING.family, ACTION_FAMILY.APP);
  assert.equal(ACTIONS.SEND_SESSION_MESSAGE.family, ACTION_FAMILY.SESSION);
  assert.equal(ACTIONS.UPDATE_ISSUE_STATE.family, ACTION_FAMILY.ISSUE);
});

test("show_panel's filter enum carries the whole vocabulary its validator accepts", async () => {
  const values = itemEnum(objectProperties(ACTIONS.SHOW_PANEL.request.jsonSchema()).filters);

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
