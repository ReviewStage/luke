import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@repo/features";
import { HOST_WIRE, hostUpgradeCommand } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD, HTTP_STATUS } from "@repo/wire";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Option,
  Ref,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
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
 * rather than exiting for systemd to start it over every few seconds. Its
 * quiet spell is told as it starts and as it passes (`asking`), the end by
 * one wait until the instant it ends, so nothing reads it in between.
 *
 * A 401 is not taken as the host removed by itself, since anything on the
 * origin may answer one: a deployment's protection, one route's bug. The
 * host is removed once its own register or beat says so: the service marks
 * the 401 of a secret no standing host holds `hostRemoved`
 * (`hostRemovedDataSchema`), and the first such answer settles it. Any
 * other 401, a bare one to register or beat among them, settles
 * nothing: it is said once, until the service next takes a call, and the
 * daemon keeps asking at its own pace, its runners left running, since a
 * quiet spell shuts the follower's gate, which stops every runner. A removal
 * settled is heard by `secretRefused`, on which the daemon stops every
 * runner it started and ends. The service taking the box's calls again
 * after either refusal is said once too.
 */

/** How long the daemon asks the service nothing after it was refused as below its floor, before it tries again. */
const QUIET = Duration.minutes(5);

/** What the daemon says once the service first took its register, which a person following its log reads as the box connected. */
const HOST_CONNECTED_REPORT = `${PRODUCT_NAME} host: Connected to ${PRODUCT_NAME}.`;

/** What the service last said of this host. */
const HOST_STANDING = {
  /** The service took its calls, or has not been asked yet. */
  STANDING: "standing",
  /** The service refused its version as below its floor. */
  UPGRADE_NEEDED: "upgrade-needed",
  /** The service refused its device secret: the host was removed, or enrolled again elsewhere. */
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

/** What the daemon says once the service first refuses a call with a 401 that settles nothing, until the service next takes a call. */
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
  /** Whether the daemon may ask the service, as it stands now and each time it changes: it was not refused as below the floor, or its quiet spell has passed. */
  readonly asking: Stream.Stream<boolean>;
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
  const standing = yield* SubscriptionRef.make<{
    readonly kind: HostStanding;
    readonly until: number;
  }>({
    kind: HOST_STANDING.STANDING,
    until: 0,
  });
  /** Whether a 401 that settled nothing was said since the service last took a call. */
  const callsRefused = yield* Ref.make(false);
  const connected = yield* Ref.make(false);
  const refused = yield* Deferred.make<void>();
  const registerUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES}`;
  const beatUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE}`;
  const ofService = (request: HttpClientRequest.HttpClientRequest) =>
    request.url === options.serviceOrigin || request.url.startsWith(`${options.serviceOrigin}/`);
  /** Whether a request is the device's own register or beat, the two calls whose refusal speaks for its secret. */
  const ownCall = (request: HttpClientRequest.HttpClientRequest) =>
    request.method === HTTP_METHOD.POST && (request.url === registerUrl || request.url === beatUrl);

  /** One answer heard, `removedSaid` where it is the device's own register or beat marked `hostRemoved`: a refusal said once as it starts, a 426 a quiet spell, a removal the end; a 2xx after a refusal says the service is reached again. */
  const heard = (status: number, removedSaid: boolean) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const before = yield* SubscriptionRef.get(standing);
      if (before.kind === HOST_STANDING.SECRET_REFUSED) return;
      if (status === HTTP_STATUS.UPGRADE_REQUIRED) {
        yield* SubscriptionRef.set(standing, {
          kind: HOST_STANDING.UPGRADE_NEEDED,
          until: now + Duration.toMillis(QUIET),
        });
        if (before.kind !== HOST_STANDING.UPGRADE_NEEDED) {
          options.report(refusalReport(HOST_STANDING.UPGRADE_NEEDED, options.serviceOrigin));
        }
        return;
      }
      if (status === HTTP_STATUS.UNAUTHORIZED) {
        if (removedSaid) {
          yield* SubscriptionRef.set(standing, {
            kind: HOST_STANDING.SECRET_REFUSED,
            until: before.until,
          });
          yield* Deferred.succeed(refused, undefined);
          options.report(refusalReport(HOST_STANDING.SECRET_REFUSED, options.serviceOrigin));
          return;
        }
        if (!(yield* Ref.getAndSet(callsRefused, true))) options.report(CALLS_REFUSED_REPORT);
        return;
      }
      if (status < 200 || status >= 300) return;
      const callsTaken = yield* Ref.getAndSet(callsRefused, false);
      if (before.kind !== HOST_STANDING.STANDING) {
        yield* SubscriptionRef.set(standing, { kind: HOST_STANDING.STANDING, until: 0 });
      }
      if (before.kind !== HOST_STANDING.STANDING || callsTaken) {
        options.report(`${PRODUCT_NAME} host: ${PRODUCT_NAME} took this box's calls again.`);
      }
    });

  /** Waits until the standing is no longer `from`: a refusal or a call taken heard since. */
  const movedFrom = (from: unknown) =>
    SubscriptionRef.changes(standing).pipe(
      Stream.filter((now) => now !== from),
      Stream.runHead,
    );

  /**
   * Waits until the quiet spell standing now has passed: one wait until the
   * instant it ends, worked out again only where a refusal heard meanwhile
   * moved that instant later, or a call taken ended the spell at once.
   */
  const quietPassed = Effect.gen(function* () {
    for (;;) {
      const now = yield* SubscriptionRef.get(standing);
      const left = now.until - (yield* Clock.currentTimeMillis);
      if (left <= 0) return true;
      yield* Effect.raceFirst(Effect.sleep(Duration.millis(left)), Effect.asVoid(movedFrom(now)));
    }
  });

  /** Asking as each refusal leaves it: shut as a quiet spell starts, and open again once it has passed. */
  const asking = SubscriptionRef.changes(standing).pipe(
    Stream.map((heard) => heard.until),
    Stream.changes,
    Stream.flatMap((until) =>
      Stream.unwrap(
        Effect.map(Clock.currentTimeMillis, (now) =>
          now >= until
            ? Stream.make(true)
            : Stream.concat(Stream.make(false), Stream.fromEffect(quietPassed)),
        ),
      ),
    ),
    Stream.changes,
  );

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
        yield* heard(answer.status, false);
        yield* registered(request, answer.status);
        return answer;
      }
      const text = yield* Effect.orElseSucceed(answer.text, () => "");
      yield* heard(answer.status, Option.isSome(decodeHostRemoved(text)));
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
