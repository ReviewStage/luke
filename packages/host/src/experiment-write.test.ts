import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { fixedBearer } from "@luke/features";
import { EXPERIMENT, type ExperimentChoices, NO_EXPERIMENTS } from "@luke/settings";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { fakeHttpClientLayer, temporaryDirectory } from "@luke/wire/testing";
import { Deferred, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { test } from "vitest";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import {
  EXPERIMENT_ACCOUNT_CHANGED,
  EXPERIMENT_UNANSWERED,
  experimentWriter,
} from "./experiment-write.js";
import { type SecretCipher, SettingsStore } from "./settings-store.js";

/**
 * An experiment's switch written to a scripted service and kept in a real
 * settings file: what the service answers is what the store then holds and
 * the settings carry, two presses land in the order they were made however
 * the service answers them, and a write the service did not answer, or
 * answered after the account signed out, moves no switch.
 *
 * A synthetic account throughout.
 */

const ACCOUNT = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  email: "developer@example.com",
  provider: "github",
} as const;

/** Stands in for Electron's Keychain-backed `safeStorage`. */
const CIPHER: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plainText) => new TextEncoder().encode(plainText),
  decrypt: (cipherText) => new TextDecoder().decode(cipherText),
};

const FILE_SYSTEM = Effect.runSync(Effect.provide(FileSystem.FileSystem, NodeFileSystem.layer));
const PATH = Effect.runSync(Effect.provide(Path.Path, NodePath.layer));

/** A store over its own directory, the test's account signed in. */
async function signedInStore(directory: string): Promise<SettingsStore> {
  const store = new SettingsStore({
    directory: () => directory,
    cipher: CIPHER,
    overrides: { voice: undefined },
    fileSystem: FILE_SYSTEM,
    path: PATH,
  });
  await Effect.runPromise(store.setAccount(ACCOUNT));
  return store;
}

/** The account's service, answering each write as `answer` decides from its body and the write's place in line. */
function serviceAnswering(
  answer: (body: { experiments: ExperimentChoices }, at: number) => Promise<Response>,
) {
  const bodies: { experiments: ExperimentChoices }[] = [];
  const client = new AccountPreferencesClient({
    serviceBaseUrl: "https://tryluke.dev",
    credential: fixedBearer("token"),
    httpClient: fakeHttpClientLayer(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return answer(body, bodies.length);
    }),
  });
  return { client, bodies };
}

/** The service's answer: the experiments it then holds. */
const holding = (experiments: ExperimentChoices) =>
  new Response(JSON.stringify({ preferences: {}, experiments }), { status: 200 });

test("the service's answer is what the store keeps and the settings carry", async (t) => {
  const store = await signedInStore(await temporaryDirectory(t, "luke-experiments-"));
  const { client, bodies } = serviceAnswering(async () => holding({ [EXPERIMENT.FACTORY]: true }));

  const written = await Effect.runPromise(
    experimentWriter({ client, store }).write(ACCOUNT.email, EXPERIMENT.FACTORY, true),
  );

  assert.equal(written.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(written.settings.experiments, { [EXPERIMENT.FACTORY]: true });
  assert.deepEqual(bodies, [{ experiments: { [EXPERIMENT.FACTORY]: true } }]);
  assert.deepEqual((await Effect.runPromise(store.snapshot())).experiments, {
    [EXPERIMENT.FACTORY]: true,
  });
});

test("two presses land in the order they were made, however slowly the first is answered", async (t) => {
  const store = await signedInStore(await temporaryDirectory(t, "luke-experiments-"));
  const firstAnswered = Effect.runSync(Deferred.make<void>());
  let held: ExperimentChoices = NO_EXPERIMENTS;
  const { client, bodies } = serviceAnswering(async (body, at) => {
    if (at === 1) await Effect.runPromise(Deferred.await(firstAnswered));
    held = { ...held, ...body.experiments };
    return holding(held);
  });
  const writer = experimentWriter({ client, store });

  const turnedOn = Effect.runPromise(writer.write(ACCOUNT.email, EXPERIMENT.FACTORY, true));
  const turnedOff = Effect.runPromise(writer.write(ACCOUNT.email, EXPERIMENT.FACTORY, false));
  await nextTurn();
  assert.equal(bodies.length, 1, "the second press waits for the first to be answered");
  Effect.runSync(Deferred.succeed(firstAnswered, undefined));
  await Promise.all([turnedOn, turnedOff]);

  assert.deepEqual(bodies, [
    { experiments: { [EXPERIMENT.FACTORY]: true } },
    { experiments: { [EXPERIMENT.FACTORY]: false } },
  ]);
  assert.deepEqual((await Effect.runPromise(store.snapshot())).experiments, {
    [EXPERIMENT.FACTORY]: false,
  });
});

test("a write the service did not answer leaves the switch where it stood", async (t) => {
  const store = await signedInStore(await temporaryDirectory(t, "luke-experiments-"));
  const { client } = serviceAnswering(async () => new Response("unavailable", { status: 503 }));

  const written = await Effect.runPromise(
    experimentWriter({ client, store }).write(ACCOUNT.email, EXPERIMENT.FACTORY, true),
  );

  assert.equal(written.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(written.reason, EXPERIMENT_UNANSWERED);
  assert.deepEqual(written.settings.experiments, {});
});

test("an answer that arrives after the account signed out is refused, not reported as moved", async (t) => {
  const store = await signedInStore(await temporaryDirectory(t, "luke-experiments-"));
  const { client } = serviceAnswering(async () => {
    await Effect.runPromise(store.clearAccount());
    return holding({ [EXPERIMENT.FACTORY]: true });
  });

  const written = await Effect.runPromise(
    experimentWriter({ client, store }).write(ACCOUNT.email, EXPERIMENT.FACTORY, true),
  );

  assert.equal(written.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(written.reason, EXPERIMENT_ACCOUNT_CHANGED);
  assert.deepEqual(written.settings.experiments, {});
});
