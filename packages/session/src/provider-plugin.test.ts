import assert from "node:assert/strict";
import test from "node:test";
import { ACT_RESULT_STATUS, UNSUPPORTED_BY_OBSERVATION } from "@sidecar/wire";
import { admittedForTest } from "@sidecar/wire/testing";
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
import {
  adapterAsPlugin,
  mergePlugins,
  pluginAsAdapter,
  type SessionProviderPlugin,
} from "./provider-plugin.js";
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

  await plugin.acts?.message?.(
    admittedForTest({ request: { text: "ship it" }, observation: OBSERVATION }),
  );
  await plugin.acts?.control?.(admittedForTest({ request: { control }, observation: OBSERVATION }));
  await plugin.acts?.createWorkspace?.(admittedForTest({ project: PROJECT, task: "start here" }));
  await plugin.acts?.spawnAgent?.(
    admittedForTest({
      request: { spawnTarget: "workspace-1", agent: "claude" },
      observation: OBSERVATION,
    }),
  );
  await plugin.acts?.renameWorkspace?.(
    admittedForTest({
      request: { renameTarget: "workspace-1", name: "notch" },
      observation: OBSERVATION,
    }),
  );
  await plugin.acts?.renameSession?.(
    admittedForTest({ request: { name: "notch" }, observation: OBSERVATION }),
  );
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

  await plugin.acts?.createWorkspace?.(admittedForTest({ project: PROJECT }));

  assert.deepEqual(adapter.asked, [{ providerProjectId: "project-1" }]);
});

/** A plugin observing one named session and answering every act firmly. */
function stubPlugin(
  providerId: string,
  observations: readonly ProviderSessionObservation[],
  answer: () => Promise<{ status: typeof ACT_RESULT_STATUS.ACCEPTED }>,
  asked: string[],
): SessionProviderPlugin {
  return {
    provider: { id: providerId, displayName: providerId },
    observe: async () => observations,
    latest: () => observations,
    projects: () => [{ ...PROJECT, providerProjectId: `${providerId}-project` }],
    acts: {
      message: async () => {
        asked.push(providerId);
        return answer();
      },
    },
  };
}

const ADVERTISING_OBSERVATION: ProviderSessionObservation = {
  ...OBSERVATION,
  advertises: [{ kind: ACT_KIND.MESSAGE }],
};

const CLOUD_OBSERVATION: ProviderSessionObservation = {
  ...ADVERTISING_OBSERVATION,
  providerSessionId: "session-cloud",
};

test("merged plugins answer one roster, with a repeated session named once", async () => {
  const asked: string[] = [];
  const accepted = async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) as const;
  const local = stubPlugin("merged", [ADVERTISING_OBSERVATION], accepted, asked);
  const cloud = stubPlugin("merged", [ADVERTISING_OBSERVATION, CLOUD_OBSERVATION], accepted, asked);
  const merged = mergePlugins({ id: "merged", displayName: "Merged" }, [local, cloud]);

  assert.deepEqual(
    (await merged.observe()).map((entry) => entry.providerSessionId),
    ["session-1", "session-cloud"],
  );
  assert.deepEqual(
    merged.projects?.().map((project) => project.providerProjectId),
    ["merged-project", "merged-project"],
  );
});

test("a merged pass fails whole rather than retiring the observer that answered", async () => {
  const asked: string[] = [];
  const accepted = async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) as const;
  const working = stubPlugin("merged", [ADVERTISING_OBSERVATION], accepted, asked);
  const failing: SessionProviderPlugin = {
    provider: { id: "merged", displayName: "merged" },
    observe: async () => {
      throw new Error("the second observer failed");
    },
    latest: () => [],
  };
  const merged = mergePlugins({ id: "merged", displayName: "Merged" }, [working, failing]);

  await assert.rejects(merged.observe(), /the second observer failed/);
});

test("an act moves past an observer that never saw the session and stops at a firm answer", async () => {
  const asked: string[] = [];
  const unaware: SessionProviderPlugin = {
    provider: { id: "merged", displayName: "merged" },
    observe: async () => [],
    latest: () => [],
    acts: {
      message: async () => {
        asked.push("unaware");
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      },
    },
  };
  const holder = stubPlugin(
    "merged",
    [ADVERTISING_OBSERVATION],
    async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) as const,
    asked,
  );
  const merged = mergePlugins({ id: "merged", displayName: "Merged" }, [unaware, holder]);
  await merged.observe();

  const result = await merged.acts?.message?.(
    admittedForTest({ request: { text: "ship it" }, observation: ADVERTISING_OBSERVATION }),
  );

  assert.deepEqual(result, { status: ACT_RESULT_STATUS.ACCEPTED });
  // The unaware observer's own handler is never reached: its roster refused
  // the session before the handler could be asked.
  assert.deepEqual(asked, ["merged"]);
});

test("an act no observer holds answers unsupported once", async () => {
  const unaware: SessionProviderPlugin = {
    provider: { id: "merged", displayName: "merged" },
    observe: async () => [],
    latest: () => [],
  };
  const merged = mergePlugins({ id: "merged", displayName: "Merged" }, [unaware, unaware]);

  assert.deepEqual(
    await merged.acts?.message?.(
      admittedForTest({ request: { text: "ship it" }, observation: ADVERTISING_OBSERVATION }),
    ),
    { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "No provider observer supports that act." },
  );
});

test("merging an observer of another provider is refused outright", () => {
  const other: SessionProviderPlugin = {
    provider: { id: "other", displayName: "Other" },
    observe: async () => [],
    latest: () => [],
  };
  assert.throws(
    () => mergePlugins({ id: "merged", displayName: "Merged" }, [other]),
    /Merged plugin for merged cannot observe other/,
  );
});

test("an adapter read as a plugin and back answers every act the same way", async () => {
  const adapter = new RecordingAdapter();
  adapter.observations = [ADVERTISING_OBSERVATION];
  const roundTripped = pluginAsAdapter(adapterAsPlugin(adapter));
  await roundTripped.observe();

  assert.deepEqual(
    await roundTripped.sendMessage(admittedForTest({ providerSessionId: "session-1", text: "go" })),
    {
      status: ACT_RESULT_STATUS.ACCEPTED,
    },
  );
  assert.deepEqual(adapter.asked, [{ providerSessionId: "session-1", text: "go" }]);
  assert.deepEqual(roundTripped.workspaceProjects(), [PROJECT]);
});

test("a round-tripped adapter still refuses a session the pass did not report", async () => {
  const adapter = new RecordingAdapter();
  adapter.observations = [ADVERTISING_OBSERVATION];
  const roundTripped = pluginAsAdapter(adapterAsPlugin(adapter));
  await roundTripped.observe();

  assert.deepEqual(
    await roundTripped.sendMessage(
      admittedForTest({ providerSessionId: "session-absent", text: "go" }),
    ),
    { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: UNSUPPORTED_BY_OBSERVATION },
  );
  assert.deepEqual(adapter.asked, []);
});
