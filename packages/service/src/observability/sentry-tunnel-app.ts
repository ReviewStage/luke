/**
 * sentry-tunnel-app.ts -- the web tab's Sentry tunnel: an envelope for the deployment's own project, passed on to Sentry's ingest as it came.
 *
 * Tracker blockers refuse Sentry's ingest host, so the web tab's SDK posts
 * each envelope to a path on our own origin (`@repo/features/sentry-tunnel`),
 * which the web service rewrites onto this route. Sentry's guide to a tunnel
 * (docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option)
 * lays out the rest: the envelope's first line is its header, whose `dsn`
 * names the project it is for, and the route passes on only an envelope whose
 * DSN names this deployment's own project (`SENTRY_DSN`), by its host and its
 * project id, so it is no open relay onto any other. The envelope is passed on
 * byte for byte to the ingest the deployment's own DSN names, never the one
 * the envelope names, with nothing added to it; the one header sent beside it
 * is the caller's address as Vercel saw it (`x-forwarded-for`), which Sentry
 * saw before the tunnel stood, when the tab posted to it directly. Sentry's
 * status and its rate limits are answered back, so the SDK backs off as it
 * would have. A deployment without `SENTRY_DSN` builds a tab that loads no SDK,
 * and answers anything posted here as unavailable. Nothing of the envelope is
 * logged.
 */

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

/** The byte that ends an envelope's header line. */
const NEWLINE = 0x0a;

/** The content type Sentry's ingest reads an envelope under. */
const ENVELOPE_CONTENT_TYPE = "application/x-sentry-envelope";

/** How long Sentry is waited on before the tab is answered that it did not answer. */
const FORWARD_TIMEOUT = "10 seconds";

/** The caller's address as Vercel saw it, the one request header passed on. */
const FORWARDED_FOR = "x-forwarded-for";

/** Sentry's answers the SDK reads to back off, passed back to it as Sentry sent them. */
const RATE_LIMIT_HEADERS = ["x-sentry-rate-limits", "retry-after"] as const;

/** The part of an envelope's header the route reads: the DSN of the project it is for. */
const EnvelopeHeader = Schema.Struct({ dsn: Schema.String });

/** A DSN as the route compares it: the ingest it names, and the project there. */
interface Project {
  /** The ingest's origin, and the path a self-hosted Sentry may put ahead of `/api/`. */
  readonly origin: string;
  readonly pathPrefix: string;
  readonly host: string;
  readonly projectId: string;
}

/** A DSN read as Sentry's SDKs read one (`https://<key>@<host>[/<prefix>]/<project id>`), or none where it is not one. */
function projectOf(dsn: string): Project | undefined {
  const url = Result.try(() => new URL(dsn));
  if (Result.isFailure(url)) return undefined;
  const { origin, host, pathname, protocol } = url.success;
  const slash = pathname.lastIndexOf("/");
  const projectId = pathname.slice(slash + 1);
  if (protocol !== "https:" || !/^\d+$/u.test(projectId)) return undefined;
  return { origin, pathPrefix: pathname.slice(0, slash), host, projectId };
}

/** The project an envelope's header names, or the invalid-request refusal where its first line names none. */
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

/** The deployment's own project, as `SENTRY_DSN` names it, or none where it is unset or no DSN. */
const ownProject = Config.option(Config.String(SENTRY_ENVIRONMENT.DSN)).pipe(
  Effect.orElseSucceed(() => Option.none<string>()),
  Effect.map((dsn) => Option.flatMap(dsn, (value) => Option.fromNullishOr(projectOf(value)))),
);

/** POST: the envelope passed on to the deployment's own project, and Sentry's answer passed back. */
const tunnelEndpoint = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const own = yield* ownProject;
  if (Option.isNone(own)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const envelope = yield* readBodyBytesEffect(SENTRY_TUNNEL.MAX_BODY_BYTES);
  const named = yield* envelopeProject(envelope);
  // Note that the key is not compared, because Sentry reads the project from the host and the id alone, and a rotated key still names this project.
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

/** The group: the tunnel's one path, and the hosted vocabulary's own refusal for any other. */
export function sentryTunnelApp(): WebRoutes<HttpClient.HttpClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, SENTRY_TUNNEL.ROUTE, hostedRefusing(tunnelEndpoint)),
    hostedNotFoundRoute,
  );
}
