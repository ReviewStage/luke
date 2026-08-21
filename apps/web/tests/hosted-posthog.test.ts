import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetPosthogPerson,
  POSTHOG_DEFAULTS,
  type PosthogForgetOptions,
} from "../server/hosted/posthog";

const PERSONAL_KEY = "phx_personal";
const PROJECT_ID = "12345";

interface Sent {
  url: string;
  init: RequestInit;
}

function upstream(status = 200) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response("{}", { status });
  };
  return { fetch, sent };
}

function onlySent(sent: readonly Sent[]): Sent {
  assert.equal(sent.length, 1);
  const request = sent[0];
  assert.ok(request);
  return request;
}

function options(overrides: Partial<PosthogForgetOptions> = {}): PosthogForgetOptions {
  return { personalApiKey: PERSONAL_KEY, projectId: PROJECT_ID, ...overrides };
}

test("erasure asks the documented bulk delete for the one person and their events", async () => {
  const posthog = upstream();
  await forgetPosthogPerson("user-1", options({ fetch: posthog.fetch }));

  const { url, init } = onlySent(posthog.sent);
  assert.equal(
    url,
    `${POSTHOG_DEFAULTS.API_HOST}/api/projects/${PROJECT_ID}/persons/bulk_delete/?delete_events=true`,
  );
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${PERSONAL_KEY}`);
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(init.body)), { distinct_ids: ["user-1"] });
});

test("a configured private API host is used as given, without its trailing slash", async () => {
  const posthog = upstream();
  await forgetPosthogPerson(
    "user-1",
    options({ host: "https://eu.posthog.com/", fetch: posthog.fetch }),
  );

  const { url } = onlySent(posthog.sent);
  assert.equal(
    url,
    `https://eu.posthog.com/api/projects/${PROJECT_ID}/persons/bulk_delete/?delete_events=true`,
  );
});

test("a refusal throws the status alone, never anything that could name the key", async () => {
  const posthog = upstream(401);
  await assert.rejects(forgetPosthogPerson("user-1", options({ fetch: posthog.fetch })), {
    message: "Analytics erasure refused with status 401",
  });
});

test("a network fault reaches the caller, which owns deciding the delete proceeds", async () => {
  await assert.rejects(
    forgetPosthogPerson(
      "user-1",
      options({
        fetch: async () => {
          throw new Error("processor unreachable");
        },
      }),
    ),
    /processor unreachable/,
  );
});
