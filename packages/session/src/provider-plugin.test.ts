import assert from "node:assert/strict";
import test from "node:test";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { ACT_KIND, SESSION_CONTROL_KIND } from "./advertised-acts.js";
import {
  type ProviderControlRequest,
  type ProviderConversationRequest,
  type ProviderSessionMessage,
  type ProviderSessionRenameRequest,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRenameRequest,
  type ProviderWorkspaceRequest,
  SessionProviderAdapterBase,
} from "./provider-contract.js";
import { adapterAsPlugin } from "./provider-plugin.js";
import type { ProviderSessionObservation } from "./session-shape.js";
import { SESSION_STATUS } from "./session-status.js";
import { WORKSPACE_TASK_SUPPORT, type WorkspaceProject } from "./workspace-projects.js";

const OBSERVED_AT = Date.parse("2026-09-01T09:00:00.000Z");

const PROJECT: WorkspaceProject = {
  providerProjectId: "project-1",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

const OBSERVATION: ProviderSessionObservation = {
  providerSessionId: "session-1",
  title: "luke",
  status: SESSION_STATUS.WORKING,
  lastActivityAt: OBSERVED_AT,
};

/** Every request the adapter interface takes, recorded rather than acted on. */
class RecordingAdapter extends SessionProviderAdapterBase {
  readonly provider = { id: "recording", displayName: "Recording" };
  readonly asked: unknown[] = [];
  observations: readonly ProviderSessionObservation[] = [OBSERVATION];

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    return this.observations;
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return [PROJECT];
  }

  override async sendMessage(message: ProviderSessionMessage) {
    this.asked.push(message);
    return { status: ACT_RESULT_STATUS.ACCEPTED } as const;
  }

  override async executeControl(request: ProviderControlRequest) {
    this.asked.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED } as const;
  }

  override async createWorkspace(request: ProviderWorkspaceRequest) {
    this.asked.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED } as const;
  }

  override async spawnWorkspaceAgent(request: ProviderWorkspaceAgentRequest) {
    this.asked.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED } as const;
  }

  override async renameWorkspace(request: ProviderWorkspaceRenameRequest) {
    this.asked.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED } as const;
  }

  override async renameSession(request: ProviderSessionRenameRequest) {
    this.asked.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED } as const;
  }

  override async readTranscript(providerSessionId: string) {
    this.asked.push({ readTranscript: providerSessionId });
    return { status: ACT_RESULT_STATUS.ACCEPTED, transcript: "" } as const;
  }

  override async readTranscriptSince(providerSessionId: string, cursor?: string) {
    this.asked.push({ readTranscriptSince: providerSessionId, cursor });
    return { status: ACT_RESULT_STATUS.ACCEPTED, text: "", truncated: false } as const;
  }

  override async readConversation(request: ProviderConversationRequest) {
    this.asked.push(request);
    return { status: ACT_RESULT_STATUS.ACCEPTED, messages: [], hasMore: false } as const;
  }
}

test("publishes the roster the pass answered with, and nothing before a pass", async () => {
  const adapter = new RecordingAdapter();
  const plugin = adapterAsPlugin(adapter);

  assert.deepEqual(plugin.latest(), []);
  const observed = await plugin.observe();

  assert.deepEqual(observed, [OBSERVATION]);
  assert.deepEqual(plugin.latest(), [OBSERVATION]);
  assert.deepEqual(plugin.projects?.(), [PROJECT]);
});

test("carries every act and read to the adapter, naming the observation's own session", async () => {
  const adapter = new RecordingAdapter();
  const plugin = adapterAsPlugin(adapter);
  await plugin.observe();
  const control = {
    kind: ACT_KIND.CONTROL,
    id: "cancel-turn",
    label: "Stop this turn",
    controlKind: SESSION_CONTROL_KIND.STOP,
  } as const;

  await plugin.acts?.message?.({ request: { text: "ship it" }, observation: OBSERVATION });
  await plugin.acts?.control?.({ request: { control }, observation: OBSERVATION });
  await plugin.acts?.createWorkspace?.({ project: PROJECT, task: "start here" });
  await plugin.acts?.spawnAgent?.({ request: { agent: "claude" }, observation: OBSERVATION });
  await plugin.acts?.renameWorkspace?.({ request: { name: "notch" }, observation: OBSERVATION });
  await plugin.acts?.renameSession?.({ request: { name: "notch" }, observation: OBSERVATION });
  await plugin.reads?.transcript?.("session-1");
  await plugin.reads?.transcriptSince?.("session-1", "cursor-1");
  await plugin.reads?.conversation?.({ request: { beforeOffset: 20 }, observation: OBSERVATION });

  assert.deepEqual(adapter.asked, [
    { providerSessionId: "session-1", text: "ship it" },
    { providerSessionId: "session-1", control },
    { providerProjectId: "project-1", task: "start here" },
    { providerSessionId: "session-1", agent: "claude" },
    { providerSessionId: "session-1", name: "notch" },
    { providerSessionId: "session-1", name: "notch" },
    { readTranscript: "session-1" },
    { readTranscriptSince: "session-1", cursor: "cursor-1" },
    { providerSessionId: "session-1", beforeOffset: 20 },
  ]);
});

test("leaves an act the caller did not choose out of the request entirely", async () => {
  const adapter = new RecordingAdapter();
  const plugin = adapterAsPlugin(adapter);
  await plugin.observe();

  await plugin.acts?.createWorkspace?.({ project: PROJECT });

  assert.deepEqual(adapter.asked, [{ providerProjectId: "project-1" }]);
});
