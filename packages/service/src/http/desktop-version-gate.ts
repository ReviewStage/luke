/**
 * desktop-version-gate.ts -- the oldest desktop build the service still answers, and the one refusal every older build hears.
 *
 * A desktop names its own build on every hosted call (`DESKTOP_VERSION_HEADER`).
 * The deployment names the oldest build it answers in
 * `LUKE_MINIMUM_DESKTOP_VERSION`, a `MAJOR.MINOR.PATCH` release such as
 * `0.17.0`; a call from an older build is refused before any route reads it,
 * with 426 and `update-required`, which the desktop takes as the cue to update
 * and to stop asking. With no minimum set nothing is refused, and a caller
 * that names no build at all — a browser, a webhook, a desktop older than the
 * header — is never refused for its version, so the gate only holds back
 * builds that send it.
 */
import { text } from "@luke/wire";
import { Config, ConfigProvider, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { DESKTOP_VERSION_HEADER } from "../core.js";
import { HOSTED_REFUSAL, hostedRefusalResponse } from "./http-effect.js";

const DESKTOP_VERSION_ENVIRONMENT = {
  /** The oldest desktop release the deployment answers, as `MAJOR.MINOR.PATCH`; unset answers every build. */
  MINIMUM: "LUKE_MINIMUM_DESKTOP_VERSION",
} as const;

/** A release's numeric core; a prerelease or build suffix after it is not compared. */
const RELEASE_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/u;

type ReleaseCore = readonly [number, number, number];

function releaseCore(value: string): ReleaseCore | undefined {
  const match = RELEASE_PATTERN.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `build` is a release older than `minimum`; a build that names no release is not judged. */
function olderThan(build: string, minimum: ReleaseCore): boolean {
  const core = releaseCore(build);
  if (core === undefined) return false;
  for (let place = 0; place < core.length; place += 1) {
    if (core[place] !== minimum[place]) return (core[place] ?? 0) < (minimum[place] ?? 0);
  }
  return false;
}

/**
 * The gate as a global router middleware: every route the router answers,
 * the not-found wildcard among them, is behind it. A minimum that names no
 * release is logged and gates nothing, because refusing every desktop over a
 * typo would be an outage rather than an update.
 */
export function desktopVersionGate(
  minimum: string | undefined,
): Layer.Layer<never, never, HttpRouter.HttpRouter> {
  const floor = minimum === undefined ? undefined : releaseCore(minimum);
  if (floor === undefined) {
    return minimum === undefined
      ? Layer.empty
      : Layer.effectDiscard(
          Effect.logWarning(
            `${DESKTOP_VERSION_ENVIRONMENT.MINIMUM} names no MAJOR.MINOR.PATCH release; no desktop is refused`,
          ),
        );
  }
  return HttpRouter.middleware(
    (answer) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        const build = request.headers[DESKTOP_VERSION_HEADER];
        return build !== undefined && olderThan(build, floor)
          ? Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.UPDATE_REQUIRED))
          : answer;
      }),
    { global: true },
  );
}

/**
 * The gate at the minimum this deployment's environment names, read as the
 * handler is built rather than as this module loads, the way
 * `hostedEnvironment` reads its own.
 */
export const desktopVersionGateFromEnvironment: Layer.Layer<never, never, HttpRouter.HttpRouter> =
  Layer.unwrap(
    Effect.map(
      Effect.orElseSucceed(Config.option(Config.String(DESKTOP_VERSION_ENVIRONMENT.MINIMUM)), () =>
        Option.none<string>(),
      ).pipe(
        Effect.provideServiceEffect(
          ConfigProvider.ConfigProvider,
          Effect.sync(() => ConfigProvider.fromEnv()),
        ),
      ),
      (minimum) => desktopVersionGate(text(Option.getOrUndefined(minimum))),
    ),
  );
