import assert from "node:assert/strict";
import test from "node:test";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { admittedForTest } from "@sidecar/wire/testing";
import type { ProviderTranscriptSinceResult } from "./act-results.js";
import { ACT_KIND } from "./advertised-acts.js";
import { mergePlugins, type SessionProviderPlugin } from "./provider-plugin.js";
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

test("a transcript read stops at the observer that holds the session", async () => {
  const asked: string[] = [];
  const reader = (name: string, answer: ProviderTranscriptSinceResult): SessionProviderPlugin => ({
    provider: { id: "merged", displayName: "merged" },
    observe: async () => [],
    latest: () => [],
    reads: {
      transcriptSince: async () => {
        asked.push(name);
        return answer;
      },
    },
  });
  // The first observer refuses in its own words — a compressed rollout it can
  // see but cannot render — and that refusal is the session's own answer, so
  // the second observer is never asked for a transcript it does not hold.
  const merged = mergePlugins({ id: "merged", displayName: "Merged" }, [
    reader("local", { status: ACT_RESULT_STATUS.REJECTED, reason: "compressed" }),
    reader("cloud", { status: ACT_RESULT_STATUS.ACCEPTED, text: "cloud words", truncated: false }),
  ]);

  assert.deepEqual(await merged.reads?.transcriptSince?.("session-1"), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "compressed",
  });
  assert.deepEqual(asked, ["local"]);
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
