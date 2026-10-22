import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect } from "effect";
import { afterEach, vi } from "vitest";
import { CODER } from "../agents/coder-host/bounds.js";
import { sandboxListRefusal } from "../testing/vercel-sandbox-fake.js";
import { SANDBOX_RETENTION_SWEEP, sweepSandboxRetention } from "./sandbox-retention-sweep.js";

/**
 * The scheduled sweep's bound on the snapshot retention of the stopped
 * agents' sandboxes, over a fake of Vercel Sandbox's REST API that evicts as
 * Vercel was seen to on 2026-10-22: an update of a sandbox's retention keeps
 * its newest snapshots by when they were made and deletes the rest, the one
 * it resumes from among them. A stopped sandbox of the minute's bucket that
 * keeps every snapshot is bounded and keeps the one it resumes from; one
 * running, one already bounded, a template, and one of another bucket are
 * left; one whose snapshot is not its newest is left so its resume still
 * finds it; a sweep bounds no more than its bound; and every sandbox is
 * reached within 256 minutes.
 *
 * Synthetic sandboxes, snapshots, and tokens throughout.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
/** A minute of 2026-10-22 whose bucket is `a7`: the minute's count mod 256, in hex. */
const NOW = new Date((116_711 * 256 + 0xa7) * 60_000);
const BUCKET = "a7";
const BOUND = {
  count: CODER.SANDBOX_SNAPSHOTS.count,
  expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
  deleteEvicted: true,
};
/** The thirty-day retention sandboxes opened between the two bounds stand at. */
const THIRTY_DAYS = { count: 1, expiration: 2_592_000_000, deleteEvicted: true };

/** An unsigned token naming the fixture's project and team, a year from expiring. */
function fixtureToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 22) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: PROJECT, owner_id: TEAM, exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

interface FakeSnapshot {
  readonly id: string;
  readonly createdAt: number;
  status: string;
}

interface FakeSandbox {
  readonly name: string;
  readonly status: string;
  readonly currentSnapshotId?: string;
  keepLastSnapshots: object | null;
  readonly snapshots: FakeSnapshot[];
}

/** A sandbox and its snapshots, the last of them the one it resumes from unless named otherwise. */
function sandbox(
  name: string,
  options: {
    readonly status?: string;
    readonly snapshots?: number;
    readonly current?: number;
    readonly keepLastSnapshots?: object | null;
  } = {},
): FakeSandbox {
  const snapshots = Array.from({ length: options.snapshots ?? 3 }, (_, at) => ({
    id: `snap_${name}_${at}`,
    createdAt: 1_000 + at,
    status: "created",
  }));
  const current = snapshots[options.current ?? snapshots.length - 1];
  return {
    name,
    status: options.status ?? "stopped",
    ...(current === undefined ? {} : { currentSnapshotId: current.id }),
    keepLastSnapshots: options.keepLastSnapshots ?? null,
    snapshots,
  };
}

/** Vercel Sandbox's REST API over the sandboxes given, keeping the prefixes listed and the updates asked. */
function vercel(
  sandboxes: readonly FakeSandbox[],
  options: { readonly refuseUpdate?: boolean; readonly evictsAll?: boolean } = {},
) {
  const prefixes: string[] = [];
  const updated: { readonly name: string; readonly body: unknown }[] = [];
  const named = (name: string) => sandboxes.find((each) => each.name === name);
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    assert.equal(parsed.searchParams.get("teamId"), TEAM);
    const path = parsed.pathname;
    if (method === "GET" && path === "/api/v2/sandboxes") {
      const refused = sandboxListRefusal(parsed);
      if (refused !== undefined) return refused;
      assert.equal(parsed.searchParams.get("project"), PROJECT);
      const prefix = parsed.searchParams.get("namePrefix") ?? "";
      prefixes.push(prefix);
      const from = Number(parsed.searchParams.get("cursor") ?? "0");
      const limit = Number(parsed.searchParams.get("limit"));
      const matching = sandboxes
        .filter((each) => each.name.startsWith(prefix))
        .toSorted((first, second) => first.name.localeCompare(second.name));
      const page = matching.slice(from, from + limit);
      const next = from + limit < matching.length ? String(from + limit) : null;
      return Response.json({
        pagination: { count: page.length, next },
        sandboxes: page.map(({ name, status, currentSnapshotId, keepLastSnapshots }) => ({
          name,
          status,
          currentSnapshotId,
          keepLastSnapshots,
        })),
      });
    }
    if (method === "GET" && path === "/api/v2/sandboxes/snapshots") {
      assert.equal(parsed.searchParams.get("project"), PROJECT);
      assert.equal(parsed.searchParams.get("sortOrder"), "desc");
      const listed = (named(parsed.searchParams.get("name") ?? "")?.snapshots ?? [])
        .toSorted((first, second) => second.createdAt - first.createdAt)
        .slice(0, Number(parsed.searchParams.get("limit")));
      return Response.json({ snapshots: listed, pagination: { next: null } });
    }
    const lookup = /^\/api\/v2\/sandboxes\/snapshots\/([^/]+)$/u.exec(path);
    if (method === "GET" && lookup !== null) {
      const found = sandboxes.flatMap((each) => each.snapshots).find((s) => s.id === lookup[1]);
      return found === undefined
        ? new Response("{}", { status: 404 })
        : Response.json({ snapshot: found });
    }
    assert.equal(method, "PATCH", `an unexpected call: ${method} ${path}`);
    assert.equal(parsed.searchParams.get("projectId"), PROJECT);
    if (options.refuseUpdate === true) return new Response("{}", { status: 503 });
    const name = decodeURIComponent(path.split("/").at(-1) ?? "");
    const body = JSON.parse(String(init.body)) as { keepLastSnapshots: { count: number } };
    updated.push({ name, body });
    const target = named(name);
    assert.ok(target !== undefined);
    target.keepLastSnapshots = body.keepLastSnapshots;
    // Note that eviction runs by when each snapshot was made, never by the one the sandbox resumes from.
    const kept = options.evictsAll === true ? 0 : body.keepLastSnapshots.count;
    target.snapshots
      .filter((each) => each.status === "created")
      .toSorted((first, second) => second.createdAt - first.createdAt)
      .slice(kept)
      .forEach((each) => {
        each.status = "deleted";
      });
    return Response.json({ sandbox: { name } });
  };
  return { layer: fakeHttpClientLayer(respond), prefixes, updated };
}

const statusesOf = (fake: FakeSandbox) => fake.snapshots.map((each) => each.status);

afterEach(() => {
  vi.unstubAllEnvs();
});

it.effect(
  "a stopped sandbox of the minute's bucket that keeps every snapshot is bounded, keeping the one it resumes from, and every other sandbox is left",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const unbounded = sandbox(`eve-sbx-vercel-${BUCKET}0001`);
      const thirtyDays = sandbox(`luke-agent-${BUCKET}000002`, {
        snapshots: 1,
        keepLastSnapshots: THIRTY_DAYS,
      });
      const running = sandbox(`eve-sbx-vercel-${BUCKET}0003`, { status: "running" });
      const bounded = sandbox(`eve-sbx-vercel-${BUCKET}0004`, { keepLastSnapshots: BOUND });
      const otherBucket = sandbox("eve-sbx-vercel-b10005");
      const template = sandbox(`eve-sbx-tpl-vercel-${BUCKET}0006`, { snapshots: 1 });
      const api = vercel([unbounded, thirtyDays, running, bounded, otherBucket, template]);

      const outcome = yield* sweepSandboxRetention(NOW).pipe(Effect.provide(api.layer));

      assert.deepEqual(outcome, { applied: 2, skipped: 0, failed: 0, deferred: 0, lost: 0 });
      assert.deepEqual(api.prefixes.toSorted(), [
        `eve-sbx-vercel-${BUCKET}`,
        `luke-agent-${BUCKET}`,
      ]);
      assert.deepEqual(
        api.updated.map(({ name }) => name).toSorted(),
        [unbounded.name, thirtyDays.name].toSorted(),
      );
      assert.deepEqual(api.updated[0]?.body, { keepLastSnapshots: BOUND });
      assert.deepEqual(statusesOf(unbounded), ["deleted", "deleted", "created"]);
      assert.equal(unbounded.snapshots.at(-1)?.id, unbounded.currentSnapshotId);
      assert.deepEqual(statusesOf(thirtyDays), ["created"]);
      for (const left of [running, bounded, otherBucket, template]) {
        assert.ok(
          left.snapshots.every((each) => each.status === "created"),
          left.name,
        );
      }
    }),
);

it.effect(
  "a sandbox whose snapshot is not its newest is left as it is, so its resume still finds it",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const rolledBack = sandbox(`eve-sbx-vercel-${BUCKET}0001`, { current: 1 });
      const api = vercel([rolledBack]);

      const outcome = yield* sweepSandboxRetention(NOW).pipe(Effect.provide(api.layer));

      assert.deepEqual(outcome, { applied: 0, skipped: 1, failed: 0, deferred: 0, lost: 0 });
      assert.deepEqual(api.updated, []);
      assert.deepEqual(statusesOf(rolledBack), ["created", "created", "created"]);
    }),
);

it.effect(
  "an update that took the snapshot the sandbox resumes from is counted lost, and one Vercel refused is counted failed",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const lost = yield* sweepSandboxRetention(NOW).pipe(
        Effect.provide(
          vercel([sandbox(`eve-sbx-vercel-${BUCKET}0001`)], { evictsAll: true }).layer,
        ),
      );
      const refused = yield* sweepSandboxRetention(NOW).pipe(
        Effect.provide(
          vercel([sandbox(`eve-sbx-vercel-${BUCKET}0001`)], { refuseUpdate: true }).layer,
        ),
      );

      assert.deepEqual(lost, { applied: 0, skipped: 0, failed: 0, deferred: 0, lost: 1 });
      assert.deepEqual(refused, { applied: 0, skipped: 0, failed: 1, deferred: 0, lost: 0 });
    }),
);

it.effect("a sweep bounds no more than its bound, leaving the rest to the bucket's next turn", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const many = Array.from({ length: SANDBOX_RETENTION_SWEEP.MAX_UPDATES + 3 }, (_, at) =>
      sandbox(`eve-sbx-vercel-${BUCKET}${String(at).padStart(4, "0")}`, { snapshots: 2 }),
    );
    const api = vercel(many);

    const outcome = yield* sweepSandboxRetention(NOW).pipe(Effect.provide(api.layer));

    assert.equal(outcome.applied, SANDBOX_RETENTION_SWEEP.MAX_UPDATES);
    assert.equal(outcome.deferred, 3);
    assert.equal(api.updated.length, SANDBOX_RETENTION_SWEEP.MAX_UPDATES);
  }),
);

it.effect("every agent sandbox is bounded within the 256 minutes the buckets take", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const spread = ["00", "0f", "7c", "a7", "ff"].map((prefix) =>
      sandbox(`eve-sbx-vercel-${prefix}d41d8cd98f00b204e9800998ecf8`),
    );
    const native = sandbox("luke-agent-3fa85f64-5717-4562-b3fc-2c963f66afa6");
    const api = vercel([...spread, native]);

    for (let minute = 0; minute < SANDBOX_RETENTION_SWEEP.BUCKETS; minute += 1) {
      yield* sweepSandboxRetention(new Date(NOW.getTime() + minute * 60_000)).pipe(
        Effect.provide(api.layer),
      );
    }

    assert.deepEqual(
      api.updated.map(({ name }) => name).toSorted(),
      [...spread, native].map(({ name }) => name).toSorted(),
    );
  }),
);

it.effect(
  "a bucket holding more than a page of sandboxes is read past its first page, so one listed after fifty bounded ones is still bounded",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const bounded = Array.from({ length: 50 }, (_, at) =>
        sandbox(`eve-sbx-vercel-${BUCKET}${String(at).padStart(4, "0")}`, {
          keepLastSnapshots: BOUND,
        }),
      );
      const last = sandbox(`eve-sbx-vercel-${BUCKET}9999`);
      const api = vercel([...bounded, last]);

      const outcome = yield* sweepSandboxRetention(NOW).pipe(Effect.provide(api.layer));

      assert.equal(outcome.applied, 1);
      assert.deepEqual(
        api.updated.map(({ name }) => name),
        [last.name],
      );
    }),
);
