import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOST_RELEASE,
  HOST_TARGET,
  type HostTarget,
  hostTarballUrl,
} from "@luke/features/host-release";
import { HOST_WIRE } from "@luke/features/host-wire";

/**
 * install-script.ts -- writes the host's install script into the site's build at `HOST_WIRE.INSTALL_SCRIPT_PATH`, the release it installs (`HOST_RELEASE`) written in.
 *
 * The script's text is `install/install.sh`, which names the release only by
 * placeholders: its version, and each target's tarball by its address and
 * SHA-256, which the script checks the download against. Before the first
 * release is published there is none to write, and every placeholder is left
 * empty, which the script reads as no release yet; a target the release has
 * no tarball for (a Mac's, before the first Mac package) is left empty the
 * same way. A placeholder the script does not name is passed over, so a
 * target can be filled here before the script reads it. Runs after the
 * client build, beside the prerender, so the script is served from the same
 * deployment as the page that shows its command.
 */

const TEMPLATE = join(import.meta.dirname, "..", "install", "install.sh");
const SERVED = join(import.meta.dirname, "..", "dist", HOST_WIRE.INSTALL_SCRIPT_PATH.slice(1));

const release = HOST_RELEASE;

/** The target's tarball address, where the release carries one. */
const url = (target: HostTarget) =>
  release?.SHA256[target] === undefined ? "" : hostTarballUrl(release.VERSION, target);

const filled: Readonly<Record<string, string>> = {
  "@@VERSION@@": release?.VERSION ?? "",
  "@@SHA256_X64@@": release?.SHA256[HOST_TARGET.LINUX_X64] ?? "",
  "@@SHA256_ARM64@@": release?.SHA256[HOST_TARGET.LINUX_ARM64] ?? "",
  "@@SHA256_DARWIN_ARM64@@": release?.SHA256[HOST_TARGET.DARWIN_ARM64] ?? "",
  "@@URL_X64@@": url(HOST_TARGET.LINUX_X64),
  "@@URL_ARM64@@": url(HOST_TARGET.LINUX_ARM64),
  "@@URL_DARWIN_ARM64@@": url(HOST_TARGET.DARWIN_ARM64),
};

let script = readFileSync(TEMPLATE, "utf8");
for (const [placeholder, value] of Object.entries(filled)) {
  script = script.replaceAll(placeholder, value);
}
if (script.includes("@@"))
  throw new Error("install.sh names a placeholder this build does not fill");
writeFileSync(SERVED, script, { mode: 0o644 });
