import type { UnparsedWireValue } from "@repo/wire";
import { type Client, createORPCClient, ORPCError } from "@orpc/client";
import type { InferSchemaInput, ProcedureContract } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { Result, Schema } from "effect";
import { readServiceAnswer } from "../service-wire.js";
import { hostedContract } from "./index.js";
import { outputWireSchema } from "./output-schema.js";

export class BrowserRedirected extends Error {
  override readonly name = "BrowserRedirected";
}

class BrowserAnswerUnread extends Error {
  override readonly name = "BrowserAnswerUnread";
}

export interface BrowserRefusal {
  readonly status: number;
  readonly error: string | undefined;
}

class BrowserRefused extends Error {
  override readonly name = "BrowserRefused";
  constructor(readonly refusal: BrowserRefusal) {
    super(`The service refused with ${refusal.status}`);
  }
}

type BrowserLinkClient<Router> =
  Router extends ProcedureContract<infer InputSchema, infer OutputSchema, infer _Errors>
    ? Client<
        Record<never, never>,
        InferSchemaInput<InputSchema>,
        InferSchemaInput<OutputSchema>,
        unknown
      >
    : { readonly [Key in keyof Router]: BrowserLinkClient<Router[Key]> };

export type BrowserClient = BrowserLinkClient<typeof hostedContract>;

const isRefusalBody = Schema.is(Schema.Struct({ error: Schema.String }));

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
      const read = readServiceAnswer(wire)(output as UnparsedWireValue);
      if (Result.isFailure(read)) throw new BrowserAnswerUnread("The answer did not read");
      return read.success;
    },
  ],
});

export const browserClient: BrowserClient = createORPCClient<BrowserClient>(link);

export function browserRefusal(cause: unknown): BrowserRefusal | undefined {
  return cause instanceof ORPCError && cause.cause instanceof BrowserRefused
    ? cause.cause.refusal
    : undefined;
}
