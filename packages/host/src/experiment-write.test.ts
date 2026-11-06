import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { fixedBearer } from "@repo/features";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { EXPERIMENT, type ExperimentChoices, NO_EXPERIMENTS } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Fiber } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import {
  EXPERIMENT_ACCOUNT_CHANGED,
  EXPERIMENT_UNANSWERED,
  experimentWriter,
} from "./experiment-write.js";
import { type SecretCipher, SettingsStore } from "./settings-store.js";

const ACCOUNT = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  email: "developer@example.com",
  provider: "github",
} as const;

const CIPHER: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plainText) => new TextEncoder().encode(plainText),
  decrypt: (cipherText) => new TextDecoder().decode(cipherText),
};

const signedInStore = Effect.gen(function* () {
  const directory = yield* temporaryDirectoryScoped("experiments-");
  const store = new SettingsStore({
    directory: () => directory,
    cipher: CIPHER,
    fileSystem: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
  });
  yield* store.setAccount(ACCOUNT);
  return store;
});

const until = (holds: () => boolean) =>
  Effect.promise(async () => {
    for (let turn = 0; turn < 2_000 && !holds(); turn += 1) await nextTurn();
  });

function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

const storedAccountKey = (store: SettingsStore) => () =>
  Effect.map(
    Effect.orElseSucceed(store.readAccount(), () => undefined),
    (account) => account?.email,
  );

function serviceAnswering(
  answer: (body: { experiments: ExperimentChoices }, at: number) => Promise<Response>,
) {
  const bodies: { experiments: ExperimentChoices }[] = [];
  const client = new AccountPreferencesClient({
    serviceBaseUrl: "https://vespin.dev",
    credential: fixedBearer("token"),
    httpClient: fakeHttpClientLayer(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return answer(body, bodies.length);
    }),
  });
  return { client, bodies };
}

const holding = (experiments: ExperimentChoices) =>
  new Response(JSON.stringify({ preferences: {}, experiments }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const onDisk = Effect.provide([NodeFileSystem.layer, NodePath.layer]);

const writerOver = (
  client: AccountPreferencesClient,
  store: SettingsStore,
): ReturnType<typeof experimentWriter> =>
  experimentWriter({
    client,
    store,
    readAccountKey: storedAccountKey(store),
    confirmAccount: () => Effect.void,
  });

it.effect("the service's answer is what the store keeps and the settings carry", () =>
  Effect.gen(function* () {
    const store = yield* signedInStore;
    const { client, bodies } = serviceAnswering(async () => holding({ [EXPERIMENT.MEMORY]: true }));

    const written = yield* writerOver(client, store).write(ACCOUNT.email, EXPERIMENT.MEMORY, true);

    assert.equal(written.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.deepEqual(written.settings.experiments, { [EXPERIMENT.MEMORY]: true });
    assert.deepEqual(bodies, [{ experiments: { [EXPERIMENT.MEMORY]: true } }]);
    assert.deepEqual((yield* store.snapshot()).experiments, { [EXPERIMENT.MEMORY]: true });
  }).pipe(onDisk),
);

it.effect(
  "two presses land in the order they were made, however slowly the first is answered",
  () =>
    Effect.gen(function* () {
      const store = yield* signedInStore;
      const firstAnswered = gate();
      let held: ExperimentChoices = NO_EXPERIMENTS;
      const { client, bodies } = serviceAnswering(async (body, at) => {
        if (at === 1) await firstAnswered.opened;
        held = { ...held, ...body.experiments };
        return holding(held);
      });
      const writer = writerOver(client, store);

      const turnedOn = yield* Effect.forkChild(
        writer.write(ACCOUNT.email, EXPERIMENT.MEMORY, true),
      );
      const turnedOff = yield* Effect.forkChild(
        writer.write(ACCOUNT.email, EXPERIMENT.MEMORY, false),
      );
      yield* until(() => bodies.length > 0);
      yield* until(() => bodies.length > 1);
      assert.equal(bodies.length, 1, "the second press waits for the first to be answered");
      firstAnswered.open();
      yield* Fiber.join(turnedOn);
      yield* Fiber.join(turnedOff);

      assert.deepEqual(bodies, [
        { experiments: { [EXPERIMENT.MEMORY]: true } },
        { experiments: { [EXPERIMENT.MEMORY]: false } },
      ]);
      assert.deepEqual((yield* store.snapshot()).experiments, { [EXPERIMENT.MEMORY]: false });
    }).pipe(onDisk),
);

it.effect("a write the service did not answer leaves the switch where it stood", () =>
  Effect.gen(function* () {
    const store = yield* signedInStore;
    const { client } = serviceAnswering(async () => new Response("unavailable", { status: 503 }));

    const written = yield* writerOver(client, store).write(ACCOUNT.email, EXPERIMENT.MEMORY, true);

    assert.equal(written.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(written.reason, EXPERIMENT_UNANSWERED);
    assert.deepEqual(written.settings.experiments, {});
  }).pipe(onDisk),
);

it.effect(
  "an answer that arrives after the account signed out is refused, not reported as moved",
  () =>
    Effect.gen(function* () {
      const store = yield* signedInStore;
      const signedOut = gate();
      const { client, bodies } = serviceAnswering(async () => {
        await signedOut.opened;
        return holding({ [EXPERIMENT.MEMORY]: true });
      });

      const writing = yield* Effect.forkChild(
        writerOver(client, store).write(ACCOUNT.email, EXPERIMENT.MEMORY, true),
      );
      yield* until(() => bodies.length > 0);
      yield* store.clearAccount();
      signedOut.open();
      const written = yield* Fiber.join(writing);

      assert.equal(written.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(written.reason, EXPERIMENT_ACCOUNT_CHANGED);
      assert.deepEqual(written.settings.experiments, {});
    }).pipe(onDisk),
);
