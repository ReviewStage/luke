import { CLI_RELEASE, cliTarballUrl } from "@repo/features/cli-release";
import {
  HOST_RELEASE,
  HOST_TARGET,
  type HostTarget,
  hostTarballUrl,
} from "@repo/features/host-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { HTTP_METHOD } from "@repo/wire";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_REFUSAL, hostedNotFoundRoute, hostedRefusing } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

const ORIGIN_PLACEHOLDER = "@@ORIGIN@@";

const SCRIPT_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

const release = HOST_RELEASE;
const cliRelease = CLI_RELEASE;

const url = (target: HostTarget) =>
  release?.SHA256[target] === undefined ? "" : hostTarballUrl(release.VERSION, target);

const cliUrl = (target: HostTarget) =>
  cliRelease === undefined ? "" : cliTarballUrl(cliRelease.VERSION, target);

const RELEASE_FILLED: Readonly<Record<string, string>> = {
  "@@VERSION@@": release?.VERSION ?? "",
  "@@SHA256_X64@@": release?.SHA256[HOST_TARGET.LINUX_X64] ?? "",
  "@@SHA256_ARM64@@": release?.SHA256[HOST_TARGET.LINUX_ARM64] ?? "",
  "@@SHA256_DARWIN_ARM64@@": release?.SHA256[HOST_TARGET.DARWIN_ARM64] ?? "",
  "@@URL_X64@@": url(HOST_TARGET.LINUX_X64),
  "@@URL_ARM64@@": url(HOST_TARGET.LINUX_ARM64),
  "@@URL_DARWIN_ARM64@@": url(HOST_TARGET.DARWIN_ARM64),
  "@@CLI_VERSION@@": cliRelease?.VERSION ?? "",
  "@@CLI_SHA256_X64@@": cliRelease?.SHA256[HOST_TARGET.LINUX_X64] ?? "",
  "@@CLI_SHA256_ARM64@@": cliRelease?.SHA256[HOST_TARGET.LINUX_ARM64] ?? "",
  "@@CLI_SHA256_DARWIN_ARM64@@": cliRelease?.SHA256[HOST_TARGET.DARWIN_ARM64] ?? "",
  "@@CLI_URL_X64@@": cliUrl(HOST_TARGET.LINUX_X64),
  "@@CLI_URL_ARM64@@": cliUrl(HOST_TARGET.LINUX_ARM64),
  "@@CLI_URL_DARWIN_ARM64@@": cliUrl(HOST_TARGET.DARWIN_ARM64),
};

function withRelease(template: string): string {
  let script = template;
  for (const [placeholder, value] of Object.entries(RELEASE_FILLED)) {
    script = script.replaceAll(placeholder, value);
  }
  return script;
}

function scriptEndpoint(script: string) {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const origin = new URL(request.url).origin;
    return HttpServerResponse.text(script.replaceAll(ORIGIN_PLACEHOLDER, origin), {
      status: HOSTED_HTTP_STATUS.OK,
      headers: SCRIPT_HEADERS,
    });
  });
}

export function hostInstallScriptApp(template: string): WebRoutes<never> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOST_WIRE.INSTALL_SCRIPT_ROUTE,
      hostedRefusing(scriptEndpoint(withRelease(template))),
    ),
    hostedNotFoundRoute,
  );
}
