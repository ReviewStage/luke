import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { DEVICE_AGENT_REQUEST_KIND, deviceAgentLayout } from "@luke/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";

const AGENT = "6f1c2b9e-1d3a-4c55-9a0e-2f6b8c1d0e11";

const NODE = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** A home with one agent's worktree holding a file, a secret beside the home, the agent's gh sign-in, and a symlink in the worktree pointing at each. */
const staged = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("luke-local-agent-");
  const layout = deviceAgentLayout(`${root}/home`, AGENT);
  yield* fileSystem.makeDirectory(layout.checkoutPath, { recursive: true });
  yield* fileSystem.writeFileString(`${layout.checkoutPath}/notes.txt`, "the agent's own");
  yield* fileSystem.writeFileString(`${root}/secret.txt`, "the developer's own");
  yield* fileSystem.symlink(`${root}/secret.txt`, `${layout.checkoutPath}/escape.txt`);
  yield* fileSystem.makeDirectory(layout.githubConfig, { recursive: true });
  yield* fileSystem.writeFileString(`${layout.githubConfig}/hosts.yml`, "oauth_token: ghs_fixture");
  yield* fileSystem.symlink(`${layout.githubConfig}/hosts.yml`, `${layout.checkoutPath}/gh.yml`);
  return { root, layout };
});

const read = (layout: ReturnType<typeof deviceAgentLayout>, path: string) =>
  answeredLocalAgentRequest(layout, {
    kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
    args: { path, maxBytes: 1_024 },
  });

describe("answeredLocalAgentRequest", () => {
  it.effect("reads a file inside the agent's folder", () =>
    Effect.gen(function* () {
      const { layout } = yield* staged;
      const answer = yield* read(layout, `${layout.checkoutPath}/notes.txt`);
      assert.deepStrictEqual(answer, {
        kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
        bytes: new TextEncoder().encode("the agent's own"),
      });
    }).pipe(Effect.scoped, Effect.provide(NODE)),
  );

  it.effect.each([
    { case: "a path outside the agent's folder", path: (root: string) => `${root}/secret.txt` },
    {
      case: "a path that climbs out with ..",
      path: (root: string) =>
        `${root}/home/.luke/agents/${AGENT}/repository/../../../../../secret.txt`,
    },
    {
      case: "a symlink in the worktree pointing outside",
      path: (root: string) => `${root}/home/.luke/agents/${AGENT}/repository/escape.txt`,
    },
    {
      case: "the agent's own gh sign-in, where a host keeps its GitHub token",
      path: (root: string) => `${root}/home/.luke/agents/${AGENT}/gh/hosts.yml`,
    },
    {
      case: "a symlink in the worktree pointing at the agent's gh sign-in",
      path: (root: string) => `${root}/home/.luke/agents/${AGENT}/repository/gh.yml`,
    },
  ])("refuses $case", ({ path }) =>
    Effect.gen(function* () {
      const { root, layout } = yield* staged;
      const answer = yield* read(layout, path(root));
      assert.deepStrictEqual(answer, { kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE, bytes: null });
    }).pipe(Effect.scoped, Effect.provide(NODE)),
  );
});
