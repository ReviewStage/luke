/**
 * agent-state-blobs.test.ts -- the store's upload and read are signed as `@vercel/blob` 2.8.2 signs them, the one thing nothing short of a live store would catch.
 *
 * The URLs below are what that release's own `presignUrl` answered for the
 * same delegation, path, and options, run once by hand outside this
 * repository; the store checks the signature, so a URL that differs from
 * them in its query or its signature is one the store refuses. The
 * delegations are fixtures with no store behind them.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { agentStateBlobsOver } from "./agent-state-blobs.js";

const PATH =
  "agent-state/7d0c4b2e-5a1f-4c3e-9b8a-2f6e1d0c9b8a/0f1e2d3c-4b5a-4968-8776-655443322110";
const SIGNING_TOKEN = "fixture-client-signing-token";
const VALID_UNTIL = 4_102_444_800_000;

/** The delegation the store issued for each operation, as `@vercel/blob`'s fixture run held it. */
const DELEGATION = {
  put: "eyJzdG9yZUlkIjoic3RvcmVfRml4dHVyZVN0b3JlMDEiLCJwYXRobmFtZSI6ImFnZW50LXN0YXRlLzdkMGM0YjJlLTVhMWYtNGMzZS05YjhhLTJmNmUxZDBjOWI4YS8wZjFlMmQzYy00YjVhLTQ5NjgtODc3Ni02NTU0NDMzMjIxMTAiLCJvcGVyYXRpb25zIjpbInB1dCJdLCJ2YWxpZFVudGlsIjo0MTAyNDQ0ODAwMDAwLCJtYXhpbXVtU2l6ZUluQnl0ZXMiOjUyNDI4ODAwMH0.fixture-delegation-mac",
  get: "eyJzdG9yZUlkIjoic3RvcmVfRml4dHVyZVN0b3JlMDEiLCJwYXRobmFtZSI6ImFnZW50LXN0YXRlLzdkMGM0YjJlLTVhMWYtNGMzZS05YjhhLTJmNmUxZDBjOWI4YS8wZjFlMmQzYy00YjVhLTQ5NjgtODc3Ni02NTU0NDMzMjIxMTAiLCJvcGVyYXRpb25zIjpbImdldCJdLCJ2YWxpZFVudGlsIjo0MTAyNDQ0ODAwMDAwfQ.fixture-delegation-mac",
} as const;

/** What `presignUrl` answered for each. */
const PRESIGNED = {
  put: `https://vercel.com/api/blob/?pathname=agent-state%2F7d0c4b2e-5a1f-4c3e-9b8a-2f6e1d0c9b8a%2F0f1e2d3c-4b5a-4968-8776-655443322110&vercel-blob-maximum-size-in-bytes=524288000&vercel-blob-add-random-suffix=false&vercel-blob-allow-overwrite=false&vercel-blob-delegation=${DELEGATION.put}&vercel-blob-signature=A_PeGdkxSXtw2CMTqd-_kb-8oESsPJlYWRbaFAS9zM0`,
  get: `https://fixturestore01.private.blob.vercel-storage.com/${PATH}?vercel-blob-delegation=${DELEGATION.get}&vercel-blob-signature=FJ-0ThVgquYInhfLCLsQYr-ze_EG9bSK_6Q6cd8jti4`,
} as const;

/** The store's signed-token call, answering the delegation for the operation asked. */
const signingStore = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
      const asked: { readonly operations: readonly ("put" | "get")[] } = JSON.parse(
        new TextDecoder().decode(body),
      );
      const operation = asked.operations[0] ?? "get";
      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          delegationToken: DELEGATION[operation],
          clientSigningToken: SIGNING_TOKEN,
          validUntil: VALID_UNTIL,
        }),
      );
    }),
  ),
);

it.effect("an upload and a read are signed as @vercel/blob signs them", () =>
  Effect.gen(function* () {
    const store = yield* agentStateBlobsOver("store_FixtureStore01", () =>
      Promise.resolve("fixture-oidc-token"),
    );

    const upload = yield* store.mintUpload(PATH);
    const read = yield* store.mintRead(PATH);

    assert.equal(upload.url, PRESIGNED.put);
    assert.equal(read.url, PRESIGNED.get);
  }).pipe(Effect.provide(signingStore)),
);
