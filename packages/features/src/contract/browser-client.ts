/**
 * browser-client.ts -- the hosted contract's oRPC client for a page of the site, on the browser's own session.
 *
 * An `OpenAPILink` over `hostedContract` whose transport is the page's own
 * `fetch`, read when each call is made, sending the session cookie
 * (`credentials: "include"`) and nothing of `accountCall`: a page has no
 * bearer to read, renew, or hold. A body is JSON, which the link sends as
 * `application/json`.
 *
 * The link reads the wire as the service writes it (`contract/errors.ts`): a
 * success whose procedure declares its wire schema is decoded with that
 * schema, a key a newer service added dropped as `readServiceAnswer` drops
 * one; a success that declares none is handed over as it was read. Every
 * other status is a refusal, read into its status and the slug its body
 * carries where it carries one ({@link browserRefusal}), since a page words
 * a refusal by its status as often as by its slug.
 *
 * A redirect is followed, as the pages' own `fetch` followed one, and an
 * answer that arrived through one is refused as {@link BrowserRedirected}:
 * something in front of the service answered, such as a Preview's
 * deployment protection, and its body is a login page rather than the
 * service's.
 */

import type { UnparsedWireValue } from "@luke/wire";
import { type Client, createORPCClient, ORPCError } from "@orpc/client";
import {
  type AnySchema,
  getProcedureContractOrThrow,
  type InferSchemaInput,
  type ProcedureContract,
} from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { Result, Schema } from "effect";
import { readServiceAnswer } from "../service-wire.js";
import { hostedContract } from "./index.js";

/** The answer arrived through a redirect, so something in front of the service answered it. */
export class BrowserRedirected extends Error {
  override readonly name = "BrowserRedirected";
}

/** The service answered a success its procedure's wire schema does not read. */
class BrowserAnswerUnread extends Error {
  override readonly name = "BrowserAnswerUnread";
}

/** A refusal as a page reads it: its status, and the slug its body carries where it carries one. */
export interface BrowserRefusal {
  readonly status: number;
  readonly error: string | undefined;
}

/** The refusal an `ORPCError` carries as its cause, as the link reads it. */
class BrowserRefused extends Error {
  override readonly name = "BrowserRefused";
  constructor(readonly refusal: BrowserRefusal) {
    super(`The service refused with ${refusal.status}`);
  }
}

/**
 * Each procedure as the link answers it: the output as the wire schema
 * decodes it, so its type is the schema's own (the contract declares the
 * schema flipped, which oRPC would read as the encoded side).
 */
type BrowserLinkClient<Router> =
  Router extends ProcedureContract<infer InputSchema, infer OutputSchema, infer _Errors>
    ? Client<
        Record<never, never>,
        InferSchemaInput<InputSchema>,
        InferSchemaInput<OutputSchema>,
        unknown
      >
    : { readonly [Key in keyof Router]: BrowserLinkClient<Router[Key]> };

/** Every hosted procedure, as a page asks it. */
export type BrowserClient = BrowserLinkClient<typeof hostedContract>;

const isRefusalBody = Schema.is(Schema.Struct({ error: Schema.String }));

/**
 * Whether a contract's schema is an Effect Schema, which every hosted
 * procedure's is; a wire schema decodes and encodes with no service, which
 * is what the narrowing states beyond what `Schema.isSchema` checks.
 */
function isWireSchema(
  schema: AnySchema | undefined,
): schema is AnySchema & Schema.Codec<unknown, unknown> {
  return Schema.isSchema(schema);
}

/** The wire schema a procedure's output is decoded with: the one its contract declares, flipped back. */
function outputWireSchema(path: readonly string[]): Schema.Codec<unknown> | undefined {
  const [declared] = getProcedureContractOrThrow(hostedContract, path)["~orpc"].outputSchemas ?? [];
  return isWireSchema(declared) ? Schema.flip(declared) : undefined;
}

/** One request on the page's own `fetch`, with its cookies, a redirect followed and refused. */
async function sent(url: string, init: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(url, {
    ...init,
    credentials: "include",
    redirect: "follow",
  });
  if (response.redirected) throw new BrowserRedirected("The answer arrived through a redirect");
  return response;
}

const link = new OpenAPILink<Record<never, never>>(hostedContract, {
  fetch: (url, init) => sent(url, init),
  customErrorResponseBodyDecoder: (body, response) =>
    new ORPCError("REFUSED", {
      cause: new BrowserRefused({
        status: response.status,
        error: isRefusalBody(body) ? body.error : undefined,
      }),
    }),
  interceptors: [
    async ({ next, path }) => {
      const output = await next();
      const wire = outputWireSchema(path);
      if (wire === undefined) return output;
      // SAFETY: the link's serializer read the output out of the response's JSON text.
      const read = readServiceAnswer(wire)(output as UnparsedWireValue);
      if (Result.isFailure(read)) throw new BrowserAnswerUnread("The answer did not read");
      return read.success;
    },
  ],
});

/** The hosted contract's client for this page. */
export const browserClient: BrowserClient = createORPCClient<BrowserClient>(link);

/** The refusal a call failed with, or nothing where it failed before any status. */
export function browserRefusal(cause: unknown): BrowserRefusal | undefined {
  return cause instanceof ORPCError && cause.cause instanceof BrowserRefused
    ? cause.cause.refusal
    : undefined;
}
