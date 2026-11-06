import { SENTRY_TUNNEL } from "@repo/features/sentry-tunnel";
import { EXCESS_KEYS, HTTP_METHOD } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Config, Effect, Layer, Option, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  jsonOf,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { SENTRY_ENVIRONMENT } from "./sentry.js";

const NEWLINE = 0x0a;

const ENVELOPE_CONTENT_TYPE = "application/x-sentry-envelope";

const FORWARD_TIMEOUT = "10 seconds";

const FORWARDED_FOR = "x-forwarded-for";

const RATE_LIMIT_HEADERS = ["x-sentry-rate-limits", "retry-after"] as const;

const EnvelopeHeader = Schema.Struct({ dsn: Schema.String });

interface Project {
  readonly origin: string;
  readonly pathPrefix: string;
  readonly host: string;
  readonly projectId: string;
}

function projectOf(dsn: string): Project | undefined {
  const url = Result.try(() => new URL(dsn));
  if (Result.isFailure(url)) return undefined;
  const { origin, host, pathname, protocol } = url.success;
  const slash = pathname.lastIndexOf("/");
  const projectId = pathname.slice(slash + 1);
  if (protocol !== "https:" || !/^\d+$/u.test(projectId)) return undefined;
  return { origin, pathPrefix: pathname.slice(0, slash), host, projectId };
}

function envelopeProject(envelope: Uint8Array): Effect.Effect<Project, HostedRefusal> {
  const end = envelope.indexOf(NEWLINE);
  const line = envelope.subarray(0, end === -1 ? envelope.byteLength : end);
  const text = Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(line));
  const header = Result.isSuccess(text)
    ? readEither(EnvelopeHeader, { excess: EXCESS_KEYS.DROP })(jsonOf(text.success))
    : undefined;
  const project =
    header !== undefined && Result.isSuccess(header) ? projectOf(header.success.dsn) : undefined;
  return project === undefined
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(project);
}

const ownProject = Config.option(Config.String(SENTRY_ENVIRONMENT.DSN)).pipe(
  Effect.orElseSucceed(() => Option.none<string>()),
  Effect.map((dsn) => Option.flatMap(dsn, (value) => Option.fromNullishOr(projectOf(value)))),
);

const tunnelEndpoint = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const own = yield* ownProject;
  if (Option.isNone(own)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const envelope = yield* readBodyBytesEffect(SENTRY_TUNNEL.MAX_BODY_BYTES);
  const named = yield* envelopeProject(envelope);
  if (named.host !== own.value.host || named.projectId !== own.value.projectId) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const forwardedFor = incoming.headers[FORWARDED_FOR];
  const request = HttpClientRequest.post(
    `${own.value.origin}${own.value.pathPrefix}/api/${own.value.projectId}/envelope/`,
    { headers: forwardedFor === undefined ? {} : { [FORWARDED_FOR]: forwardedFor } },
  ).pipe(HttpClientRequest.bodyUint8Array(envelope, ENVELOPE_CONTENT_TYPE));
  const client = yield* HttpClient.HttpClient;
  const answer = yield* client.execute(request).pipe(
    Effect.timeout(FORWARD_TIMEOUT),
    Effect.mapError((): HostedRefusal => HOSTED_REFUSAL.UPSTREAM_ERROR),
  );
  const headers = Object.fromEntries(
    RATE_LIMIT_HEADERS.flatMap((name) => {
      const value = answer.headers[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return HttpServerResponse.empty({ status: answer.status, headers });
});

export function sentryTunnelApp(): WebRoutes<HttpClient.HttpClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, SENTRY_TUNNEL.ROUTE, hostedRefusing(tunnelEndpoint)),
    hostedNotFoundRoute,
  );
}
