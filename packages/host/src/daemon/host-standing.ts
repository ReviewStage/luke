import { HOSTED_SERVICE_PATH } from "@luke/features";
import { HOST_WIRE, hostUpgradeCommand } from "@luke/features/host-wire";
import { HTTP_STATUS } from "@luke/wire";
import { Clock, Deferred, Duration, Effect, Ref } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * host-standing.ts -- every call a host's daemon makes to Luke, its version on it, and what Luke's answers say of the host's standing: refused as needing an upgrade, or its secret refused.
 *
 * Every request to the service's origin carries the daemon's version
 * (`HOST_WIRE.VERSION_HEADER`), its enroll and the follower's reads alike,
 * since they all go through the one `HttpClient` the daemon hands them; a
 * request anywhere else, a pinned tool's download, carries nothing of
 * Luke's. The same client hears each answer's status. A 426 is the service
 * refusing a daemon below its floor, and a 401 the box's secret refused, the
 * host removed in Settings; either is said once, in words a person at the
 * box can act on. Below the floor, the daemon goes quiet for `QUIET` before
 * it asks again, rather than exiting for systemd to start it over every few
 * seconds; a refused secret is heard by `secretRefused`, on which the daemon
 * stops every runner it started and ends.
 * Any other answer is the service reached, which a 2xx after a quiet spell
 * says aloud too.
 */

/** How long the daemon asks Luke nothing after it was refused, before it tries again. */
const QUIET = Duration.minutes(5);

/** What the daemon says once Luke first took its register, which the install script reads as the box connected. */
const HOST_CONNECTED_REPORT = "Luke host: Connected to Luke.";

/** What Luke last said of this host. */
const HOST_STANDING = {
  /** Luke took its calls, or has not been asked yet. */
  STANDING: "standing",
  /** Luke refused its version as below its floor. */
  UPGRADE_NEEDED: "upgrade-needed",
  /** Luke refused its device secret: the host was removed, or enrolled again elsewhere. */
  SECRET_REFUSED: "secret-refused",
} as const;

type HostStanding = (typeof HOST_STANDING)[keyof typeof HOST_STANDING];

/** What a person at the box reads for each refusal, said once as it starts: the command to run, on the service the box enrolled with. */
function refusalReport(
  refusal: Exclude<HostStanding, typeof HOST_STANDING.STANDING>,
  serviceOrigin: string,
): string {
  const script = `${serviceOrigin}${HOST_WIRE.INSTALL_SCRIPT_PATH}`;
  return refusal === HOST_STANDING.UPGRADE_NEEDED
    ? `Luke host: upgrade needed: Luke no longer accepts this version. Rerun the install command to upgrade in place: ${hostUpgradeCommand(script)}`
    : "Luke host: Luke refused this box's secret, so it was removed in Settings › Agents › Machines. Stopping its agents. Add it again with Add Linux servers, and rerun the install command it shows.";
}

/** The host's standing with Luke, as its calls heard it, and the client every call of its goes through. */
interface HostServiceStanding {
  /** Whether the daemon may ask Luke now: it was not refused, or its quiet spell has passed. */
  readonly asking: Effect.Effect<boolean>;
  /** Waits until Luke first refuses the box's secret: the host was removed, and nothing it asks is answered again. */
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

/** A host's standing with Luke, standing until its first refusal. */
export const hostServiceStanding = Effect.fnUntraced(function* (options: HostStandingOptions) {
  const standing = yield* Ref.make<{ readonly kind: HostStanding; readonly until: number }>({
    kind: HOST_STANDING.STANDING,
    until: 0,
  });
  const connected = yield* Ref.make(false);
  const refused = yield* Deferred.make<void>();
  const registerUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES}`;
  const ofService = (request: HttpClientRequest.HttpClientRequest) =>
    request.url === options.serviceOrigin || request.url.startsWith(`${options.serviceOrigin}/`);

  /** One answer's status heard: a refusal starts a quiet spell, said once; a 2xx after one says Luke is reached again. */
  const heard = (status: number) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const before = yield* Ref.get(standing);
      const refusal =
        status === HTTP_STATUS.UPGRADE_REQUIRED
          ? HOST_STANDING.UPGRADE_NEEDED
          : status === HTTP_STATUS.UNAUTHORIZED
            ? HOST_STANDING.SECRET_REFUSED
            : undefined;
      if (refusal !== undefined) {
        yield* Ref.set(standing, { kind: refusal, until: now + Duration.toMillis(QUIET) });
        if (refusal === HOST_STANDING.SECRET_REFUSED) yield* Deferred.succeed(refused, undefined);
        if (before.kind !== refusal) options.report(refusalReport(refusal, options.serviceOrigin));
        return;
      }
      if (status >= 200 && status < 300 && before.kind !== HOST_STANDING.STANDING) {
        yield* Ref.set(standing, { kind: HOST_STANDING.STANDING, until: 0 });
        options.report("Luke host: Luke took this box's calls again.");
      }
    });

  const asking = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return now >= (yield* Ref.get(standing)).until;
  });

  /** The first register Luke took, said once, which is what the install script waits to read. */
  const registered = (request: HttpClientRequest.HttpClientRequest, status: number) =>
    status >= 200 && status < 300 && request.url === registerUrl
      ? Effect.flatMap(Ref.getAndSet(connected, true), (said) =>
          said ? Effect.void : Effect.sync(() => options.report(HOST_CONNECTED_REPORT)),
        )
      : Effect.void;

  const client = (inner: HttpClient.HttpClient): HttpClient.HttpClient =>
    inner.pipe(
      HttpClient.mapRequest((request) =>
        ofService(request)
          ? HttpClientRequest.setHeader(request, HOST_WIRE.VERSION_HEADER, options.version)
          : request,
      ),
      HttpClient.transform((response, request) =>
        ofService(request)
          ? Effect.tap(response, (answer) =>
              Effect.andThen(heard(answer.status), registered(request, answer.status)),
            )
          : response,
      ),
    );

  return { asking, client, secretRefused: Deferred.await(refused) } satisfies HostServiceStanding;
});
