import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { parseKeyRing, sealEnvironmentValue } from "@luke/database/models/provider-key-seal";
import { saveWorkspaceEnvironmentValue } from "@luke/database/models/workspace-environment-store";
import { organization, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  WORKSPACE_ENVIRONMENT_KIND,
  type WorkspaceEnvironmentKind,
} from "@luke/features/workspace-environment-wire";
import { Effect, Layer, Redacted, Result } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import {
  MASKED_SECRET,
  maskSecrets,
  type ShellEnvironment,
  workspaceShellEnvironment,
} from "./workspace-environment.js";

/**
 * A workspace's environment as a coding agent's command runs with it: every
 * value it can open, by name, its secrets kept to be masked; one sealed
 * under a key the deployment no longer holds left out; and none where the
 * deployment holds no ring. A secret's value is masked out of every text of
 * an answer, however deep, and nothing else in it moves.
 *
 * Synthetic accounts, workspaces, and values; the key-encryption keys are
 * fixed bytes written for this file.
 */

const KEK = {
  ONE: `1:${Buffer.alloc(32, 1).toString("base64")}`,
  GONE: `9:${Buffer.alloc(32, 9).toString("base64")}`,
} as const;

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

const ringOf = (entries: string) => Result.getOrThrow(parseKeyRing(Redacted.make(entries)));

/** A workspace holding the values given, each sealed under the ring it names. */
const openWorkspace = (
  values: ReadonlyArray<readonly [string, WorkspaceEnvironmentKind, string, string]>,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const owner = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: owner, name: "Test User", email: `${owner}@luke.test` });
    const organizationId = randomUUID();
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Acme",
      slug: `workspace-${organizationId}`,
      createdAt: new Date(0),
    });
    for (const [name, kind, value, ring] of values) {
      const sealed = sealEnvironmentValue(
        ringOf(ring),
        { organizationId, name },
        Redacted.make(value),
      );
      yield* saveWorkspaceEnvironmentValue(
        organizationId,
        name,
        kind,
        sealed,
        "",
        owner,
        new Date(0),
      );
    }
    return organizationId;
  });

/** The workspace's environment read under the ring given, as plain values. */
const readUnder = (organizationId: string, ring: string | undefined) =>
  Effect.map(
    workspaceShellEnvironment(organizationId).pipe(
      Effect.provide(
        Layer.succeed(HostedEnvironment, {
          ...NO_ENVIRONMENT,
          providerKeyEncryptionKeys: ring === undefined ? undefined : Redacted.make(ring),
        }),
      ),
    ),
    (environment) => ({
      values: environment.values.map(([name, value]) => [name, Redacted.value(value)]),
      secrets: environment.secrets.map(Redacted.value),
    }),
  );

it.layer(getTestDB())("a workspace's shell environment", (it) => {
  it.effect(
    "holds every value it can open by name, and keeps its secrets, longest first, to mask",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace([
          ["APP_MODE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "development", KEK.ONE],
          ["SHORT_TOKEN", WORKSPACE_ENVIRONMENT_KIND.SECRET, "abcd1234", KEK.ONE],
          ["LONG_TOKEN", WORKSPACE_ENVIRONMENT_KIND.SECRET, "abcd1234-and-more", KEK.ONE],
          ["LOST", WORKSPACE_ENVIRONMENT_KIND.SECRET, "sealed-under-a-key-now-gone", KEK.GONE],
        ]);

        const read = yield* readUnder(workspace, KEK.ONE);

        assert.deepEqual(read, {
          values: [
            ["APP_MODE", "development"],
            ["LONG_TOKEN", "abcd1234-and-more"],
            ["SHORT_TOKEN", "abcd1234"],
          ],
          secrets: ["abcd1234-and-more", "abcd1234"],
        });
      }),
  );

  it.effect("holds nothing where the deployment holds no ring", () =>
    Effect.gen(function* () {
      const workspace = yield* openWorkspace([
        ["APP_MODE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "development", KEK.ONE],
      ]);

      assert.deepEqual(yield* readUnder(workspace, undefined), { values: [], secrets: [] });
    }),
  );
});

it("masks every secret out of each text of a running command's answer, the longer first, and moves nothing else", () => {
  const environment: ShellEnvironment = {
    values: [],
    secrets: [Redacted.make("abcd1234-and-more"), Redacted.make("abcd1234")],
  };
  const answer = {
    status: "running",
    pid: 7,
    outputDirectory: "/tmp/.eve/jobs/abcd1234",
    message: "still running with abcd1234",
    stdout: "long abcd1234-and-more, short abcd1234",
    stderr: "plain",
    truncated: false,
  } as const;

  assert.deepEqual(maskSecrets(answer, environment.secrets), {
    ...answer,
    outputDirectory: "/tmp/.eve/jobs/abcd1234",
    message: `still running with ${MASKED_SECRET}`,
    stdout: `long ${MASKED_SECRET}, short ${MASKED_SECRET}`,
  });
});
