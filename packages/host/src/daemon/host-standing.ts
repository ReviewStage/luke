import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@repo/features";
import { HOST_WIRE, hostUpgradeCommand } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD, HTTP_STATUS } from "@repo/wire";
import { Clock, Deferred, Duration, Effect, Option, Ref, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

/**
 * host-standing.ts -- every call a host's daemon makes to the service, its version on it, and what the service's answers say of the host's standing: refused as needing an upgrade, its calls refused, or the host removed.
 *
 * Every request to the service's origin carries the daemon's version
 * (`HOST_WIRE.VERSION_HEADER`), its connect and the follower's reads alike,
 * since they all go through the one `HttpClient` the daemon hands them; a
 * request anywhere else, a pinned tool's download, carries nothing of
 * ours. The same client hears each answer's status. A 426 is the service
 * refusing a daemon below its floor: said once, in words a person at the box
 * can act on, and the daemon goes quiet for `QUIET` before it asks again,
 * rather than exiting for systemd to start it over every few seconds.
 *
 * A 401 is not taken as the host removed by itself, since anything on the
 * origin may answer one: a deployment's protection, a database restored
 * from before the box's secret, one route's bug. The host is removed only
 * once its own register or beat says so, and says it again: the service
 * marks the 401 of a secret no standing host holds `hostRemoved`
 * (`hostRemovedDataSchema`), and a second such answer at least `CONFIRM`
 * after the first, with nothing of the service's taken between, settles it.
 * A service from before that mark answers a bare 401, which settles it only
 * once register and beat have answered nothing else for `UNMARKED_CONFIRM`.
 * Any other 401 is said once, until every route it refused takes a call
 * again, and the daemon keeps asking at its own pace, its runners left
 * running, since a quiet spell shuts the follower's gate, which stops every
 * runner. A removal settled is heard by `secretRefused`, on which the daemon
 * stops every runner it started and ends. The service taking the box's calls
 * again after either refusal is said once too.
 */

/** How long the daemon asks the service nothing after it was refused as below its floor, before it tries again. */
const QUIET = Duration.minutes(5);

/** How long after the first answer saying the host was removed a register or beat must say it again to settle the removal: a few beats. */
const CONFIRM = Duration.minutes(1);

/** How long a service from before the `hostRemoved` mark must refuse every register and beat, taking nothing between, before the host is taken as removed. */
const UNMARKED_CONFIRM = Duration.hours(1);

/** What the daemon says once the service first took its register, which a person following its log reads as the box connected. */
const HOST_CONNECTED_REPORT = `${PRODUCT_NAME} host: Connected to ${PRODUCT_NAME}.`;

/** What the service last said of this host. */
const HOST_STANDING = {
  /** The service took its calls, or has not been asked yet. */
  STANDING: "standing",
  /** The service refused its version as below its floor. */
  UPGRADE_NEEDED: "upgrade-needed",
  /** The service refused its device secret, and said so again: the host was removed, or enrolled again elsewhere. */
  SECRET_REFUSED: "secret-refused",
} as const;

type HostStanding = (typeof HOST_STANDING)[keyof typeof HOST_STANDING];

/** A 401 the service marked as the secret of no standing host (`hostRemovedDataSchema`). */
const decodeHostRemoved = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Literal(HOSTED_API_ERROR.INVALID_TOKEN),
      hostRemoved: Schema.Literal(true),
    }),
  ),
);

/** What the daemon says once the service first refuses a call with a 401 that settles nothing, until every route it refused takes a call again. */
const CALLS_REFUSED_REPORT = `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's calls. It keeps asking and leaves its agents running until ${PRODUCT_NAME} takes them again or says the box was removed.`;

/** What a person at the box reads for each refusal, said once as it starts: the command to run, on the service the box enrolled with. */
function refusalReport(
  refusal: Exclude<HostStanding, typeof HOST_STANDING.STANDING>,
  serviceOrigin: string,
): string {
  const script = `${serviceOrigin}${HOST_WIRE.INSTALL_SCRIPT_PATH}`;
  return refusal === HOST_STANDING.UPGRADE_NEEDED
    ? `${PRODUCT_NAME} host: upgrade needed: ${PRODUCT_NAME} no longer accepts this version. Rerun the install command to upgrade in place: ${hostUpgradeCommand(script)}`
    : `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's secret, so it was removed in Settings › Hosts. Stopping its agents. Add it again with Add hosts, and rerun the install command it shows.`;
}

/** The host's standing with the service, as its calls heard it, and the client every call of its goes through. */
interface HostServiceStanding {
  /** Whether the daemon may ask the service now: it was not refused as below the floor, or its quiet spell has passed. */
  readonly asking: Effect.Effect<boolean>;
  /** Waits until the service has settled the box's secret as refused: the host was removed, and nothing it asks is answered again. */
  readonly secretRefused: Effect.Effect<void>;
  /** The client given, every request to the service's origin with the version on it and its answer heard. */
  readonly client: (client: HttpClient.HttpClient) => HttpClient.HttpClient;
}

export interface HostStandingOptions {
  /** The service's origin, with no trailing slash. */
  readonly serviceOrigin: string;
  readonly version: string;
  readonly report: (line: string) => void;
}

/** A host's standing with the service, standing until its first refusal. */
export const hostServiceStanding = Effect.fnUntraced(function* (options: HostStandingOptions) {
  const standing = yield* Ref.make<{ readonly kind: HostStanding; readonly until: number }>({
    kind: HOST_STANDING.STANDING,
    until: 0,
  });
  /** When register or beat first answered a 401 since the service last took a call, and first said the host was removed. */
  const refusedSince = yield* Ref.make<{
    readonly any?: number | undefined;
    readonly removed?: number | undefined;
  }>({});
  /** The routes whose last answer was a 401 that settled nothing, by their address: the box's calls stand refused while any does. */
  const refusedRoutes = yield* Ref.make<ReadonlySet<string>>(new Set());
  const connected = yield* Ref.make(false);
  const refused = yield* Deferred.make<void>();
  const registerUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES}`;
  const beatUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE}`;
  const ofService = (request: HttpClientRequest.HttpClientRequest) =>
    request.url === options.serviceOrigin || request.url.startsWith(`${options.serviceOrigin}/`);
  /** Whether a request is the device's own register or beat, the two calls whose refusal speaks for its secret. */
  const ownCall = (request: HttpClientRequest.HttpClientRequest) =>
    request.method === HTTP_METHOD.POST && (request.url === registerUrl || request.url === beatUrl);

  /** Whether a 401 settles the host as removed: its own register or beat said so again past `CONFIRM`, or refused unmarked past `UNMARKED_CONFIRM`. */
  const removalSettled = (now: number, own: boolean, removedSaid: boolean) =>
    Effect.gen(function* () {
      if (!own) return false;
      const since = yield* Ref.updateAndGet(refusedSince, (before) => ({
        any: before.any ?? now,
        removed: removedSaid ? (before.removed ?? now) : before.removed,
      }));
      return (
        (removedSaid && now - (since.removed ?? now) >= Duration.toMillis(CONFIRM)) ||
        now - (since.any ?? now) >= Duration.toMillis(UNMARKED_CONFIRM)
      );
    });

  /** One answer heard: a refusal said once as it starts, a 426 a quiet spell, a settled removal the end; a 2xx after a refusal says the service is reached again. */
  const heard = (
    request: HttpClientRequest.HttpClientRequest,
    status: number,
    removedSaid: boolean,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const before = yield* Ref.get(standing);
      if (before.kind === HOST_STANDING.SECRET_REFUSED) return;
      if (status === HTTP_STATUS.UPGRADE_REQUIRED) {
        yield* Ref.set(standing, {
          kind: HOST_STANDING.UPGRADE_NEEDED,
          until: now + Duration.toMillis(QUIET),
        });
        if (before.kind !== HOST_STANDING.UPGRADE_NEEDED) {
          options.report(refusalReport(HOST_STANDING.UPGRADE_NEEDED, options.serviceOrigin));
        }
        return;
      }
      if (status === HTTP_STATUS.UNAUTHORIZED) {
        if (yield* removalSettled(now, ownCall(request), removedSaid)) {
          yield* Ref.set(standing, { kind: HOST_STANDING.SECRET_REFUSED, until: before.until });
          yield* Deferred.succeed(refused, undefined);
          options.report(refusalReport(HOST_STANDING.SECRET_REFUSED, options.serviceOrigin));
          return;
        }
        const routes = yield* Ref.getAndUpdate(
          refusedRoutes,
          (held) => new Set([...held, request.url]),
        );
        if (routes.size === 0) options.report(CALLS_REFUSED_REPORT);
        return;
      }
      if (status < 200 || status >= 300) return;
      yield* Ref.set(refusedSince, {});
      const routes = yield* Ref.getAndUpdate(refusedRoutes, (held) => {
        const left = new Set(held);
        left.delete(request.url);
        return left;
      });
      const callsTaken = routes.size === 1 && routes.has(request.url);
      if (before.kind !== HOST_STANDING.STANDING) {
        yield* Ref.set(standing, { kind: HOST_STANDING.STANDING, until: 0 });
      }
      if (before.kind !== HOST_STANDING.STANDING || callsTaken) {
        options.report(`${PRODUCT_NAME} host: ${PRODUCT_NAME} took this box's calls again.`);
      }
    });

  const asking = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return now >= (yield* Ref.get(standing)).until;
  });

  /** The first register the service took, said once, which is what a person following its log waits to read. */
  const registered = (request: HttpClientRequest.HttpClientRequest, status: number) =>
    status >= 200 && status < 300 && request.url === registerUrl
      ? Effect.flatMap(Ref.getAndSet(connected, true), (said) =>
          said ? Effect.void : Effect.sync(() => options.report(HOST_CONNECTED_REPORT)),
        )
      : Effect.void;

  /**
   * One answer of the service's heard and handed on. A 401 to its own
   * register or beat has its body read for the `hostRemoved` mark, and is
   * handed on as a fresh response over the same bytes, since the caller
   * reads the body as a stream that a read here would have spent.
   */
  const answered = (
    request: HttpClientRequest.HttpClientRequest,
    answer: HttpClientResponse.HttpClientResponse,
  ) =>
    Effect.gen(function* () {
      if (!ownCall(request) || answer.status !== HTTP_STATUS.UNAUTHORIZED) {
        yield* heard(request, answer.status, false);
        yield* registered(request, answer.status);
        return answer;
      }
      const text = yield* Effect.orElseSucceed(answer.text, () => "");
      yield* heard(request, answer.status, Option.isSome(decodeHostRemoved(text)));
      return HttpClientResponse.fromWeb(
        request,
        new Response(text, { status: answer.status, headers: answer.headers }),
      );
    });

  const client = (inner: HttpClient.HttpClient): HttpClient.HttpClient =>
    inner.pipe(
      HttpClient.mapRequest((request) =>
        ofService(request)
          ? HttpClientRequest.setHeader(request, HOST_WIRE.VERSION_HEADER, options.version)
          : request,
      ),
      HttpClient.transform((response, request) =>
        ofService(request)
          ? Effect.flatMap(response, (answer) => answered(request, answer))
          : response,
      ),
    );

  return { asking, client, secretRefused: Deferred.await(refused) } satisfies HostServiceStanding;
});
