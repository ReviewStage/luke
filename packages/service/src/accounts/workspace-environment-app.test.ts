import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { member, organization, user } from "@luke/database/schemas/auth";
import { workspaceEnvironmentVariable } from "@luke/database/schemas/workspace-environment";
import { getTestDB } from "@luke/database/testing";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentAnswer,
  workspaceEnvironmentAnswerSchema,
} from "@luke/features/workspace-environment-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, DateTime, Effect, Layer, Option, Redacted, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { workspaceEnvironmentApp } from "./workspace-environment-app.js";

/**
 * A workspace's environment, answered by the group the way a function
 * answers it, over a real dialect: any member reads the list, an owner or
 * admin alone saves or removes, a variable is answered with its value and
 * a secret by its hint alone, every value is kept sealed, a value the ring
 * can no longer open is answered unreadable, and a workspace the account is
 * not in is not found.
 *
 * Synthetic accounts, bearers, workspaces, and values throughout; the
 * key-encryption keys are fixed bytes written for this file.
 */

const ORIGIN = "https://luke.test";

const KEK = {
  ONE: `1:${Buffer.alloc(32, 1).toString("base64")}`,
  OTHER: `1:${Buffer.alloc(32, 7).toString("base64")}`,
} as const;

const SECRET = "sk_test_0000000000000000wxyz";

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

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
  /** The answer's bytes as they crossed, for what must never be in them. */
  readonly text: string;
}

/** An account of the workspace in the role given, or of none. */
const openAccount = (workspace: string | undefined, role: WorkspaceRole) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
    if (workspace !== undefined) {
      const now = yield* DateTime.nowAsDate;
      yield* db
        .insert(member)
        .values({ id: randomUUID(), organizationId: workspace, userId: id, role, createdAt: now });
    }
    return id;
  });

/** A workspace with an owner, an admin, and a member, an account of none, and the group answering under the ring given. */
const openWorkspace = (options: { ring?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const workspace = randomUUID();
    yield* db.insert(organization).values({
      id: workspace,
      name: "Acme",
      slug: `workspace-${workspace}`,
      createdAt: yield* DateTime.nowAsDate,
    });
    const owner = yield* openAccount(workspace, WORKSPACE_ROLE.OWNER);
    const admin = yield* openAccount(workspace, WORKSPACE_ROLE.ADMIN);
    const plain = yield* openAccount(workspace, WORKSPACE_ROLE.MEMBER);
    const outsider = yield* openAccount(undefined, WORKSPACE_ROLE.MEMBER);
    const app = workspaceEnvironmentApp({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
        ),
    });
    const ask = (request: Request, ring = options.ring) => answer(app, request, ring);
    return { workspace, owner, admin, plain, outsider, ask };
  });

const answer = (
  app: ReturnType<typeof workspaceEnvironmentApp>,
  request: Request,
  ring: string | undefined,
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const environment: HostedEnvironmentValues = {
      ...NO_ENVIRONMENT,
      providerKeyEncryptionKeys: ring === undefined ? undefined : Redacted.make(ring),
    };
    // The handler runs on the router's own fiber, so it is handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, environment),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      app.pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body, text } satisfies Answer;
  });

function post(path: string, userId: string, body: WireBoundaryInput) {
  return new Request(new URL(path, ORIGIN), {
    method: "POST",
    headers: { authorization: `Bearer ${userId}` },
    body: JSON.stringify(body),
  });
}

const list = (userId: string, workspaceId: string) =>
  post(HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT, userId, { workspaceId });

const save = (userId: string, workspaceId: string, name: string, kind: string, value: string) =>
  post(HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_SAVE, userId, {
    workspaceId,
    name,
    kind,
    secretValue: value,
  });

const remove = (userId: string, workspaceId: string, name: string) =>
  post(HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_REMOVE, userId, { workspaceId, name });

/** The answer as the wire reads it, failing the test where it is not the wire's. */
function entriesOf(answered: Answer): WorkspaceEnvironmentAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(workspaceEnvironmentAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const refusal = (status: number, error: string) => ({ status, body: { error } });

const statusOf = (answered: Answer) => ({ status: answered.status, body: answered.body });

it.layer(getTestDB())("the workspace environment route", (it) => {
  it.effect(
    "answers a variable with its value and a secret by its hint alone, to every member",
    () =>
      Effect.gen(function* () {
        const { workspace, owner, plain, ask } = yield* openWorkspace({ ring: KEK.ONE });
        yield* TestClock.adjust("1 hour");
        const savedAt = yield* Clock.currentTimeMillis;

        yield* ask(save(owner, workspace, "APP_MODE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "dev"));
        const saved = yield* ask(
          save(owner, workspace, "STRIPE_KEY", WORKSPACE_ENVIRONMENT_KIND.SECRET, SECRET),
        );
        const read = yield* ask(list(plain, workspace));

        assert.deepEqual(entriesOf(read), {
          entries: [
            {
              name: "APP_MODE",
              kind: WORKSPACE_ENVIRONMENT_KIND.VARIABLE,
              value: "dev",
              readable: true,
              updatedAt: savedAt,
            },
            {
              name: "STRIPE_KEY",
              kind: WORKSPACE_ENVIRONMENT_KIND.SECRET,
              hint: "…wxyz",
              readable: true,
              updatedAt: savedAt,
            },
          ],
        });
        assert.deepEqual(entriesOf(saved), entriesOf(read));
        for (const answered of [saved, read]) assert.ok(!answered.text.includes(SECRET));
      }),
  );

  it.effect("keeps every value sealed, a variable's as well as a secret's", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { workspace, admin, ask } = yield* openWorkspace({ ring: KEK.ONE });

      yield* ask(
        save(admin, workspace, "APP_MODE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "plainly-visible"),
      );
      yield* ask(save(admin, workspace, "TOKEN", WORKSPACE_ENVIRONMENT_KIND.SECRET, SECRET));
      const stored = JSON.stringify(yield* db.select().from(workspaceEnvironmentVariable));

      assert.ok(!stored.includes("plainly-visible"));
      assert.ok(!stored.includes(SECRET));
    }),
  );

  it.effect("shows no hint of a secret too short for its last characters to hide it", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace({ ring: KEK.ONE });

      const saved = yield* ask(
        save(owner, workspace, "PIN", WORKSPACE_ENVIRONMENT_KIND.SECRET, "1234"),
      );

      assert.deepEqual(
        entriesOf(saved).entries.map((entry) => entry.hint),
        [""],
      );
    }),
  );

  it.effect("lets an owner or admin alone save or remove, and a member only read", () =>
    Effect.gen(function* () {
      const { workspace, owner, plain, ask } = yield* openWorkspace({ ring: KEK.ONE });
      yield* ask(save(owner, workspace, "KEPT", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "yes"));

      const saving = yield* ask(
        save(plain, workspace, "MINE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "no"),
      );
      const removing = yield* ask(remove(plain, workspace, "KEPT"));
      const after = yield* ask(list(plain, workspace));

      const notPermitted = refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED);
      assert.deepEqual(statusOf(saving), notPermitted);
      assert.deepEqual(statusOf(removing), notPermitted);
      assert.deepEqual(
        entriesOf(after).entries.map((entry) => entry.name),
        ["KEPT"],
      );
    }),
  );

  it.effect("answers a workspace the account is not in as not found, whatever it asked", () =>
    Effect.gen(function* () {
      const { workspace, owner, outsider, ask } = yield* openWorkspace({ ring: KEK.ONE });
      yield* ask(save(owner, workspace, "KEPT", WORKSPACE_ENVIRONMENT_KIND.SECRET, SECRET));

      const answers = [
        yield* ask(list(outsider, workspace)),
        yield* ask(save(outsider, workspace, "KEPT", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "x")),
        yield* ask(remove(outsider, workspace, "KEPT")),
      ];

      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
      for (const answered of answers) assert.deepEqual(statusOf(answered), notFound);
      assert.equal(entriesOf(yield* ask(list(owner, workspace))).entries.length, 1);
    }),
  );

  it.effect("replaces a name saved again, of either kind, and removes it", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace({ ring: KEK.ONE });

      yield* ask(save(owner, workspace, "API_URL", WORKSPACE_ENVIRONMENT_KIND.SECRET, SECRET));
      const replaced = yield* ask(
        save(owner, workspace, "API_URL", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "https://api.test"),
      );
      const removed = yield* ask(remove(owner, workspace, "API_URL"));

      assert.deepEqual(
        entriesOf(replaced).entries.map((entry) => [entry.name, entry.kind, entry.value]),
        [["API_URL", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "https://api.test"]],
      );
      assert.deepEqual(entriesOf(removed).entries, []);
    }),
  );

  it.effect("refuses a secret too short to be masked out of what a command prints", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace({ ring: KEK.ONE });

      const refused = yield* ask(
        save(owner, workspace, "PIN", WORKSPACE_ENVIRONMENT_KIND.SECRET, "123"),
      );
      const variable = yield* ask(
        save(owner, workspace, "LEVEL", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "3"),
      );

      assert.deepEqual(
        statusOf(refused),
        refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
      );
      assert.deepEqual(
        entriesOf(variable).entries.map((entry) => entry.name),
        ["LEVEL"],
      );
    }),
  );

  it.effect("refuses a name the sandbox or Luke sets itself, or one no shell takes", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace({ ring: KEK.ONE });

      const refused = yield* Effect.forEach(
        ["PATH", "LUKE_REPOSITORY", "lower_case", "1ST", "A-B"],
        (name) => ask(save(owner, workspace, name, WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "x")),
      );

      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      for (const answered of refused) assert.deepEqual(statusOf(answered), invalid);
      assert.deepEqual(entriesOf(yield* ask(list(owner, workspace))).entries, []);
    }),
  );

  it.effect("keeps no new name past the workspace's bound, but still replaces one it holds", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace({ ring: KEK.ONE });
      for (let index = 0; index < WORKSPACE_ENVIRONMENT_BOUNDS.MAX_ENTRIES; index += 1) {
        yield* ask(
          save(owner, workspace, `NAME_${index}`, WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "x"),
        );
      }

      const past = entriesOf(
        yield* ask(save(owner, workspace, "ONE_MORE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "x")),
      );
      const replaced = entriesOf(
        yield* ask(save(owner, workspace, "NAME_0", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "y")),
      );

      assert.equal(past.rejected, WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY);
      assert.ok(!past.entries.some((entry) => entry.name === "ONE_MORE"));
      assert.equal(replaced.rejected, undefined);
      assert.equal(replaced.entries.find((entry) => entry.name === "NAME_0")?.value, "y");
    }),
  );

  it.effect("answers a value the ring can no longer open as unreadable, with no value", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace({ ring: KEK.ONE });
      yield* ask(save(owner, workspace, "APP_MODE", WORKSPACE_ENVIRONMENT_KIND.VARIABLE, "dev"));

      const read = entriesOf(yield* ask(list(owner, workspace), KEK.OTHER));

      assert.deepEqual(
        read.entries.map((entry) => [entry.name, entry.readable, entry.value]),
        [["APP_MODE", false, undefined]],
      );
    }),
  );

  it.effect("answers unavailable where the deployment holds no ring", () =>
    Effect.gen(function* () {
      const { workspace, owner, ask } = yield* openWorkspace();

      const answered = yield* ask(list(owner, workspace));

      assert.deepEqual(
        statusOf(answered),
        refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
      );
    }),
  );
});
