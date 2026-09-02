import assert from "node:assert/strict";
import test from "node:test";
import { hostedProjectsAnswerFromWire } from "@sidecar/hosted";
import { encryptProviderKey } from "../server/hosted/encryption";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { VaultKeyRow } from "../server/hosted/observe";
import { handleProjects } from "../server/hosted/projects";

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
    ...overrides,
  };
}

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

test("a key for a provider that cannot create workspaces is never spent", async () => {
  const ciphertext = encryptProviderKey("devin-key", SECRET);
  const response = await handleProjects(
    projectsOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [
        { providerId: "devin", ciphertext },
        { providerId: "jules", ciphertext },
        { providerId: "copilot", ciphertext },
      ],
      fetch: async () => {
        throw new Error("a creation-incapable provider must not be observed for projects");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.projects, []);
});

test("Cursor's repositories are awaited and reported as projects", async () => {
  const ciphertext = encryptProviderKey("cursor-key", SECRET);
  const response = await handleProjects(
    projectsOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [{ providerId: "cursor", ciphertext }],
      fetch: async (url) => {
        if (url.includes("/v1/repositories")) {
          return new Response(
            JSON.stringify({ items: [{ url: "https://github.com/owner/repo" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].providerId, "cursor");
  assert.equal(body.projects[0].providerProjectId, "https://github.com/owner/repo");
  assert.equal(body.projects[0].taskSupport, "required");

  const answer = hostedProjectsAnswerFromWire(body);
  assert.ok(answer);
  assert.equal(answer.projects.length, 1);
});

test("a provider that fails its pass does not fail the whole answer", async () => {
  const ciphertext = encryptProviderKey("key", SECRET);
  const response = await handleProjects(
    projectsOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [
        { providerId: "cursor", ciphertext },
        { providerId: "replicas", ciphertext },
      ],
      fetch: async (url) => {
        if (url.includes("cursor")) throw new Error("connection refused");
        return new Response(null, { status: 401 });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.projects, []);
});

test("hostedProjectsAnswerFromWire skips malformed entries rather than failing", () => {
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
      (model: { id: string; label: string }) => model.id === "fable-5" && model.label === "Fable 5",
    ),
  );

  const answer = hostedProjectsAnswerFromWire(body);
  assert.ok(answer);
  assert.equal(answer.agentModels.length, 3);
});

test("a provider with no table offers projects and no agent choices", async () => {
  const ciphertext = encryptProviderKey("cursor-key", SECRET);
  const response = await handleProjects(
    projectsOptions({
      readVaultKeys: async (): Promise<VaultKeyRow[]> => [{ providerId: "cursor", ciphertext }],
      fetch: async (url) => {
        if (url.includes("/v1/repositories")) {
          return new Response(
            JSON.stringify({ items: [{ url: "https://github.com/owner/repo" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projects.length, 1);
  assert.deepEqual(body.agentModels, []);
});
