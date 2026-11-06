import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@repo/features";
import { HOST_WIRE, hostUpgradeCommand } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD, HTTP_STATUS } from "@repo/wire";
import { Clock, Deferred, Duration, Effect, Option, Ref, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const QUIET = Duration.minutes(5);

const HOST_CONNECTED_REPORT = `${PRODUCT_NAME} host: Connected to ${PRODUCT_NAME}.`;

const HOST_STANDING = {
  STANDING: "standing",
  UPGRADE_NEEDED: "upgrade-needed",
  SECRET_REFUSED: "secret-refused",
} as const;

type HostStanding = (typeof HOST_STANDING)[keyof typeof HOST_STANDING];

const decodeHostRemoved = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.Literal(HOSTED_API_ERROR.INVALID_TOKEN),
      hostRemoved: Schema.Literal(true),
    }),
  ),
);

const CALLS_REFUSED_REPORT = `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's calls. It keeps asking and leaves its agents running until ${PRODUCT_NAME} takes them again or says the box was removed.`;

function refusalReport(
  refusal: Exclude<HostStanding, typeof HOST_STANDING.STANDING>,
  serviceOrigin: string,
): string {
  const script = `${serviceOrigin}${HOST_WIRE.INSTALL_SCRIPT_PATH}`;
  return refusal === HOST_STANDING.UPGRADE_NEEDED
    ? `${PRODUCT_NAME} host: upgrade needed: ${PRODUCT_NAME} no longer accepts this version. Rerun the install command to upgrade in place: ${hostUpgradeCommand(script)}`
    : `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's secret, so it was removed in Settings › Hosts. Stopping its agents. Add it again with Add hosts, and rerun the install command it shows.`;
}

interface HostServiceStanding {
  readonly asking: Effect.Effect<boolean>;
  readonly secretRefused: Effect.Effect<void>;
  readonly client: (client: HttpClient.HttpClient) => HttpClient.HttpClient;
}

export interface HostStandingOptions {
  readonly serviceOrigin: string;
  readonly version: string;
  readonly report: (line: string) => void;
}

export const hostServiceStanding = Effect.fnUntraced(function* (options: HostStandingOptions) {
  const standing = yield* Ref.make<{ readonly kind: HostStanding; readonly until: number }>({
    kind: HOST_STANDING.STANDING,
    until: 0,
  });
  const callsRefused = yield* Ref.make(false);
  const connected = yield* Ref.make(false);
  const refused = yield* Deferred.make<void>();
  const registerUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES}`;
  const beatUrl = `${options.serviceOrigin}${HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE}`;
  const ofService = (request: HttpClientRequest.HttpClientRequest) =>
    request.url === options.serviceOrigin || request.url.startsWith(`${options.serviceOrigin}/`);
  const ownCall = (request: HttpClientRequest.HttpClientRequest) =>
    request.method === HTTP_METHOD.POST && (request.url === registerUrl || request.url === beatUrl);

  const heard = (status: number, removedSaid: boolean) =>
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
        if (removedSaid) {
          yield* Ref.set(standing, { kind: HOST_STANDING.SECRET_REFUSED, until: before.until });
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

  const registered = (request: HttpClientRequest.HttpClientRequest, status: number) =>
    status >= 200 && status < 300 && request.url === registerUrl
      ? Effect.flatMap(Ref.getAndSet(connected, true), (said) =>
          said ? Effect.void : Effect.sync(() => options.report(HOST_CONNECTED_REPORT)),
        )
      : Effect.void;

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
