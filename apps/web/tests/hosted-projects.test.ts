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
  assert.equal(answer.projects.length, 1);
  assert.equal(answer.projects[0]?.providerProjectId, "proj-1");
  assert.equal(answer.projects[0]?.targetName, "Main host");
});
