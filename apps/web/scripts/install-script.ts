import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEVICE_ARCH } from "@luke/features/device-agent-wire";
import { HOST_RELEASE, hostTarballUrl } from "@luke/features/host-release";
import { HOST_WIRE } from "@luke/features/host-wire";

/**
 * install-script.ts -- writes the host's install script into the site's build at `HOST_WIRE.INSTALL_SCRIPT_PATH`, the release it installs (`HOST_RELEASE`) written in.
 *
 * The script's text is `install/install.sh`, which names the release only by
 * placeholders: its version, and each architecture's tarball by its address
 * and SHA-256, which the script checks the download against. Before the
 * first release is published there is none to write, and every placeholder
 * is left empty, which the script reads as no release yet. Runs after the
 * client build, beside the prerender, so the script is served from the same
 * deployment as the page that shows its command.
 */

const TEMPLATE = join(import.meta.dirname, "..", "install", "install.sh");
const SERVED = join(import.meta.dirname, "..", "dist", HOST_WIRE.INSTALL_SCRIPT_PATH.slice(1));

const release = HOST_RELEASE;
const filled: Readonly<Record<string, string>> = {
  "@@VERSION@@": release?.VERSION ?? "",
  "@@SHA256_X64@@": release?.SHA256[DEVICE_ARCH.X64] ?? "",
  "@@SHA256_ARM64@@": release?.SHA256[DEVICE_ARCH.ARM64] ?? "",
  "@@URL_X64@@": release === undefined ? "" : hostTarballUrl(release.VERSION, DEVICE_ARCH.X64),
  "@@URL_ARM64@@": release === undefined ? "" : hostTarballUrl(release.VERSION, DEVICE_ARCH.ARM64),
};

let script = readFileSync(TEMPLATE, "utf8");
for (const [placeholder, value] of Object.entries(filled)) {
  script = script.replaceAll(placeholder, value);
}
if (script.includes("@@"))
  throw new Error("install.sh names a placeholder this build does not fill");
writeFileSync(SERVED, script, { mode: 0o644 });
