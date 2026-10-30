/**
 * host-install-script-app.ts -- the install script group: the host's install script, with the release it installs and the origin it was asked on written in.
 *
 * The script's text is the web app's `install/install.sh`, handed in by the
 * route that serves it, which names what it is filled with only by
 * placeholders: the release (`HOST_RELEASE`), its version and each target's
 * tarball by its address and SHA-256, which the script checks the download
 * against; and the origin the box enrolls against. Before the first release
 * is published there is none to write, and every release placeholder is left
 * empty, which the script reads as no release yet; a target the release has
 * no tarball for (a Mac's, before the first Mac package) is left empty the
 * same way. A placeholder the script does not name is passed over, so a
 * target can be filled here before the script reads it.
 *
 * The release is the same for every request and is written in once. The
 * origin is the request's own, so a Preview's install command enrolls the box
 * with that Preview, at whichever of its addresses the script was fetched
 * from, and production's with production; `--origin` still overrides it. A
 * Preview answers on more than one address, so no build-time variable could
 * name it, and since one path answers each origin its own text, no cache
 * keeps the answer.
 */

import {
  HOST_RELEASE,
  HOST_TARGET,
  type HostTarget,
  hostTarballUrl,
} from "@luke/features/host-release";
import { HOST_WIRE } from "@luke/features/host-wire";
import { HTTP_METHOD } from "@luke/wire";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_REFUSAL, hostedNotFoundRoute, hostedRefusing } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

const ORIGIN_PLACEHOLDER = "@@ORIGIN@@";

/** Read as text where a browser opens it, and kept by no cache, since each origin is answered its own. */
const SCRIPT_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

const release = HOST_RELEASE;

/** The target's tarball address, where the release carries one. */
const url = (target: HostTarget) =>
  release?.SHA256[target] === undefined ? "" : hostTarballUrl(release.VERSION, target);

const RELEASE_FILLED: Readonly<Record<string, string>> = {
  "@@VERSION@@": release?.VERSION ?? "",
  "@@SHA256_X64@@": release?.SHA256[HOST_TARGET.LINUX_X64] ?? "",
  "@@SHA256_ARM64@@": release?.SHA256[HOST_TARGET.LINUX_ARM64] ?? "",
  "@@SHA256_DARWIN_ARM64@@": release?.SHA256[HOST_TARGET.DARWIN_ARM64] ?? "",
  "@@URL_X64@@": url(HOST_TARGET.LINUX_X64),
  "@@URL_ARM64@@": url(HOST_TARGET.LINUX_ARM64),
  "@@URL_DARWIN_ARM64@@": url(HOST_TARGET.DARWIN_ARM64),
};

/** The script with the release written in and the origin left for each request. */
function withRelease(template: string): string {
  let script = template;
  for (const [placeholder, value] of Object.entries(RELEASE_FILLED)) {
    script = script.replaceAll(placeholder, value);
  }
  return script;
}

/** GET: the script, naming as its origin the one the request was made to. */
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

/** The group: the install script filled from `template`, and the hosted vocabulary's own refusal for any other path. */
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
