import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedPlanClient } from "./plan-client.js";
import {
  CODE_PATH_MAX_CHARS,
  PLAN_FIELD,
  PLAN_FILE_REFUSAL,
  PLAN_TREE_ENTRY,
} from "./plan-wire.js";
import { PLAN_CALL_FAILURE } from "./planning-view.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const SUMMARY = {
  id: PLAN_ID,
  name: "Teammate invitations",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_100_000,
  repository: null,
  openedAt: 1_800_000_200_000,
};

const PLAN = {
  ...SUMMARY,
  document: {
    body: "# Teammate invitations",
    assumptions: [{ text: "Members and admins can both invite." }],
  },
};

function client(): HostedPlanClient {
  return new HostedPlanClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("lists the account's plans under its bearer, the archived ones among them", () =>
  Effect.gen(function* () {
    const archived = {
      ...SUMMARY,
      id: "0c4f2e9a-7d1b-4a3e-8f6c-2b9d5e1a7c40",
      archivedAt: 1_800_000_300_000,
    };
    const api = fakeCloudApi({
      "GET /api/plans": { answer: () => ({ plans: [SUMMARY, archived] }) },
    });

    const listed = yield* Effect.provide(client().list(), api.layer);

    assert.deepEqual(listed, { ok: true, answer: [SUMMARY, archived] });
    assert.deepEqual(recordedRoutes(api.requests()), ["GET /api/plans?archived=include"]);
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect("opens one plan with its saved document", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ [`GET /api/plans/${PLAN_ID}`]: { answer: () => ({ plan: PLAN }) } });

    const opened = yield* Effect.provide(client().open(PLAN_ID), api.layer);

    assert.deepEqual(opened, { ok: true, answer: PLAN });
  }),
);

it.effect("a plan the service does not find reads as not found, not as unanswered", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const opened = yield* Effect.provide(client().open(PLAN_ID), api.layer);

    assert.deepEqual(opened, { ok: false, failure: PLAN_CALL_FAILURE.NOT_FOUND });
  }),
);

it.effect("deleting a plan answers whether the service deleted it", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`DELETE /api/plans/${PLAN_ID}`]: { answer: () => ({ deleted: true }) },
    });
    const gone = fakeCloudApi({
      [`DELETE /api/plans/${PLAN_ID}`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    assert.equal(yield* Effect.provide(client().delete(PLAN_ID), api.layer), true);
    assert.equal(yield* Effect.provide(client().delete(PLAN_ID), gone.layer), false);
  }),
);

it.effect("renaming a plan sends the trimmed name and answers the plan as renamed", () =>
  Effect.gen(function* () {
    const renamed = { ...PLAN, name: "Team invites" };
    const api = fakeCloudApi({
      [`PATCH /api/plans/${PLAN_ID}`]: { answer: () => ({ plan: renamed }) },
    });
    const gone = fakeCloudApi({
      [`PATCH /api/plans/${PLAN_ID}`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const answered = yield* Effect.provide(
      client().rename(PLAN_ID, { name: " Team invites  " }),
      api.layer,
    );

    assert.deepEqual(answered, renamed);
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { name: "Team invites" });
    assert.equal(
      yield* Effect.provide(client().rename(PLAN_ID, { name: "Team invites" }), gone.layer),
      undefined,
    );
  }),
);

it.effect("pinning or archiving a plan sends the change and answers the plan as changed", () =>
  Effect.gen(function* () {
    const pinned = { ...PLAN, pinnedAt: 1_800_000_300_000 };
    const api = fakeCloudApi({
      [`PATCH /api/plans/${PLAN_ID}`]: { answer: () => ({ plan: pinned }) },
    });
    const gone = fakeCloudApi({
      [`PATCH /api/plans/${PLAN_ID}`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const answered = yield* Effect.provide(client().mark(PLAN_ID, { pinned: true }), api.layer);
    yield* Effect.provide(client().mark(PLAN_ID, { archived: false }), api.layer);

    assert.deepEqual(answered, pinned);
    assert.deepEqual(
      api.requests().map((request) => JSON.parse(request.body ?? "{}")),
      [{ pinned: true }, { archived: false }],
    );
    assert.equal(
      yield* Effect.provide(client().mark(PLAN_ID, { archived: true }), gone.layer),
      undefined,
    );
  }),
);

it.effect("a pin or archive change that names neither never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    assert.equal(yield* Effect.provide(client().mark(PLAN_ID, {}), api.layer), undefined);
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("a blank rename never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    const answered = yield* Effect.provide(client().rename(PLAN_ID, { name: "  " }), api.layer);

    assert.equal(answered, undefined);
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("starting a plan sends its trimmed name and the repository it is about", () =>
  Effect.gen(function* () {
    const onRelay = { ...PLAN, repository: "acme/relay" };
    const api = fakeCloudApi({
      "POST /api/plans": { answer: () => ({ plan: onRelay }) },
    });

    const started = yield* Effect.provide(
      client().create({ name: "  Teammate invitations ", repository: "acme/relay" }),
      api.layer,
    );

    assert.deepEqual(started, { ok: true, answer: onRelay });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
  }),
);

it.effect(
  "a repository the service does not reach, or a GitHub sign-in it needs, is answered as that refusal",
  () =>
    Effect.gen(function* () {
      const refusing = (error: string) =>
        fakeCloudApi({
          "POST /api/plans": { answer: () => ({ error }), status: HTTP_STATUS.FORBIDDEN },
          [`PATCH /api/plans/${PLAN_ID}`]: {
            answer: () => ({ error }),
            status: HTTP_STATUS.FORBIDDEN,
          },
        });
      const unreachable = refusing(HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE);
      const signedOut = refusing(HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED);
      const request = { name: "Teammate invitations", repository: "acme/relay" };

      assert.deepEqual(yield* Effect.provide(client().create(request), unreachable.layer), {
        ok: false,
        failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      });
      assert.deepEqual(
        yield* Effect.provide(client().setRepository(PLAN_ID, "acme/relay"), signedOut.layer),
        { ok: false, failure: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED },
      );
    }),
);

it.effect(
  "setting a plan's repository sends it alone, null clears it, and the plan answers as changed",
  () =>
    Effect.gen(function* () {
      const onRelay = { ...PLAN, repository: "acme/relay" };
      const api = fakeCloudApi({
        [`PATCH /api/plans/${PLAN_ID}`]: { answer: () => ({ plan: onRelay }) },
      });

      const changed = yield* Effect.provide(
        client().setRepository(PLAN_ID, " acme/relay "),
        api.layer,
      );
      yield* Effect.provide(client().setRepository(PLAN_ID, null), api.layer);
      const refused = yield* Effect.provide(
        client().setRepository(PLAN_ID, "not a repository"),
        api.layer,
      );

      assert.deepEqual(changed, { ok: true, answer: onRelay });
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "{}")),
        [{ repository: "acme/relay" }, { repository: null }],
      );
      assert.deepEqual(refused, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "the repositories the account reaches are read whole, and a GitHub sign-in the service needs is answered as such",
  () =>
    Effect.gen(function* () {
      const listed = {
        installed: true,
        repositories: [
          {
            owner: "acme",
            name: "relay",
            fullName: "acme/relay",
            defaultBranch: "main",
            private: true,
            updatedAt: 1_800_000_000_000,
          },
        ],
        installationUrl: "https://github.com/apps/luke/installations/new",
      };
      const api = fakeCloudApi({
        "GET /api/github/repositories": { answer: () => listed },
      });
      const signedOut = fakeCloudApi({
        "GET /api/github/repositories": {
          answer: () => ({ error: HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED }),
          status: HTTP_STATUS.FORBIDDEN,
        },
      });

      assert.deepEqual(yield* Effect.provide(client().repositories(), api.layer), {
        ok: true,
        answer: listed,
      });
      assert.deepEqual(yield* Effect.provide(client().repositories(), signedOut.layer), {
        ok: false,
        failure: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
      });
    }),
);

it.effect("a plan with no name never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    const started = yield* Effect.provide(client().create({ name: "   " }), api.layer);

    assert.deepEqual(started, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("a service that fails answers unanswered, never an empty list or a plan", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/plans": { answer: () => ({ plans: [] }) },
      "POST /api/plans": { answer: () => ({ plan: PLAN }) },
    });
    api.fail();

    const plans = yield* Effect.provide(client().list(), api.layer);
    const started = yield* Effect.provide(client().create({ name: "Audit log" }), api.layer);

    assert.deepEqual(plans, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(started, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
  }),
);

it.effect("reads what was said on a plan's calls, and nothing from a service that refused it", () =>
  Effect.gen(function* () {
    const transcript = {
      calls: [
        {
          id: "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81",
          startedAt: 1_800_000_300_000,
          messages: [
            { id: "0", role: "user", parts: [{ type: "text", text: "Invites should expire." }] },
            { id: "1", role: "assistant", parts: [{ type: "text", text: "After how many days?" }] },
          ],
        },
      ],
      earlierOmitted: false,
    };
    const api = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/transcript`]: { answer: () => ({ transcript }) },
    });
    const gone = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/transcript`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    assert.deepEqual(
      yield* Effect.provide(client().readTranscript(PLAN_ID), api.layer),
      transcript,
    );
    assert.equal(yield* Effect.provide(client().readTranscript(PLAN_ID), gone.layer), undefined);
  }),
);

it.effect(
  "reads a plan's work a page at a time, with every code shown on it, and nothing from a service that refused it",
  () =>
    Effect.gen(function* () {
      const turn = (turnId: string) => ({
        turnId,
        startedAt: 1_800_000_300_000,
        state: "done",
        earlierOmitted: false,
        parts: [{ type: "text", text: "Invites expire after seven days." }],
      });
      const newest = {
        turns: [turn("turn-2")],
        earlier: "turn-2",
        code: [
          {
            callId: "call-1",
            turnId: "turn-1",
            shownAt: 1_800_000_200_000,
            code: {
              ref: { path: "src/invites.ts", startLine: 2, endLine: 3 },
              repository: "acme/web",
              firstLine: 1,
              lineCount: 3,
              lines: ["// invites", "const DAYS = 7;", "export { DAYS };"],
            },
          },
        ],
      };
      const older = { turns: [turn("turn-1")] };
      // The service answers the page before the turn the query names, or the newest.
      const api = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/work`]: {
          answer: (request) => (request.searchParams.get("before") === "turn-2" ? older : newest),
        },
      });
      const gone = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/work`]: {
          answer: () => ({ error: "not-found" }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      assert.deepEqual(yield* Effect.provide(client().readWork(PLAN_ID), api.layer), newest);
      assert.deepEqual(
        yield* Effect.provide(client().readWork(PLAN_ID, "turn-2"), api.layer),
        older,
      );
      assert.equal(yield* Effect.provide(client().readWork(PLAN_ID), gone.layer), undefined);
    }),
);

it.effect(
  "a file's window is asked by path and lines and read as the service answers it, a refusal included, and a window the wire refuses is never sent",
  () =>
    Effect.gen(function* () {
      const window = {
        file: {
          path: "src/invites.ts",
          repository: "acme/web",
          branch: "main",
          firstLine: 2,
          lineCount: 3,
          lines: ["const DAYS = 7;", "export { DAYS };"],
        },
      };
      const api = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/file`]: {
          answer: (request) =>
            request.searchParams.get("path") === ".env"
              ? { refusal: PLAN_FILE_REFUSAL.SECRET }
              : request.searchParams.get("first") === "2" &&
                  request.searchParams.get("last") === "3"
                ? window
                : { error: "invalid-request" },
        },
      });

      assert.deepEqual(
        yield* Effect.provide(
          client().readFile(PLAN_ID, { path: "src/invites.ts", firstLine: 2, lastLine: 3 }),
          api.layer,
        ),
        window,
      );
      assert.deepEqual(
        yield* Effect.provide(
          client().readFile(PLAN_ID, { path: ".env", firstLine: 1, lastLine: 3 }),
          api.layer,
        ),
        { refusal: PLAN_FILE_REFUSAL.SECRET },
      );
      assert.equal(
        yield* Effect.provide(
          client().readFile(PLAN_ID, { path: "src/invites.ts", firstLine: 3, lastLine: 2 }),
          api.layer,
        ),
        undefined,
      );
    }),
);

it.effect(
  "a folder of the repository is asked by its path, the root by none, everything under it with recursive, and read as the service answers it, a refusal included; a path the wire refuses is never sent",
  () =>
    Effect.gen(function* () {
      const listing = (path: string) => ({
        folder: {
          path,
          repository: "acme/web",
          branch: "main",
          entries: [
            { name: "src", kind: PLAN_TREE_ENTRY.FOLDER },
            { name: ".env", kind: PLAN_TREE_ENTRY.FILE },
          ],
          truncated: false,
        },
      });
      const api = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/tree`]: {
          answer: (request) => {
            const path = request.searchParams.get("path") ?? "";
            return path === "gone"
              ? { refusal: PLAN_FILE_REFUSAL.MISSING, branch: "main" }
              : listing(path);
          },
        },
      });
      const read = (path: string) =>
        Effect.provide(client().readTree(PLAN_ID, { path }), api.layer);

      assert.deepEqual(yield* read(""), listing(""));
      assert.deepEqual(yield* read("src/app"), listing("src/app"));
      assert.deepEqual(yield* read("gone"), { refusal: PLAN_FILE_REFUSAL.MISSING, branch: "main" });
      assert.equal(yield* read("a".repeat(CODE_PATH_MAX_CHARS + 1)), undefined);
      assert.deepEqual(
        yield* Effect.provide(client().readTree(PLAN_ID, { path: "", recursive: true }), api.layer),
        listing(""),
      );
      assert.deepEqual(recordedRoutes(api.requests()), [
        `GET /api/plans/${PLAN_ID}/tree`,
        `GET /api/plans/${PLAN_ID}/tree?path=src/app`,
        `GET /api/plans/${PLAN_ID}/tree?path=gone`,
        `GET /api/plans/${PLAN_ID}/tree?recursive=1`,
      ]);
    }),
);

it.effect(
  "the history is read a page at a time, one revision beside the one before it, and a restore answers the plan as it now stands",
  () =>
    Effect.gen(function* () {
      const line = (seq: number) => ({
        seq,
        lastEdit: { actor: "notetaker", at: 1_800_000_000_000 + seq, duringCall: true },
        startedAt: 1_800_000_000_000,
        changes: 3,
      });
      const restored = {
        ...PLAN,
        lastEdit: { actor: "developer", at: 1_800_000_500_000, duringCall: false },
      };
      const api = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/revisions`]: {
          answer: (request) =>
            request.searchParams.get("before") === "2"
              ? { revisions: [line(1)] }
              : { revisions: [line(3), line(2)], earlier: 2 },
        },
        [`GET /api/plans/${PLAN_ID}/revisions/2`]: {
          answer: () => ({ revision: { seq: 2, document: PLAN.document, previous: null } }),
        },
        [`POST /api/plans/${PLAN_ID}/revisions/2/restore`]: { answer: () => ({ plan: restored }) },
        [`POST /api/plans/${PLAN_ID}/revisions/9/restore`]: {
          answer: () => ({ error: "not-found" }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      assert.deepEqual(yield* Effect.provide(client().readRevisions(PLAN_ID), api.layer), {
        revisions: [line(3), line(2)],
        earlier: 2,
      });
      assert.deepEqual(yield* Effect.provide(client().readRevisions(PLAN_ID, 2), api.layer), {
        revisions: [line(1)],
      });
      assert.deepEqual(yield* Effect.provide(client().readRevision(PLAN_ID, 2), api.layer), {
        seq: 2,
        document: PLAN.document,
        previous: null,
      });
      assert.deepEqual(yield* Effect.provide(client().restore(PLAN_ID, 2), api.layer), restored);
      assert.equal(yield* Effect.provide(client().restore(PLAN_ID, 9), api.layer), undefined);
    }),
);

it.effect(
  "an edit of one field sends its base and value trimmed, and answers the plan as saved or the field as it stands",
  () =>
    Effect.gen(function* () {
      const saved = { ...PLAN, updatedAt: 1_800_000_400_000 };
      const conflict = { conflict: { current: "- Luke's words." } };
      let sent = 0;
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/edit`]: {
          answer: () => {
            sent += 1;
            return sent === 1 ? { plan: saved } : conflict;
          },
        },
      });
      const edit = { field: PLAN_FIELD.PROBLEM, base: null, value: " - Mine. " };

      const first = yield* Effect.provide(client().edit(PLAN_ID, edit), api.layer);
      const second = yield* Effect.provide(client().edit(PLAN_ID, edit), api.layer);
      const blank = yield* Effect.provide(
        client().edit(PLAN_ID, { field: PLAN_FIELD.PROBLEM, base: null, value: "  " }),
        api.layer,
      );

      assert.deepEqual(first, { ok: true, answer: { plan: saved } });
      assert.deepEqual(second, { ok: true, answer: conflict });
      assert.deepEqual(blank, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "{}")),
        [
          { field: PLAN_FIELD.PROBLEM, base: null, value: "- Mine." },
          { field: PLAN_FIELD.PROBLEM, base: null, value: "- Mine." },
        ],
      );
    }),
);

it.effect("an edit of a plan the service does not find reads as not found", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`POST /api/plans/${PLAN_ID}/edit`]: {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const edited = yield* Effect.provide(
      client().edit(PLAN_ID, { field: PLAN_FIELD.DECISIONS, base: null, value: "Invites expire." }),
      api.layer,
    );

    assert.deepEqual(edited, { ok: false, failure: PLAN_CALL_FAILURE.NOT_FOUND });
  }),
);

it.effect("an edit of an archived plan reads as archived, which the window says as such", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`POST /api/plans/${PLAN_ID}/edit`]: {
        answer: () => ({ error: HOSTED_API_ERROR.PLAN_ARCHIVED }),
        status: HTTP_STATUS.CONFLICT,
      },
    });

    const edited = yield* Effect.provide(
      client().edit(PLAN_ID, { field: PLAN_FIELD.DECISIONS, base: null, value: "Invites expire." }),
      api.layer,
    );

    assert.deepEqual(edited, { ok: false, failure: PLAN_CALL_FAILURE.PLAN_ARCHIVED });
  }),
);

it.effect(
  "reads the account's pinned repositories, and a pin answers them as they then stand",
  () =>
    Effect.gen(function* () {
      const relay = { repository: "acme/relay", pinnedAt: 1_800_000_300_000 };
      const ledger = { repository: "acme/ledger", pinnedAt: 1_800_000_400_000 };
      const api = fakeCloudApi({
        "GET /api/repository-pins": { answer: () => ({ pins: [relay] }) },
        "PUT /api/repository-pins": { answer: () => ({ pins: [ledger, relay] }) },
      });
      const refused = fakeCloudApi({
        "PUT /api/repository-pins": {
          answer: () => ({ error: HOSTED_API_ERROR.INVALID_REQUEST }),
          status: HTTP_STATUS.BAD_REQUEST,
        },
      });

      const read = yield* Effect.provide(client().repositoryPins(), api.layer);
      const pinned = yield* Effect.provide(client().pinRepository("acme/ledger", true), api.layer);
      const past = yield* Effect.provide(client().pinRepository("acme/more", true), refused.layer);

      assert.deepEqual(read, [relay]);
      assert.deepEqual(pinned, [ledger, relay]);
      assert.deepEqual(
        api.requests().flatMap((request) => (request.body ? [JSON.parse(request.body)] : [])),
        [{ repository: "acme/ledger", pinned: true }],
      );
      assert.equal(past, undefined);
    }),
);

it.effect("a pin that names no repository never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    assert.equal(
      yield* Effect.provide(client().pinRepository("not a repository", true), api.layer),
      undefined,
    );
    assert.deepEqual(api.requests(), []);
  }),
);
