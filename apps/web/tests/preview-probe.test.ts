/**
 * preview-probe.test.ts -- what the deployed-shape probe asks of the fallback onto the hosted oRPC router, and how it reads the answers.
 *
 * An unknown `/api/` path is planned though no client spells it, and held
 * to the router's own JSON 404, so the platform's `NOT_FOUND` there, or a 404
 * of another body, fails the probe.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Option } from "effect";
import {
  PROBE_DOOR,
  planProbes,
  probeDeployment,
  probeFailures,
  VERDICT,
} from "../server/preview-probe.js";

const ADDRESS = "https://preview.example";

const PATHS = { callers: ["/api/models"], crons: ["/api/maintenance/sweep"] };

it.effect(
  "an unknown path is held to the router's JSON 404: the platform's NOT_FOUND, or another body, fails",
  () =>
    Effect.gen(function* () {
      const [unknown] = planProbes(PROBE_DOOR.BYPASS_SECRET, PATHS).filter(
        (request) => request.path === "/api/nope",
      );
      assert.ok(unknown);
      const judged = (response: () => Response) =>
        probeDeployment({ address: ADDRESS, bypassSecret: Option.none() }, [unknown]).pipe(
          Effect.provide(fakeHttpClientLayer(() => response())),
          Effect.map((results) => results.map((result) => result.verdict)),
        );
      assert.deepEqual(
        yield* judged(() => Response.json({ error: "not-found" }, { status: 404 })),
        [VERDICT.OK],
      );
      assert.deepEqual(
        yield* judged(
          () =>
            new Response("The page could not be found", {
              status: 404,
              headers: { "x-vercel-error": "NOT_FOUND" },
            }),
        ),
        [VERDICT.PLATFORM_ERROR],
      );
      assert.deepEqual(yield* judged(() => new Response(null, { status: 404 })), [
        VERDICT.UNEXPECTED_BODY,
      ]);
      const report = {
        door: PROBE_DOOR.BYPASS_SECRET,
        address: ADDRESS,
        results: yield* probeDeployment({ address: ADDRESS, bypassSecret: Option.none() }, [
          unknown,
        ]).pipe(Effect.provide(fakeHttpClientLayer(() => new Response("{}", { status: 404 })))),
      };
      assert.equal(probeFailures(report).length, 1);
    }),
);
