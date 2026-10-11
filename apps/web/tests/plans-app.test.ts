import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import { boardAnswerSchema } from "@sidecar/hosted/board-wire";
import {
  PLAN_FILE_REFUSAL,
  planAnswerSchema,
  planFileAnswerSchema,
  planListAnswerSchema,
} from "@sidecar/hosted/plan-wire";
import { planWorkAnswerSchema } from "@sidecar/hosted/planning-view";
import {
  planTranscriptAnswerSchema,
  TRANSCRIPT_BOUNDS,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Result, type Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { planBoard } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import { voiceSessions, voiceTranscriptSegments } from "../server/db/voice-schema";
import {
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSegmentRole,
} from "../server/db/voice-vocabulary";
import {
  DRAW_ON_BOARD_REFUSAL,
  DRAW_ON_BOARD_STATUS,
  runDrawOnBoard,
} from "../server/hosted/board-tool";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { PLAN_SAVE_STATUS, saveNotes } from "../server/hosted/plan-notes";
import { plansApp } from "../server/plans-app";
import {
  type FakeGitHub,
  fakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  NO_GITHUB,
  openGithubUser,
  type SentToGitHub,
} from "./support/github-app-fake";
import { INVITATIONS_DRAFT, notesFor } from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";

/**
 * The Plans tab's plan routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a plan another account owns answers exactly as one
 * that does not exist, and what the notetaker's notes saved is what the window opens.
 * The path is the one the rewrite hands the group, the plan id moved from
 * the path into the `id` query. A plan's repository is kept only once the
 * Luke GitHub App, over a GitHub the test scripts, confirms the account
 * reaches it.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const PLANS = "/api/plans";
const ONE_PLAN = "/api/plans/plan";
const BOARD = "/api/plans/board";
const TRANSCRIPT = "/api/plans/transcript";
const WORK = "/api/plans/work";
const FILE = "/api/plans/file";

const RELAY = {
  name: "Teammate invitations",
} as const;

const LEDGER = {
  name: "Billing export",
} as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** A GitHub on which nobody reaches anything; the routes that read no repository never ask it. */
const UNREACHED_GITHUB: FakeGitHub = { layer: NO_GITHUB, sent: [] };

/**
 * Two accounts, each behind its own bearer. The owner signed in with GitHub
 * through the App; the other signed in with Google alone, and reaches
 * nothing on GitHub.
 */
const openAccounts = (github: FakeGitHub = UNREACHED_GITHUB) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: other, name: "Test User", email: `${other}@luke.test` });
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const ask = (request: Request) => answer(bearers, github, request);
    return { owner, other, ask };
  });

/** The group over the test's own database and the GitHub given, answering one request. */
const answer = (bearers: ReadonlyMap<string, string>, github: FakeGitHub, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock: the account rows hang off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      plansApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

function request(
  path: string,
  userId: string | undefined,
  init: {
    method?: string;
    body?: WireBoundaryInput;
    id?: string;
    command?: string;
    query?: Readonly<Record<string, string>>;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value);
  if (init.command !== undefined) url.searchParams.set("command", init.command);
  return new Request(url, {
    method: init.method ?? "GET",
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** An answer read as the wire declares it, failing the test where it is not one. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, status);
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read))
    return assert.fail(`the answer is not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** The started plan's id, failing the test where the answer is not a started plan. */
function startedId(started: Answer): string {
  return readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.id;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

/** What the contents API holds of the fixture repository, by path: a file's text, a directory, a link, or a file past the bound. */
const CONTENTS = new Map([
  ["src/invite.ts", () => fileContents("one\ntwo\n" + "x".repeat(500) + "\nfour")],
  ["assets/logo.png", () => fileContents("\u0089PNG\u0000\u0000")],
  [
    "big.json",
    () => Response.json({ type: "file", size: 2 * 1024 * 1024, encoding: "none", content: "" }),
  ],
  ["src", () => Response.json([{ type: "file", name: "invite.ts" }])],
  ["linked.ts", () => Response.json({ type: "symlink", target: "../outside.ts" })],
]);

/** The contents API's answer for a regular file of the text given. */
function fileContents(text: string): Response {
  const bytes = Buffer.from(text);
  return Response.json({
    type: "file",
    size: bytes.length,
    encoding: "base64",
    content: bytes.toString("base64"),
  });
}

const CONTENTS_PATH = /^\/repos\/Acme\/Relay\/contents\/(.+)$/u;

/** The fixture repository's contents, as GitHub answers them on the repository's own paths. */
function contentsOf(sent: SentToGitHub): Response | undefined {
  const named = CONTENTS_PATH.exec(new URL(sent.url).pathname);
  if (named === null) return undefined;
  const contents = CONTENTS.get(decodeURIComponent(named[1] ?? ""));
  return contents === undefined
    ? Response.json({ message: "Not Found" }, { status: 404 })
    : contents();
}

const RELAY_REACHED = [{ id: 1, login: "Acme", repositories: [{ owner: "Acme", name: "Relay" }] }];

/** A note the developer drew, as the canvas would send it. */
const NOTE = {
  id: "dev-note",
  type: BOARD_ELEMENT_TYPE.TEXT,
  x: 0,
  y: 200,
  width: 120,
  height: 25,
  text: "Rate limit invites",
  fontFamily: 5,
} as const;

/** One fragment said on a call: who, the words as the delta carried them, and the span on the call's clock. */
type Said = readonly [role: VoiceSegmentRole, text: string, startMs: number];

/** A call about the plan, started at the instant given, with the fragments said on it in the order they were written. */
const callAbout = (
  input: { userId: string; planId: string; startedAt: number },
  said: readonly Said[],
) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .insert(voiceSessions)
      .values({
        userId: input.userId,
        planId: input.planId,
        liveSessionId: `live_t_${randomUUID()}`,
        delegationMode: VOICE_DELEGATION_MODE.CLIENT,
        startedAt: new Date(input.startedAt),
      })
      .returning({ id: voiceSessions.id });
    assert.ok(row);
    if (said.length > 0) {
      yield* db.insert(voiceTranscriptSegments).values(
        said.map(([role, text, startMs], seq) => ({
          voiceSessionId: row.id,
          seq,
          role,
          text,
          startMs,
          endMs: startMs + 500,
        })),
      );
    }
    return row.id;
  });

/** One line as the transcript answers it: its place on the call, the speaker as the role, the words as one text part. */
function spoken(index: number, role: TranscriptMessage["role"], text: string): TranscriptMessage {
  return { id: String(index), role, parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }] };
}

/** Luke's drawing of one labelled box. */
const DRAW_API = {
  elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }],
};

it.layer(testSqlClient)("the plan routes", (it) => {
  it.effect("a started plan lists, and opens with what its notes saved", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes({ userId: owner, planId }, notesFor(INVITATIONS_DRAFT));
      assert.equal(saved.status, PLAN_SAVE_STATUS.SAVED);

      const listed = yield* ask(request(PLANS, owner));
      const opened = yield* ask(request(ONE_PLAN, owner, { id: planId }));

      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.id,
          plan.name,
        ]),
        [[planId, RELAY.name]],
      );
      assert.deepEqual(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, opened).plan.document,
        saved.status === PLAN_SAVE_STATUS.SAVED ? saved.document : undefined,
      );
    }),
  );

  it.effect("opening a plan leaves the list newest started first", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const relayId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      yield* TestClock.adjust("1 minute");
      const ledgerId = startedId(
        yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })),
      );
      yield* TestClock.adjust("1 minute");

      const opened = yield* ask(request(ONE_PLAN, owner, { id: relayId }));
      const listed = yield* ask(request(PLANS, owner));

      assert.equal(opened.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
          (plan) => plan.id,
        ),
        [ledgerId, relayId],
      );
    }),
  );

  it.effect("a listed plan still carries the openedAt a desktop through v0.7.1 requires", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      yield* ask(request(PLANS, owner, { method: "POST", body: RELAY }));

      const listed = yield* ask(request(PLANS, owner));

      const [plan] = readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans;
      assert.ok(plan);
      assert.equal(plan.openedAt, plan.createdAt);
    }),
  );

  it.effect(
    "a pin and an archive answer the plan stamped, and the plain list a build from before archiving reads leaves the archived plan out",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const relayId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* TestClock.adjust("1 minute");
        const ledgerId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })),
        );
        const change = (planId: string, body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body }));
        const listIds = (query?: Readonly<Record<string, string>>) =>
          Effect.map(ask(request(PLANS, owner, query === undefined ? {} : { query })), (listed) =>
            readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
              ({ id, pinnedAt, archivedAt }) => [
                id,
                pinnedAt !== undefined,
                archivedAt !== undefined,
              ],
            ),
          );

        const pinned = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change(ledgerId, { pinned: true }),
        ).plan;
        const archived = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change(relayId, { archived: true }),
        ).plan;

        assert.notEqual(pinned.pinnedAt, undefined);
        assert.notEqual(archived.archivedAt, undefined);
        assert.deepEqual(yield* listIds(), [[ledgerId, true, false]]);
        assert.deepEqual(yield* listIds({ archived: "include" }), [
          [ledgerId, true, false],
          [relayId, false, true],
        ]);
        assert.deepEqual(yield* listIds({ archived: "everything" }), [[ledgerId, true, false]]);

        yield* change(relayId, { archived: false });
        yield* change(ledgerId, { pinned: false });
        assert.deepEqual(yield* listIds(), [
          [ledgerId, false, false],
          [relayId, false, false],
        ]);
      }),
  );

  it.effect(
    "a pin or an archive that is not a yes or a no is refused, and another account's plan is none",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const change = (userId: string, body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, userId, { id: planId, method: "PATCH", body }));
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(
          [
            yield* change(owner, { pinned: "yes" }),
            yield* change(owner, { archived: null }),
            yield* change(owner, {}),
          ],
          [invalid, invalid, invalid],
        );
        assert.deepEqual(
          [yield* change(other, { pinned: true }), yield* change(other, { archived: true })],
          [notFound, notFound],
        );
        const listed = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );
        assert.deepEqual(
          listed.plans.map(({ id, pinnedAt, archivedAt }) => [id, pinnedAt, archivedAt]),
          [[planId, undefined, undefined]],
        );
      }),
  );

  it.effect("another account's plan answers as none on every route", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

      assert.deepEqual(yield* ask(request(ONE_PLAN, other, { id: planId })), notFound);
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, other, { id: planId, method: "DELETE" })),
        notFound,
      );
      assert.deepEqual(yield* ask(request(PLANS, other)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
      assert.equal(
        (yield* ask(request(ONE_PLAN, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.OK,
      );
    }),
  );

  it.effect("a deleted plan no longer opens or lists", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const deleted = yield* ask(request(ONE_PLAN, owner, { id: planId, method: "DELETE" }));

      assert.deepEqual(deleted, { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } });
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: planId })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      assert.deepEqual(yield* ask(request(PLANS, owner)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("a rename answers the plan under its new name, trimmed, and it lists that way", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const renamed = yield* ask(
        request(ONE_PLAN, owner, {
          id: planId,
          method: "PATCH",
          body: { name: "  Team invites " },
        }),
      );

      const { plan } = readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, renamed);
      assert.equal(plan.name, "Team invites");
      assert.ok(plan.document.body.startsWith("# Team invites\n"));
      const listed = readAnswer(
        planListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(PLANS, owner)),
      );
      assert.deepEqual(
        listed.plans.map(({ name }) => name),
        ["Team invites"],
      );
    }),
  );

  it.effect(
    "a blank, overlong, or widened rename is refused, and another account's plan is none",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const rename = (userId: string, body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, userId, { id: planId, method: "PATCH", body }));
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          [
            yield* rename(owner, { name: "" }),
            yield* rename(owner, { name: "   " }),
            yield* rename(owner, { name: "x".repeat(201) }),
            yield* rename(owner, { name: "Team invites", userId: other }),
          ],
          [invalid, invalid, invalid, invalid],
        );
        assert.deepEqual(
          yield* rename(other, { name: "Mine now" }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        const opened = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        assert.equal(opened.plan.name, RELAY.name);
      }),
  );

  it.effect(
    "a start that names an account, or a repository in no shape GitHub spells, is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const start = (body: WireBoundaryInput) =>
          ask(request(PLANS, owner, { method: "POST", body }));

        const naming = yield* start({ ...RELAY, userId: other });
        const shaped = yield* start({
          name: RELAY.name,
          repository: { owner: "acme", name: "relay" },
        });
        const pathed = yield* start({ name: RELAY.name, repository: "acme/../relay" });
        const bare = yield* start({ name: RELAY.name, repository: "relay" });

        assert.deepEqual([naming, shaped, pathed, bare], [invalid, invalid, invalid, invalid]);
        assert.deepEqual(yield* ask(request(PLANS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [] },
        });
      }),
  );

  it.effect("a plan starts with no repository, which lists and opens as null", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const listed = readAnswer(
        planListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(PLANS, owner)),
      );
      const opened = readAnswer(
        planAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(ONE_PLAN, owner, { id: planId })),
      );

      assert.equal(listed.plans[0]?.repository, null);
      assert.equal(opened.plan.repository, null);
    }),
  );

  it.effect(
    "a start naming a repository the App reaches keeps it as GitHub spells it, and a change may clear it",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 1, login: "Acme", repositories: [{ owner: "Acme", name: "Relay" }] },
        ]);
        const { owner, ask } = yield* openAccounts(github);

        const started = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
        );
        const planId = startedId(started);
        const cleared = yield* ask(
          request(ONE_PLAN, owner, { id: planId, method: "PATCH", body: { repository: null } }),
        );

        assert.equal(
          readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.repository,
          "Acme/Relay",
        );
        assert.equal(
          readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, cleared).plan.repository,
          null,
        );
        const listed = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );
        assert.deepEqual(
          listed.plans.map((plan) => plan.repository),
          [null],
        );
      }),
  );

  it.effect("a change sets the repository, or the name and the repository at once", () =>
    Effect.gen(function* () {
      const github = githubReaching([
        {
          id: 1,
          login: "acme",
          repositories: [
            { owner: "acme", name: "relay" },
            { owner: "acme", name: "ledger" },
          ],
        },
      ]);
      const { owner, ask } = yield* openAccounts(github);
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const change = (body: WireBoundaryInput) =>
        ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body }));

      const relay = yield* change({ repository: "acme/relay" });
      const both = yield* change({ name: "Billing export", repository: "acme/ledger" });

      assert.equal(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, relay).plan.repository,
        "acme/relay",
      );
      const changed = readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, both).plan;
      assert.deepEqual([changed.name, changed.repository], ["Billing export", "acme/ledger"]);
      assert.ok(changed.document.body.startsWith("# Billing export\n"));
    }),
  );

  it.effect(
    "a repository the App reaches no installation of for the account is refused, and nothing is written",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 1, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
        ]);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const notReachable = refusal(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
        );

        const unchosen = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/ledger" } }),
        );
        const elsewhere = yield* ask(
          request(ONE_PLAN, owner, {
            id: planId,
            method: "PATCH",
            body: { name: "Team invites", repository: "octocat/relay" },
          }),
        );

        assert.deepEqual([unchosen, elsewhere], [notReachable, notReachable]);
        const opened = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        assert.deepEqual([opened.plan.name, opened.plan.repository], [RELAY.name, null]);
        assert.equal(
          readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(request(PLANS, owner)))
            .plans.length,
          1,
        );
      }),
  );

  it.effect(
    "an account GitHub no longer reads for, or that never signed in with GitHub, must sign in again before naming a repository",
    () =>
      Effect.gen(function* () {
        const revoked = fakeGitHub(() =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        );
        const { owner, other, ask } = yield* openAccounts(revoked);
        const signIn = refusal(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED,
        );
        const start = (userId: string) =>
          ask(
            request(PLANS, userId, {
              method: "POST",
              body: { ...RELAY, repository: "acme/relay" },
            }),
          );

        assert.deepEqual([yield* start(owner), yield* start(other)], [signIn, signIn]);
        assert.deepEqual(yield* ask(request(PLANS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [] },
        });
      }),
  );

  it.effect(
    "a GitHub that could not be read leaves the plan unchanged and answers unavailable",
    () =>
      Effect.gen(function* () {
        const down = fakeGitHub(() => new Response(null, { status: 503 }));
        const { owner, ask } = yield* openAccounts(down);
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );

        const changed = yield* ask(
          request(ONE_PLAN, owner, {
            id: planId,
            method: "PATCH",
            body: { repository: "acme/relay" },
          }),
        );

        assert.deepEqual(
          changed,
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.equal(
          readAnswer(
            planAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(ONE_PLAN, owner, { id: planId })),
          ).plan.repository,
          null,
        );
      }),
  );

  it.effect("a change naming nothing to change is refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body: {} })),
        refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
      );
    }),
  );

  it.effect(
    "a board reads empty, holds Luke's latest drawing for the Mac, and keeps the scene the Mac writes",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const read = () =>
          Effect.map(
            ask(request(BOARD, owner, { id: planId })),
            (answered) => readAnswer(boardAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).board,
          );

        assert.deepEqual(yield* read(), { elements: [], appliedDrawing: 0 });
        const drawn = yield* runDrawOnBoard({ userId: owner, planId }, unparsedWire(DRAW_API));
        assert.deepEqual(drawn, { status: DRAW_ON_BOARD_STATUS.DRAWN, drawing: 1 });
        assert.deepEqual(yield* read(), {
          elements: [],
          appliedDrawing: 0,
          drawing: { number: 1, elements: DRAW_API.elements },
        });

        const written = yield* ask(
          request(BOARD, owner, {
            method: "PUT",
            id: planId,
            body: { elements: [NOTE], appliedDrawing: 1 },
          }),
        );
        assert.equal(written.status, HOSTED_HTTP_STATUS.OK);

        // Luke draws again: the new drawing replaces his last and leaves the scene to the Mac.
        yield* runDrawOnBoard({ userId: owner, planId }, unparsedWire(DRAW_API));
        const board = yield* read();
        assert.deepEqual(board.elements, [NOTE]);
        assert.equal(board.appliedDrawing, 1);
        assert.equal(board.drawing?.number, 2);

        // A drawing laid over the developer's note is drawn, and the answer says what it covers.
        const over = yield* runDrawOnBoard(
          { userId: owner, planId },
          unparsedWire({ elements: [{ ...DRAW_API.elements[0], y: 180 }] }),
        );
        assert.equal(over.status, DRAW_ON_BOARD_STATUS.DRAWN);
        assert.ok(
          "layout" in over && over.layout?.some((finding) => finding.includes(NOTE.id)),
          "the answer names the developer's note",
        );
      }),
  );

  it.effect(
    "another account's board answers as none, and a scene the board does not admit is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const save = (userId: string, body: WireBoundaryInput) =>
          ask(request(BOARD, userId, { method: "PUT", id: planId, body }));

        assert.deepEqual(yield* ask(request(BOARD, other, { id: planId })), notFound);
        assert.deepEqual(yield* save(other, { elements: [NOTE], appliedDrawing: 0 }), notFound);
        assert.equal(
          (yield* runDrawOnBoard({ userId: other, planId }, unparsedWire(DRAW_API))).status,
          DRAW_ON_BOARD_STATUS.NOT_DRAWN,
        );
        assert.deepEqual(
          yield* save(owner, { elements: [{ ...NOTE, type: "image" }], appliedDrawing: 0 }),
          invalid,
        );
        assert.deepEqual(
          yield* save(owner, { elements: [NOTE], appliedDrawing: 0, planId }),
          invalid,
        );
        assert.deepEqual(yield* ask(request(BOARD, owner, { id: planId })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { board: { elements: [], appliedDrawing: 0 } },
        });
      }),
  );

  it.effect("a drawing whose arrow names an id it does not hold draws nothing, and says why", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const binding = { userId: owner, planId };
      const arrowToNothing = {
        type: BOARD_ELEMENT_TYPE.ARROW,
        id: "calls",
        from: "api",
        to: "cache",
      };

      const dangling = yield* runDrawOnBoard(
        binding,
        unparsedWire({ elements: [...DRAW_API.elements, arrowToNothing] }),
      );
      const twice = yield* runDrawOnBoard(
        binding,
        unparsedWire({ elements: [...DRAW_API.elements, ...DRAW_API.elements] }),
      );
      const unreadable = yield* runDrawOnBoard(binding, unparsedWire({ elements: "a box" }));

      assert.deepEqual(dangling, {
        status: DRAW_ON_BOARD_STATUS.NOT_DRAWN,
        reason: DRAW_ON_BOARD_REFUSAL.NO_END,
      });
      assert.equal(twice.status, DRAW_ON_BOARD_STATUS.NOT_DRAWN);
      assert.equal(unreadable.status, DRAW_ON_BOARD_STATUS.NOT_DRAWN);
      assert.deepEqual(yield* ask(request(BOARD, owner, { id: planId })), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { board: { elements: [], appliedDrawing: 0 } },
      });
    }),
  );

  it.effect("a deleted plan takes its board with it", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      yield* runDrawOnBoard({ userId: owner, planId }, unparsedWire(DRAW_API));

      yield* ask(request(ONE_PLAN, owner, { id: planId, method: "DELETE" }));

      const rows = yield* db
        .select({ planId: planBoard.planId })
        .from(planBoard)
        .where(eq(planBoard.planId, planId));
      assert.deepEqual(rows, []);
      assert.equal(
        (yield* ask(request(BOARD, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.NOT_FOUND,
      );
    }),
  );

  it.effect(
    "a transcript reads each call oldest first in the lines its captions drew, and nothing of another plan or account",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const read = () =>
          Effect.map(
            ask(request(TRANSCRIPT, owner, { id: planId })),
            (answered) =>
              readAnswer(planTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
          );
        const { USER, ASSISTANT } = VOICE_SEGMENT_ROLE;

        assert.deepEqual(yield* read(), { calls: [], earlierOmitted: false });
        // Made newest first, so the order read back is the calls' starts and not the rows'.
        const second = yield* callAbout({ userId: owner, planId, startedAt: 2_000_000 }, [
          [USER, "Seven days.", 0],
        ]);
        // Luke's acknowledgment lands inside the developer's sentence, which a
        // fragment written after it still finishes, as the captions draw it.
        const first = yield* callAbout({ userId: owner, planId, startedAt: 1_000_000 }, [
          [USER, "Invites ", 0],
          [ASSISTANT, "Mm.", 600],
          [USER, "should expire.", 700],
          [ASSISTANT, "After how many days?", 9_000],
        ]);
        yield* callAbout({ userId: owner, planId, startedAt: 3_000_000 }, []);
        yield* callAbout({ userId: other, planId, startedAt: 3_000_000 }, [
          [USER, "Another account's words.", 0],
        ]);
        const otherPlan = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* callAbout({ userId: owner, planId: otherPlan, startedAt: 3_000_000 }, [
          [USER, "Another plan's words.", 0],
        ]);

        assert.deepEqual(yield* read(), {
          calls: [
            {
              id: first,
              startedAt: 1_000_000,
              messages: [
                spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire."),
                spoken(1, TRANSCRIPT_SPEAKER.ASSISTANT, "Mm."),
                spoken(2, TRANSCRIPT_SPEAKER.ASSISTANT, "After how many days?"),
              ],
            },
            {
              id: second,
              startedAt: 2_000_000,
              messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Seven days.")],
            },
          ],
          earlierOmitted: false,
        });
        assert.deepEqual(
          yield* ask(request(TRANSCRIPT, other, { id: planId })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(TRANSCRIPT, owner, { method: "PUT", id: planId })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "a plan's work is read by the account that owns it alone, before a turn the query names by its id, and only read",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );

        assert.deepEqual(
          readAnswer(
            planWorkAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(WORK, owner, { id: planId })),
          ),
          { turns: [], code: [] },
        );
        const older = new URL(WORK, ORIGIN);
        older.searchParams.set("id", planId);
        older.searchParams.set("before", "turn-1");
        assert.deepEqual(
          yield* ask(new Request(older, { headers: { authorization: `Bearer ${owner}` } })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(WORK, other, { id: planId })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(WORK, owner, { method: "PUT", id: planId })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect("a transcript past its bound keeps the newest words and says older ones stand", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const said = Array.from(
        { length: TRANSCRIPT_BOUNDS.MAX_SEGMENTS + 1 },
        (_, index): Said => [VOICE_SEGMENT_ROLE.USER, `${index} `, index * 100],
      );
      yield* callAbout({ userId: owner, planId, startedAt: 1_000_000 }, said);

      const transcript = readAnswer(
        planTranscriptAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(TRANSCRIPT, owner, { id: planId })),
      ).transcript;
      assert.equal(transcript.earlierOmitted, true);
      const text = transcript.calls
        .flatMap((call) => call.messages.flatMap((message) => message.parts))
        .map((part) => part.text)
        .join("");
      assert.equal(text.startsWith("1 2 "), true);
      assert.equal(text.endsWith(`${TRANSCRIPT_BOUNDS.MAX_SEGMENTS} `), true);
    }),
  );

  it.effect(
    "a file of the plan's repository reads a window as GitHub holds it on the default branch, on the App's token, each line cut as show_code cuts it; another account's plan reads as none",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, other, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const window = (userId: string, path: string, first: string, last: string) =>
          ask(request(FILE, userId, { id: planId, query: { path, first, last } }));

        const read = readAnswer(
          planFileAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* window(owner, "src/invite.ts", "2", "3"),
        );
        assert.deepEqual(read, {
          file: {
            path: "src/invite.ts",
            repository: "Acme/Relay",
            firstLine: 2,
            lineCount: 4,
            lines: ["two", "x".repeat(400)],
          },
        });
        const asked = github.sent.find((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname));
        assert.equal(new URL(asked?.url ?? ORIGIN).searchParams.get("ref"), "main");
        assert.equal(
          asked?.headers.get("authorization"),
          `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`,
        );
        assert.equal(JSON.stringify(read).includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* window(owner, "src/invite.ts", "9", "12"),
          ),
          {
            file: {
              path: "src/invite.ts",
              repository: "Acme/Relay",
              firstLine: 9,
              lineCount: 4,
              lines: [],
            },
          },
          "a window past the end carries no lines",
        );
        assert.deepEqual(
          yield* window(other, "src/invite.ts", "1", "2"),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a file is refused by the rule show_code keeps: a secret file and a path leaving the tree before GitHub is asked, and a missing file, a directory, a link, and a file too large or not text by name",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const refusalOf = (path: string) =>
          Effect.map(
            ask(request(FILE, owner, { id: planId, query: { path, first: "1", last: "10" } })),
            (answered) => readAnswer(planFileAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const asked = () =>
          github.sent.filter((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname)).length;

        assert.deepEqual(yield* refusalOf("config/.env.local"), {
          refusal: PLAN_FILE_REFUSAL.SECRET,
        });
        assert.deepEqual(yield* refusalOf("src/../../other/secret.ts"), {
          refusal: PLAN_FILE_REFUSAL.MISSING,
        });
        assert.equal(asked(), 0, "neither is asked of GitHub");
        assert.deepEqual(yield* refusalOf("gone.ts"), { refusal: PLAN_FILE_REFUSAL.MISSING });
        assert.deepEqual(yield* refusalOf("src"), { refusal: PLAN_FILE_REFUSAL.MISSING });
        assert.deepEqual(yield* refusalOf("linked.ts"), { refusal: PLAN_FILE_REFUSAL.MISSING });
        assert.deepEqual(yield* refusalOf("big.json"), { refusal: PLAN_FILE_REFUSAL.NOT_TEXT });
        assert.deepEqual(yield* refusalOf("assets/logo.png"), {
          refusal: PLAN_FILE_REFUSAL.NOT_TEXT,
        });
      }),
  );

  it.effect(
    "a plan with no repository says so, and a window out of order or past its bound is refused",
    () =>
      Effect.gen(function* () {
        const reached = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(reached);
        const bare = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })));
        const withRepository = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const window = (planId: string, first: string, last: string) =>
          request(FILE, owner, { id: planId, query: { path: "src/invite.ts", first, last } });

        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(window(bare, "1", "2")),
          ),
          { refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY },
        );
        assert.deepEqual(
          yield* ask(window(withRepository, "5", "2")),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(window(withRepository, "1", "501")),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect("no bearer, a wrong method, and an id that is no UUID are refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();

      assert.deepEqual(
        yield* ask(request(PLANS, undefined)),
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(
        yield* ask(request(PLANS, owner, { method: "DELETE" })),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: "not-a-plan" })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
    }),
  );
});
