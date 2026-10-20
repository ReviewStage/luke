/**
 * agent-sandbox-image.test.ts -- the snapshot a native harness's sandbox opens from, as the deployment's environment names it, and none where it names none.
 */

import assert from "node:assert/strict";
import { Effect, Layer, Option } from "effect";
import { test } from "vitest";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { AgentSandboxImage, agentSandboxImageFromEnvironment } from "./agent-sandbox-image.js";

const NOTHING_SET: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  nativeAgentAccounts: [],
  agentSandboxSnapshot: undefined,
};

const snapshotUnder = (values: HostedEnvironmentValues) =>
  Effect.runPromise(
    Effect.flatMap(AgentSandboxImage, (image) => image.snapshotId).pipe(
      Effect.provide(
        Layer.provide(agentSandboxImageFromEnvironment, Layer.succeed(HostedEnvironment, values)),
      ),
    ),
  );

test("the snapshot is the one the deployment's environment names", async () => {
  const snapshot = await snapshotUnder({ ...NOTHING_SET, agentSandboxSnapshot: "snap_fixture" });

  assert.deepEqual(snapshot, Option.some("snap_fixture"));
});

test("a deployment that names no snapshot opens none", async () => {
  assert.deepEqual(await snapshotUnder(NOTHING_SET), Option.none());
});
