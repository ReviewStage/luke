import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fixedBearer } from "@luke/features";
import { EXPERIMENT } from "@luke/settings";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect } from "effect";
import { AccountPreferencesClient } from "./account-preferences-client.js";

const PREFERENCES_ANSWER = {
  preferences: { voice: "marin" },
  updatedAt: 1_800_000_000_000,
};

interface RecordedRequest {
  url: string | URL | Request;
  init: RequestInit | undefined;
}

function service(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, fetchLike };
}

function client(options: Partial<ConstructorParameters<typeof AccountPreferencesClient>[0]> = {}) {
  return new AccountPreferencesClient({
    serviceBaseUrl: "https://tryluke.dev",
    credential: fixedBearer("token-1"),
    ...options,
  });
}

it.effect("writes account preferences as a full snapshot", () =>
  Effect.gen(function* () {
    const { requests, fetchLike } = service([
      () => new Response(JSON.stringify(PREFERENCES_ANSWER), { status: 200 }),
    ]);

    const answer = yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).writePreferences({
      voice: "marin",
    });
    assert.deepEqual(answer, {
      preferences: PREFERENCES_ANSWER.preferences,
      hasStoredSnapshot: true,
      // A service that answers no experiments part predates it: every experiment is off there.
      experiments: {},
    });

    const [request] = requests;
    assert.equal(request?.url, "https://tryluke.dev/api/account/preferences");
    assert.equal(request?.init?.method, "PUT");
    assert.equal(new Headers(request?.init?.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      preferences: { voice: "marin" },
    });
  }),
);

it.effect("reads the experiments part past a key it does not know, beside the voice", () =>
  Effect.gen(function* () {
    const { fetchLike } = service([
      () =>
        new Response(
          JSON.stringify({
            ...PREFERENCES_ANSWER,
            experiments: { [EXPERIMENT.FACTORY]: true, newer: true },
          }),
          { status: 200 },
        ),
    ]);

    const answer = yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).readPreferences();
    assert.deepEqual(answer, {
      preferences: PREFERENCES_ANSWER.preferences,
      hasStoredSnapshot: true,
      experiments: { [EXPERIMENT.FACTORY]: true },
    });
  }),
);

it.effect("writes an experiment's switch as a patch of that experiment alone", () =>
  Effect.gen(function* () {
    const { requests, fetchLike } = service([
      () =>
        new Response(
          JSON.stringify({ ...PREFERENCES_ANSWER, experiments: { [EXPERIMENT.FACTORY]: true } }),
          { status: 200 },
        ),
    ]);

    const answer = yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).writeExperiments({
      [EXPERIMENT.FACTORY]: true,
    });
    assert.deepEqual(answer?.experiments, { [EXPERIMENT.FACTORY]: true });

    const [request] = requests;
    assert.equal(request?.init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      experiments: { [EXPERIMENT.FACTORY]: true },
    });
  }),
);
