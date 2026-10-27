/**
 * build-host.mjs -- the host daemon's release folder this Mac's app carries in its resources (`HOST_RESOURCES`): the daemon built for the signature the app is packaged with, staged beside the runner's bundle and the pinned Node by the host's own packaging (`apps/host/scripts/package.ts`).
 *
 * Run by the package script after the runner's bundle is built. The daemon
 * reads which app it shipped in from the same environment the app's own
 * build does (`resolveSigningMode`), since that names the state folder the
 * two share (`@luke/host/app-identity`).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageAssetPaths } from "./package-assets.mjs";
import { resolveSigningMode, SIGNING_MODE } from "./package-config.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const { hostPath } = packageAssetPaths({ appRoot });
const developerIdSigned = resolveSigningMode(process.env).mode === SIGNING_MODE.DEVELOPER_ID;

execFileSync("pnpm", ["--filter", "@luke/host-daemon", "build"], {
  stdio: "inherit",
  env: { ...process.env, LUKE_HOST_DEVELOPER_ID_SIGNED: String(developerIdSigned) },
});
execFileSync(
  "pnpm",
  [
    "--filter",
    "@luke/host-daemon",
    "exec",
    "tsx",
    "scripts/package.ts",
    "--os",
    "darwin",
    "--into",
    hostPath,
  ],
  { stdio: "inherit" },
);
