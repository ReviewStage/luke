import assert from "node:assert/strict";
import { test } from "vitest";
import { fakeCloudApi, recordedRoutes } from "./cloud-fake.js";
import { HTTP_STATUS } from "./http-fake.js";

const API_KEY = "fake-api-key";

function get(url: string, apiKey = API_KEY) {
  const init: RequestInit = { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } };
  return { url, init };
}

test("answers a routed read and records what was asked", async () => {
  const api = fakeCloudApi({
    "GET /v0/sessions": { answer: () => ({ data: [{ id: "session-1" }] }) },
  });

  const request = get("https://api.test/v0/sessions?limit=20");
  const response = await api.fetch(request.url, request.init);

  assert.equal(response.status, HTTP_STATUS.OK);
  assert.deepEqual(await response.json(), { data: [{ id: "session-1" }] });
  assert.deepEqual(recordedRoutes(api.requests()), ["GET /v0/sessions?limit=20"]);
  assert.deepEqual(api.credentials(), [API_KEY]);
});

test("throws for a request no route names, rather than answering nothing", async () => {
  const api = fakeCloudApi({ "GET /v0/sessions": { answer: () => ({ data: [] }) } });

  const request = get("https://api.test/v0/undocumented");

  await assert.rejects(
    () => api.fetch(request.url, request.init),
    /no route for GET \/v0\/undocumented/,
  );
});

test("keys a write apart from the read on the same path", async () => {
  const api = fakeCloudApi({ "GET /v0/sessions": { answer: () => ({ data: [] }) } });

  await assert.rejects(
    () => api.fetch("https://api.test/v0/sessions", { method: "POST", body: "{}" }),
    /no route for POST \/v0\/sessions/,
  );
});

test("hands a write route its own request, and reads the body back", async () => {
  const api = fakeCloudApi({
    "POST /v0/sessions/session-1/messages": {
      answer: (request) => JSON.parse(request.body ?? "{}"),
      status: 201,
    },
  });

  const response = await api.fetch("https://api.test/v0/sessions/session-1/messages", {
    method: "POST",
    body: JSON.stringify({ message: "ship it" }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { message: "ship it" });
});

test("fails and heals every route at once", async () => {
  const api = fakeCloudApi({ "GET /v0/sessions": { answer: () => ({ data: [] }) } });
  const request = get("https://api.test/v0/sessions");

  api.fail();
  const failed = await api.fetch(request.url, request.init);
  api.fail(HTTP_STATUS.UNAUTHORIZED);
  const refused = await api.fetch(request.url, request.init);
  api.heal();
  const healed = await api.fetch(request.url, request.init);

  assert.equal(failed.status, HTTP_STATUS.SERVER_ERROR);
  assert.equal(refused.status, HTTP_STATUS.UNAUTHORIZED);
  assert.equal(healed.status, HTTP_STATUS.OK);
});
