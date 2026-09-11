import assert from "node:assert/strict";
import { hostedProjectsAnswerFromWire } from "@sidecar/hosted";
import { test } from "vitest";
import { encryptProviderKey } from "../server/hosted/encryption";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { observeAndSnapshot } from "../server/hosted/observation-pass";
import { handleProjects } from "../server/hosted/projects";
import type { VaultKeyRow } from "../server/hosted/vault-route";
import { memoryObservationStore } from "./support/observation-store";

const SECRET = "a".repeat(64);

function projectsRequest(): Request {
  return new Request("https://luke.test/api/projects", {
    method: "GET",
    headers: { authorization: "Bearer token-1" },
  });
}

function projectsOptions(
  overrides: Partial<Parameters<typeof handleProjects>[0]> = {},
): Parameters<typeof handleProjects>[0] {
  return {
    request: projectsRequest(),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readVaultKeys: async (): Promise<VaultKeyRow[]> => [],
    store: () => memoryObservationStore(),
    ...overrides,
  };
}

const KEY_ROWS: VaultKeyRow[] = [
  { providerId: "conductor", ciphertext: encryptProviderKey("conductor-key", SECRET) },
];

/** Conductor answering one project, and one more once `connected` is set, recording how often it was asked. */
function conductorProjects() {
  const state = { connected: false, reads: 0 };
  const fetch = async (url: string) => {
    state.reads += 1;
    if (url.endsWith("/me")) {
      return new Response(JSON.stringify({ userId: "u1" }), { status: 200 });
    }
    if (url.includes("/v0/projects")) {
      const data = [{ id: "proj-1", gitRemote: "https://github.com/owner/repo", name: "Repo" }];
      if (state.connected) {
        data.push({ id: "proj-2", gitRemote: "https://github.com/owner/other", name: "Other" });
      }
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  return { state, fetch };
}

function projectIds(body: { projects: Array<{ providerProjectId: string }> }): string[] {
  return body.projects.map((project) => project.providerProjectId);
}

test("projects are listed from the stored snapshot, seeded once, and a project connected later appears with the next pass", async () => {
  const store = memoryObservationStore();
  const conductor = conductorProjects();
  const options = () =>
    projectsOptions({
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: conductor.fetch,
    });

  assert.deepEqual(projectIds(await (await handleProjects(options())).json()), ["proj-1"]);
  assert.equal(store.snapshots.has("user-1"), true);
  const readsAfterSeeding = conductor.state.reads;

  conductor.state.connected = true;
  assert.deepEqual(projectIds(await (await handleProjects(options())).json()), ["proj-1"]);
  assert.equal(conductor.state.reads, readsAfterSeeding);

  // The schedule's next pass is what brings the new project to the phone,
  // and to admission at the same moment.
  await observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store,
    seams: { fetch: conductor.fetch },
    now: Date.now(),
  });
  assert.deepEqual(projectIds(await (await handleProjects(options())).json()), [
    "proj-1",
    "proj-2",
  ]);
});

test("the projects gate order is method, token, secret", async () => {
  const wrongMethod = await handleProjects(
    projectsOptions({
      request: new Request("https://luke.test/api/projects", { method: "POST" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleProjects(projectsOptions({ resolveUserId: async () => undefined }));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const noSecret = await handleProjects(projectsOptions({ encryptionSecret: undefined }));
  assert.equal(noSecret.status, 503);
});

test("with no vault keys stored the response is 200 with an empty projects array", async () => {
  const response = await handleProjects(
    projectsOptions({
      fetch: async () => {
        throw new Error("no provider may be observed without a key");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.projects, []);
});

test("a provider that fails its pass does not fail the whole answer", async () => {
  const ciphertext = encryptProviderKey("key", SECRET);
  const response = await handleProjects(
    projectsOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [{ providerId: "conductor", ciphertext }],
      fetch: async () => {
        throw new Error("connection refused");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.projects, []);
});

test("a projects answer skips malformed entries rather than failing", () => {
  const raw = {
    projects: [
      {
        providerId: "conductor",
        providerProjectId: "proj-1",
        repository: "owner/repo",
        taskSupport: "optional",
        targetName: "Main host",
      },
      {
        providerId: "codex",
        providerProjectId: "env-1",
        repository: "owner/repo",
        taskSupport: "required",
        namesItself: true,
      },
      {
        providerId: "codex",
        providerProjectId: "env-2",
        repository: "owner/repo",
        taskSupport: "required",
        namesItself: "yes", // not a boolean
      },
      { providerId: "conductor", providerProjectId: "proj-2" }, // missing fields
      {
        providerId: "conductor",
        providerProjectId: "proj-3",
        repository: "owner/repo",
        taskSupport: "sometimes", // not a known value
      },
    ],
  };
  const answer = hostedProjectsAnswerFromWire(JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  assert.equal(answer.projects.length, 3);
  assert.equal(answer.projects[0]?.providerProjectId, "proj-1");
  assert.equal(answer.projects[0]?.targetName, "Main host");
  assert.equal(answer.projects[0]?.namesItself, undefined);
  // The flag crosses only as the boolean it is; anything else reads as absent.
  assert.equal(answer.projects[1]?.namesItself, true);
  assert.equal(answer.projects[2]?.namesItself, undefined);
});

// --- The build's agent table rides beside the projects it applies to ---

test("a provider that offered a project carries its agent table on the answer", async () => {
  const ciphertext = encryptProviderKey("conductor-key", SECRET);
  const response = await handleProjects(
    projectsOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [{ providerId: "conductor", ciphertext }],
      fetch: async (url) => {
        if (url.endsWith("/me")) {
          return new Response(JSON.stringify({ userId: "u1" }), { status: 200 });
        }
        if (url.includes("/v0/projects")) {
          return new Response(
            JSON.stringify({
              data: [{ id: "proj-1", gitRemote: "https://github.com/owner/repo", name: "Repo" }],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].providerId, "conductor");
  assert.equal(body.projects[0].taskSupport, "optional");
  const agents = body.agentModels.map((entry: { agent: string }) => entry.agent);
  assert.deepEqual(agents, ["claude", "codex", "cursor"]);
  assert.ok(
    body.agentModels[0].models.some(
      (model: { id: string; label: string }) =>
        model.id === "fable-5-1" && model.label === "Fable 5.1",
    ),
  );

  const answer = hostedProjectsAnswerFromWire(body);
  assert.ok(answer);
  assert.equal(answer.agentModels.length, 3);
  const codex = answer.agentModels.find((entry) => entry.agent === "codex");
  assert.ok(
    codex?.models.some((model) => model.id === "gpt-6-astra" && model.label === "GPT-6 Astra"),
  );
});
