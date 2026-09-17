import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { ObservedWorkspaceProject as ListedProject, Session } from "@sidecar/session";
import {
  ACTION_KIND,
  maximumWorkspaceNameLength,
  normalizeSession,
  type ObservedWorkspaceProject,
  PROVIDER_ID_LIST,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  workspaceAgentModels,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
import {
  ACTION_REFUSAL,
  ACTION_TOOL,
  ACTIONS,
  SESSION_LIST_ALL,
  SESSION_LIST_VOICE,
} from "./index.js";
import { withoutAdmission } from "./testing/admitted.js";
import { itemEnum, objectProperties } from "./testing/json-schema.js";
import { type ActionFunctionCall, admitToolCall } from "./testing/tool-call.js";

/**
 * One tool call admitted, as the payload alone: the brand and the origin are
 * dropped so a case can say what was admitted without restating either. Every
 * case below reads admission's own answer, which is the only answer there is.
 */
function sessionToolAction(
  call: ActionFunctionCall,
  sessions: readonly Session[],
  workspaceProjects: readonly ListedProject[] = [],
  agentModels: (providerId: string) => readonly WorkspaceAgentModels[] = () => [],
  defaultProviderId?: string,
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
) {
  return Effect.map(
    admitToolCall(call, {
      origin: RUN_ORIGIN.USER,
      roster: { read: () => Effect.succeed(sessions) },
      projects: {
        read: () => Effect.succeed(workspaceProjects),
        defaults: () => Effect.succeed({ defaultProviderId, defaultProjectIds }),
        agentModels,
      },
    }),
    withoutAdmission,
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

function messageCall(argumentsJson: string, name: string = ACTION_TOOL.SEND_SESSION_MESSAGE) {
  return { name, argumentsJson };
}

it.effect("a tool call can act only on a session Luke was shown, doing what it advertised", () =>
  Effect.gen(function* () {
    const roster = [actionableSession()];
    const identity = '"provider_id":"conductor","provider_session_id":"conductor-1"';

    assert.deepEqual(
      yield* sessionToolAction(messageCall(`{${identity},"text":"add tests too"}`), roster),
      {
        kind: "message",
        identity: { providerId: "conductor", providerSessionId: "conductor-1" },
        text: "add tests too",
      },
    );
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall(`{${identity},"control_id":"cancel-run"}`, ACTION_TOOL.RUN_SESSION_CONTROL),
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
      yield* sessionToolAction(messageCall(`{${identity}}`, ACTION_TOOL.OPEN_SESSION), roster),
      {
        kind: "open",
        identity: { providerId: "conductor", providerSessionId: "conductor-1" },
      },
    );

    // Every way a call can point somewhere Luke was not shown is a refusal with
    // a reason he can say aloud, never a request that reaches a bridge.
    const refusals = [
      yield* sessionToolAction(messageCall("not json"), roster),
      yield* sessionToolAction(
        messageCall('{"provider_id":"conductor","provider_session_id":"other"}'),
        roster,
      ),
      yield* sessionToolAction(messageCall(`{${identity},"text":""}`), roster),
      yield* sessionToolAction(messageCall(`{${identity},"text":"${"a".repeat(4_100)}"}`), roster),
      yield* sessionToolAction(
        messageCall(`{${identity},"control_id":"terminate"}`, ACTION_TOOL.RUN_SESSION_CONTROL),
        roster,
      ),
      yield* sessionToolAction(
        messageCall(`{${identity},"text":"hi"}`, "delete_everything"),
        roster,
      ),
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
    const silentRefusal = yield* sessionToolAction(
      messageCall('{"provider_id":"codex","provider_session_id":"thread-1","text":"hi"}'),
      [quiet],
    );
    assert.equal(silentRefusal.status, ACTION_RESULT_STATUS.REJECTED);
    // No address means nowhere to open, however real the identity is.
    const nowhereToOpen = yield* sessionToolAction(
      messageCall(
        '{"provider_id":"codex","provider_session_id":"thread-1"}',
        ACTION_TOOL.OPEN_SESSION,
      ),
      [quiet],
    );
    assert.equal(nowhereToOpen.status, ACTION_RESULT_STATUS.REJECTED);

    // The retired spoken transcript reading is no action at all: a call naming it
    // is refused as unknown rather than routed anywhere.
    const retired = yield* sessionToolAction(
      messageCall(`{${identity}}`, "read_session_transcript"),
      roster,
    );
    assert.equal(retired.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("an open ask can pick the app, held to the roster's own associations", () =>
  Effect.gen(function* () {
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
      yield* sessionToolAction(
        messageCall(`{${identity},"application":"superset"}`, ACTION_TOOL.OPEN_SESSION),
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
      yield* sessionToolAction(messageCall(`{${identity}}`, ACTION_TOOL.OPEN_SESSION), [held]),
      { kind: "open", identity: { providerId: "codex", providerSessionId: "thread-2" } },
    );

    // An association without an address opens nothing, and an app the roster
    // never listed opens nothing; each refusal says where the session does open.
    for (const application of ["Conductor", "TextEdit"]) {
      const refusal = yield* sessionToolAction(
        messageCall(`{${identity},"application":"${application}"}`, ACTION_TOOL.OPEN_SESSION),
        [held],
      );
      assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
    }
  }),
);

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
  {
    agent: "claude",
    models: [
      { id: "fable-5", label: "Fable 5" },
      { id: "fable-5-1", label: "Fable 5.1" },
    ],
    efforts: ["low", "max"],
  },
  { agent: "codex", models: [{ id: "gpt-5.4", label: "GPT-5.4" }], efforts: ["high"] },
  { agent: "cursor", models: [{ id: "auto", label: "Cursor Auto" }], efforts: [] },
];

function conductorAgentModels(providerId: string): readonly WorkspaceAgentModels[] {
  return providerId === "conductor" ? AGENT_TABLE : [];
}

it.effect("a creation ask may name a model, by the name the guide lists it under", () =>
  Effect.gen(function* () {
    const projects = [OFFERED_PROJECT];
    const identity = '"provider_id":"conductor","project_id":"proj-1"';

    // Named by label, carried as the wire pairing, effort beside it.
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall(`{${identity},"model":"Fable 5","effort":"max"}`, ACTION_TOOL.CREATE_WORKSPACE),
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
      yield* sessionToolAction(
        messageCall(`{${identity},"model":"GPT-9"}`, ACTION_TOOL.CREATE_WORKSPACE),
        [],
        projects,
        conductorAgentModels,
      ),
      yield* sessionToolAction(
        messageCall(
          `{${identity},"model":"Cursor Auto","effort":"max"}`,
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        projects,
        conductorAgentModels,
      ),
      yield* sessionToolAction(
        messageCall(`{${identity},"effort":"max"}`, ACTION_TOOL.CREATE_WORKSPACE),
        [],
        projects,
        conductorAgentModels,
      ),
      yield* sessionToolAction(
        messageCall(`{${identity},"model":"Fable 5"}`, ACTION_TOOL.CREATE_WORKSPACE),
        [],
        projects,
      ),
    ];
    for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect(
  "a creation's model is matched as it is said, and never re-decides the agent the ask named",
  () =>
    Effect.gen(function* () {
      const projects = [OFFERED_PROJECT];
      const identity = '"provider_id":"conductor","project_id":"proj-1"';
      const created = {
        kind: "create-workspace",
        providerId: "conductor",
        providerProjectId: "proj-1",
      };

      // The id with a dot for its hyphen, the label in any case, the id in
      // capitals: one model, because the name is retold rather than copied.
      for (const spoken of ["fable-5.1", "fable 5.1", "FABLE-5-1", "Fable 5.1"]) {
        assert.deepEqual(
          yield* sessionToolAction(
            messageCall(`{${identity},"model":"${spoken}"}`, ACTION_TOOL.CREATE_WORKSPACE),
            [],
            projects,
            conductorAgentModels,
          ),
          { ...created, agentSelection: { agent: "claude", model: "fable-5-1" } },
          spoken,
        );
      }
      // The folding never blurs two of the build's documented models into one:
      // every id and every label in the real table still names its own model.
      for (const entry of workspaceAgentModels("conductor")) {
        for (const model of entry.models) {
          for (const spoken of [model.id, model.label]) {
            assert.deepEqual(
              yield* sessionToolAction(
                messageCall(`{${identity},"model":"${spoken}"}`, ACTION_TOOL.CREATE_WORKSPACE),
                [],
                projects,
                workspaceAgentModels,
              ),
              { ...created, agentSelection: { agent: entry.agent, model: model.id } },
              spoken,
            );
          }
        }
      }

      // A claude agent asked for beside a codex model is a refusal that names
      // the agent, not a Codex workspace: the model never swaps the agent.
      const swapped = yield* sessionToolAction(
        messageCall(
          `{${identity},"agent":"claude","model":"gpt-5.4","effort":"high"}`,
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        projects,
        conductorAgentModels,
      );
      assert.deepEqual(swapped, {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "A claude agent runs no model by that name.",
      });
      // The same model beside its own agent, or beside no agent at all, rides.
      for (const agentField of ['"agent":"codex",', '"agent":"Codex",', ""]) {
        assert.deepEqual(
          yield* sessionToolAction(
            messageCall(
              `{${identity},${agentField}"model":"gpt-5.4","effort":"high"}`,
              ACTION_TOOL.CREATE_WORKSPACE,
            ),
            [],
            projects,
            conductorAgentModels,
          ),
          { ...created, agentSelection: { agent: "codex", model: "gpt-5.4", effort: "high" } },
          agentField,
        );
      }
      // A project's own default agent is not the developer's word: it neither
      // contradicts the model they named nor is it what a refusal names.
      const defaulting = [{ ...OFFERED_PROJECT, defaultAgent: "claude" }];
      assert.deepEqual(
        yield* sessionToolAction(
          messageCall(
            `{${identity},"agent":"codex","model":"gpt-5.4"}`,
            ACTION_TOOL.CREATE_WORKSPACE,
          ),
          [],
          defaulting,
          conductorAgentModels,
        ),
        { ...created, agent: "claude", agentSelection: { agent: "codex", model: "gpt-5.4" } },
      );
      assert.deepEqual(
        yield* sessionToolAction(
          messageCall(`{${identity},"model":"gpt-5.4"}`, ACTION_TOOL.CREATE_WORKSPACE),
          [],
          defaulting,
          conductorAgentModels,
        ),
        { ...created, agent: "claude", agentSelection: { agent: "codex", model: "gpt-5.4" } },
      );
      assert.deepEqual(
        yield* sessionToolAction(
          messageCall(
            `{${identity},"agent":"cursor","model":"gpt-5.4"}`,
            ACTION_TOOL.CREATE_WORKSPACE,
          ),
          [],
          defaulting,
          conductorAgentModels,
        ),
        {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "A cursor agent runs no model by that name.",
        },
      );
    }),
);

it.effect("an added agent may carry a model, only of the asked-for kind", () =>
  Effect.gen(function* () {
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
      yield* sessionToolAction(
        messageCall(
          `{${identity},"agent":"claude","model":"Fable 5","effort":"max"}`,
          ACTION_TOOL.ADD_WORKSPACE_AGENT,
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
    const mismatched = yield* sessionToolAction(
      messageCall(
        `{${identity},"agent":"cursor","model":"Fable 5"}`,
        ACTION_TOOL.ADD_WORKSPACE_AGENT,
      ),
      [spawning],
      [],
      conductorAgentModels,
    );
    assert.equal(mismatched.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("a creation ask can only name a project Luke was shown", () =>
  Effect.gen(function* () {
    const projects = [OFFERED_PROJECT];
    const identity = '"provider_id":"conductor","project_id":"proj-1"';

    assert.deepEqual(
      yield* sessionToolAction(
        messageCall(`{${identity}}`, ACTION_TOOL.CREATE_WORKSPACE),
        [],
        projects,
      ),
      { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
    );
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall(`{${identity},"name":"fix the panel"}`, ACTION_TOOL.CREATE_WORKSPACE),
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
      yield* sessionToolAction(
        messageCall(
          '{"provider_id":"conductor","project_id":"other"}',
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        projects,
      ),
      yield* sessionToolAction(
        messageCall('{"provider_id":"codex","project_id":"proj-1"}', ACTION_TOOL.CREATE_WORKSPACE),
        [],
        projects,
      ),
      yield* sessionToolAction(
        messageCall(
          `{${identity},"name":"${"a".repeat(maximumWorkspaceNameLength + 1)}"}`,
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        projects,
      ),
      // No list, no ask: a roster of sessions is not a list of projects.
      yield* sessionToolAction(messageCall(`{${identity}}`, ACTION_TOOL.CREATE_WORKSPACE), [
        actionableSession(),
      ]),
    ];
    for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("an implicit project resolves only when the latest roster has one match", () =>
  Effect.gen(function* () {
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall('{"provider_id":"conductor"}', ACTION_TOOL.CREATE_WORKSPACE),
        [],
        [OFFERED_PROJECT],
      ),
      { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
    );

    const ambiguous = yield* sessionToolAction(
      messageCall('{"provider_id":"conductor"}', ACTION_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }],
    );
    assert.equal(ambiguous.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("a target names a host only where the listed project carries one", () =>
  Effect.gen(function* () {
    const localTwin: ObservedWorkspaceProject = {
      ...OFFERED_PROJECT,
      providerId: "conductor-local",
      providerName: "Conductor (local)",
      providerProjectId: "repo-7",
      providerTargetId: "/Users/me/conductor/repos/luke",
    };
    const hosted = (target: string): ObservedWorkspaceProject => ({
      ...OFFERED_PROJECT,
      providerId: "superset",
      providerName: "Superset",
      providerTargetId: target,
      targetName: target,
    });
    const noModels = () => [];

    // A cloud project lists no target, so a target the ask invents for it — the
    // words the sibling lines' target_id invites — cannot hide the project it
    // named by provider and id.
    for (const invented of ["default", "luke", "cloud", "proj-1"]) {
      assert.deepEqual(
        yield* sessionToolAction(
          messageCall(
            `{"provider_id":"conductor","project_id":"proj-1","target_id":"${invented}"}`,
            ACTION_TOOL.CREATE_WORKSPACE,
          ),
          [],
          [OFFERED_PROJECT, localTwin],
          noModels,
          "conductor",
        ),
        { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
      );
    }

    // A target the list gives picks out the project that carries it, ahead of
    // the default provider's target-less twin.
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall(`{"target_id":"${localTwin.providerTargetId}"}`, ACTION_TOOL.CREATE_WORKSPACE),
        [],
        [OFFERED_PROJECT, localTwin],
        noModels,
        "conductor",
      ),
      {
        kind: "create-workspace",
        providerId: "conductor-local",
        providerProjectId: "repo-7",
        providerTargetId: localTwin.providerTargetId,
      },
    );

    // One repository on two hosts under one project id: the target chooses the
    // host, and a host the list never gave is refused by name rather than
    // guessed at or sent on to the target-less default.
    const hosts = [hosted("local"), hosted("studio")];
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall(
          '{"provider_id":"superset","project_id":"proj-1","target_id":"studio"}',
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        hosts,
      ),
      {
        kind: "create-workspace",
        providerId: "superset",
        providerProjectId: "proj-1",
        providerTargetId: "studio",
      },
    );
    const unlisted = yield* sessionToolAction(
      messageCall(
        '{"provider_id":"superset","project_id":"proj-1","target_id":"host-old"}',
        ACTION_TOOL.CREATE_WORKSPACE,
      ),
      [],
      hosts,
    );
    assert.equal(unlisted.status, ACTION_RESULT_STATUS.REJECTED);
    // SAFETY: Refused session-tool actions carry a reason string this assertion inspects.
    assert.equal((unlisted as { reason?: string }).reason, ACTION_REFUSAL.NO_TARGET);
    const wrongHostOnly = yield* sessionToolAction(
      messageCall(
        '{"provider_id":"conductor-local","target_id":"/Users/me/elsewhere"}',
        ACTION_TOOL.CREATE_WORKSPACE,
      ),
      [],
      [OFFERED_PROJECT, localTwin],
    );
    assert.equal(wrongHostOnly.status, ACTION_RESULT_STATUS.REJECTED);
    // SAFETY: Refused session-tool actions carry a reason string this assertion inspects.
    assert.equal((wrongHostOnly as { reason?: string }).reason, ACTION_REFUSAL.NO_TARGET);
  }),
);

it.effect("the saved defaults settle what a creation ask leaves unnamed", () =>
  Effect.gen(function* () {
    const localTwin: ObservedWorkspaceProject = {
      ...OFFERED_PROJECT,
      providerId: "conductor-local",
      providerName: "Conductor (local)",
      providerProjectId: "repo-7",
    };
    const noModels = () => [];

    // A nameless ask between the two Conductors goes to the default provider.
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall("{}", ACTION_TOOL.CREATE_WORKSPACE),
        [],
        [OFFERED_PROJECT, localTwin],
        noModels,
        "conductor",
      ),
      { kind: "create-workspace", providerId: "conductor", providerProjectId: "proj-1" },
    );

    // An ask that names its own provider is never overridden by the default.
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall('{"provider_id":"conductor-local"}', ACTION_TOOL.CREATE_WORKSPACE),
        [],
        [OFFERED_PROJECT, localTwin],
        noModels,
        "conductor",
      ),
      { kind: "create-workspace", providerId: "conductor-local", providerProjectId: "repo-7" },
    );

    // The provider's chosen project settles an ask that names no project.
    assert.deepEqual(
      yield* sessionToolAction(
        messageCall('{"provider_id":"conductor"}', ACTION_TOOL.CREATE_WORKSPACE),
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
    const unsettled = yield* sessionToolAction(
      messageCall("{}", ACTION_TOOL.CREATE_WORKSPACE),
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
    const crossProvider = yield* sessionToolAction(
      messageCall("{}", ACTION_TOOL.CREATE_WORKSPACE),
      [],
      [OFFERED_PROJECT, { ...OFFERED_PROJECT, providerProjectId: "proj-2" }, localTwin],
      noModels,
      undefined,
      { conductor: "proj-2" },
    );
    assert.equal(crossProvider.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("another agent can only be added as a kind the session's own entry lists", () =>
  Effect.gen(function* () {
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
      yield* sessionToolAction(
        messageCall(
          `{${identity},"agent":"codex","name":"xyz feature","task":"Build the XYZ feature"}`,
          ACTION_TOOL.ADD_WORKSPACE_AGENT,
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
      yield* sessionToolAction(
        messageCall(`{${identity},"agent":"claude"}`, ACTION_TOOL.ADD_WORKSPACE_AGENT),
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
      yield* sessionToolAction(
        messageCall(`{${identity},"agent":"unlisted-agent"}`, ACTION_TOOL.ADD_WORKSPACE_AGENT),
        roster,
      ),
      // A session that lists no new agents takes no such ask at all.
      yield* sessionToolAction(
        messageCall(
          '{"provider_id":"conductor","provider_session_id":"conductor-1","agent":"claude"}',
          ACTION_TOOL.ADD_WORKSPACE_AGENT,
        ),
        roster,
      ),
      // The name and the task keep their bounds.
      yield* sessionToolAction(
        messageCall(
          `{${identity},"agent":"claude","name":"${"a".repeat(maximumWorkspaceNameLength + 1)}"}`,
          ACTION_TOOL.ADD_WORKSPACE_AGENT,
        ),
        roster,
      ),
      yield* sessionToolAction(
        messageCall(
          `{${identity},"agent":"claude","task":"${"a".repeat(4_100)}"}`,
          ACTION_TOOL.ADD_WORKSPACE_AGENT,
        ),
        roster,
      ),
    ];
    for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("an opening task is held to the project's own word for it", () =>
  Effect.gen(function* () {
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
      yield* sessionToolAction(
        messageCall(
          '{"provider_id":"cursor","project_id":"proj-1","task":"Add the XYZ feature"}',
          ACTION_TOOL.CREATE_WORKSPACE,
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
    const bare = yield* sessionToolAction(
      messageCall(
        '{"provider_id":"conductor","project_id":"proj-1"}',
        ACTION_TOOL.CREATE_WORKSPACE,
      ),
      [],
      projects,
    );
    assert.equal(bare.kind, "create-workspace");

    const refusals = [
      // A project that needs a task cannot be created without one.
      yield* sessionToolAction(
        messageCall('{"provider_id":"cursor","project_id":"proj-1"}', ACTION_TOOL.CREATE_WORKSPACE),
        [],
        projects,
      ),
      // A project that takes none is handed none.
      yield* sessionToolAction(
        messageCall(
          '{"provider_id":"codex","project_id":"proj-1","task":"Add the XYZ feature"}',
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        projects,
      ),
      // A task is bounded like the message it is.
      yield* sessionToolAction(
        messageCall(
          `{"provider_id":"cursor","project_id":"proj-1","task":"${"a".repeat(4_100)}"}`,
          ACTION_TOOL.CREATE_WORKSPACE,
        ),
        [],
        projects,
      ),
    ];
    for (const refusal of refusals) assert.equal(refusal.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it("show_panel's filter enum carries the whole vocabulary its validator accepts", () => {
  const values = itemEnum(objectProperties(emitJsonSchema(ACTIONS.SHOW_PANEL.request)).filters);

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
