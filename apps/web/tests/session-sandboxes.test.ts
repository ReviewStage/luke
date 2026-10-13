import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { vercelSessionSandboxes } from "../server/hosted/session-sandboxes";

/**
 * A retired session's sandboxes deleted through Vercel Sandbox's REST API,
 * over a Vercel that answers from a script: the list is asked under the
 * session's tag, for the project and team the deployment's token names,
 * each sandbox listed is deleted with the snapshots only it kept, and
 * anything Vercel did not confirm is the session left for a later sweep.
 */

const SESSION_ID = "wrun_01SESSION";

/** A token shaped as Vercel's OIDC token is, naming the project and team; nothing here verifies its signature. */
const TOKEN = [
  "header",
  Buffer.from(JSON.stringify({ project_id: "prj_luke", owner_id: "team_luke" })).toString(
    "base64url",
  ),
  "signature",
].join(".");

interface Call {
  readonly method: string;
  readonly url: URL;
  readonly authorization: string | null;
}

/** Vercel as the service asks it: the list answers the sandboxes named, and each delete the status given. */
function vercelAnswering(options: {
  readonly listStatus?: number;
  readonly sandboxes?: readonly string[];
  readonly deleteStatus?: number;
}) {
  const calls: Call[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    const method = init.method ?? "GET";
    calls.push({
      method,
      url: new URL(url),
      authorization: new Headers(init.headers).get("authorization"),
    });
    if (method === "GET") {
      return Response.json(
        { sandboxes: (options.sandboxes ?? []).map((name) => ({ name })), pagination: {} },
        { status: options.listStatus ?? 200 },
      );
    }
    return Response.json({}, { status: options.deleteStatus ?? 200 });
  });
  return { calls, layer };
}

const deleteFor = (readToken: () => Promise<string>) =>
  Effect.flatMap(vercelSessionSandboxes(readToken), (service) => service.deleteFor(SESSION_ID));

it.effect(
  "every sandbox under the session's tag is deleted with its orphan snapshots, for the token's project and team",
  () =>
    Effect.gen(function* () {
      const vercel = vercelAnswering({ sandboxes: ["eve-sbx-vercel-1"] });

      const deleted = yield* deleteFor(async () => TOKEN).pipe(Effect.provide(vercel.layer));

      assert.equal(deleted, 1);
      const [list, remove] = vercel.calls;
      assert.equal(list?.method, "GET");
      assert.equal(list?.url.pathname, "/api/v2/sandboxes");
      assert.equal(list?.url.searchParams.get("tags"), `sessionId:${SESSION_ID}`);
      assert.equal(list?.url.searchParams.get("project"), "prj_luke");
      assert.equal(list?.url.searchParams.get("teamId"), "team_luke");
      assert.equal(list?.authorization, `Bearer ${TOKEN}`);
      assert.equal(remove?.method, "DELETE");
      assert.equal(remove?.url.pathname, "/api/v2/sandboxes/eve-sbx-vercel-1");
      assert.equal(remove?.url.searchParams.get("deleteOrphanSnapshots"), "true");
      assert.equal(remove?.url.searchParams.get("projectId"), "prj_luke");
      assert.equal(vercel.calls.length, 2);
    }),
);

it.effect(
  "a sandbox Vercel no longer holds is already deleted, and a session with none deletes nothing",
  () =>
    Effect.gen(function* () {
      const gone = vercelAnswering({ sandboxes: ["eve-sbx-vercel-1"], deleteStatus: 404 });
      const none = vercelAnswering({ sandboxes: [] });

      assert.equal(yield* deleteFor(async () => TOKEN).pipe(Effect.provide(gone.layer)), 1);
      assert.equal(yield* deleteFor(async () => TOKEN).pipe(Effect.provide(none.layer)), 0);
      assert.equal(none.calls.length, 1);
    }),
);

it.effect(
  "a list or a delete Vercel refused, and a deployment with no token, are unavailable by status alone",
  () =>
    Effect.gen(function* () {
      const listRefused = vercelAnswering({ listStatus: 503 });
      const deleteRefused = vercelAnswering({ sandboxes: ["eve-sbx-vercel-1"], deleteStatus: 500 });

      const refusedList = yield* Effect.flip(
        deleteFor(async () => TOKEN).pipe(Effect.provide(listRefused.layer)),
      );
      const refusedDelete = yield* Effect.flip(
        deleteFor(async () => TOKEN).pipe(Effect.provide(deleteRefused.layer)),
      );
      const noToken = yield* Effect.flip(
        deleteFor(() => Promise.reject(new Error("no OIDC token here"))).pipe(
          Effect.provide(listRefused.layer),
        ),
      );

      assert.equal(refusedList.message, "Vercel Sandbox answered 503");
      assert.equal(refusedDelete.message, "Vercel Sandbox answered 500");
      assert.equal(noToken.message, "Vercel Sandbox was unavailable");
      assert.equal(listRefused.calls.length, 1);
    }),
);
