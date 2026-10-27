import { Duration, Schema as EffectSchema } from "effect";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "./device-agent-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * host-wire.ts -- how a host joins its member's devices, how it names itself on every call after, and the Hosts list Settings draws.
 *
 * A host is a device of kind host (`DEVICE_KIND`): a headless Linux box
 * with nobody signed in at it, which runs its member's local agents as the
 * desktop runs them on This Mac. The member mints an install token in
 * Settings, good for any number of boxes until it expires or is revoked;
 * each box trades it once, with the id it minted for itself, for a device
 * secret of its own (`hostEnrollRequestSchema`, `hostEnrollAnswerSchema`),
 * which the service keeps only as a hash. From then on the box calls the
 * device-agents procedures (`device-agent-wire.ts`) with that secret as its
 * bearer, and every call of a host, its enroll included, carries its
 * daemon's version (`HOST_WIRE.VERSION_HEADER`); one below the service's
 * floor is refused as needing an upgrade (`hostUpgradeNeededDataSchema`).
 * A host has no developer's git login, so it asks the same way for a GitHub
 * token for each agent it runs (`hostGithubTokenRequestSchema`).
 */

export const HOST_WIRE = {
  /** What every install token begins with, so a box, a log scrubber, and a reader can tell one from any other secret. */
  INSTALL_TOKEN_PREFIX: "lkh_",
  /** What every device secret begins with, which is how the service tells a host's bearer from a desktop's sign-in. */
  DEVICE_SECRET_PREFIX: "lkd_",
  /** The header every call of a host carries its daemon's version in, as `MAJOR.MINOR.PATCH`. */
  VERSION_HEADER: "luke-host-version",
  /** The install script's path on the service's own origin, which the web app serves (`apps/web/scripts/install-script.ts`). */
  INSTALL_SCRIPT_PATH: "/install.sh",
} as const;

/** A daemon's version, as `MAJOR.MINOR.PATCH` with no leading zeros. */
const HOST_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u;

/** A daemon's version as its three numbers, or nothing where it is not `MAJOR.MINOR.PATCH`. */
export function readHostVersion(version: string): readonly [number, number, number] | undefined {
  const parts = HOST_VERSION.exec(version.trim());
  if (parts === null) return undefined;
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

/** Whether the version given is at or past the floor given, both `MAJOR.MINOR.PATCH`; a version that does not read is below any floor. */
export function hostVersionMeets(version: string, floor: string): boolean {
  const read = readHostVersion(version);
  const wanted = readHostVersion(floor);
  if (read === undefined || wanted === undefined) return false;
  for (let place = 0; place < 3; place += 1) {
    const [have, need] = [read[place] ?? 0, wanted[place] ?? 0];
    if (have !== need) return have > need;
  }
  return true;
}

/**
 * How often a GitHub token handed for an agent's repository is renewed: the
 * cloud's sandbox credential (`CODER.GITHUB_TOKEN_REFRESH`) and a host's
 * agents alike. Fifty minutes, since an installation token lasts an hour and
 * a turn can last a day.
 */
export const GITHUB_TOKEN_REFRESH = Duration.minutes(50);

/**
 * A host's ask for a GitHub token for one of its agents, posted to
 * `HOSTED_SERVICE_PATH.RUNNER_TOKEN` on its device secret: the agent's id.
 * The service answers only for the host's own member's agent that runs on
 * that very host.
 */
export const hostGithubTokenRequestSchema = EffectSchema.Struct({ agentId: wireUuidSchema });

export type HostGithubTokenRequest = typeof hostGithubTokenRequestSchema.Type;

/**
 * What it answers: a GitHub App installation token cut to the agent's
 * repository, good for an hour from its mint, which the host signs the
 * agent's own `gh` in with and renews every `GITHUB_TOKEN_REFRESH`.
 */
export const hostGithubTokenAnswerSchema = EffectSchema.Struct({
  githubToken: EffectSchema.String.check(EffectSchema.isMinLength(1)),
});

export type HostGithubTokenAnswer = typeof hostGithubTokenAnswerSchema.Type;

/** A secret of the prefix given: the prefix and at least 32 more characters of base64url. */
function secretOf(prefix: string) {
  return EffectSchema.String.check(
    EffectSchema.isMaxLength(200),
    EffectSchema.makeFilter(
      (value: string) =>
        (value.startsWith(prefix) && /^[A-Za-z0-9_-]{32,}$/u.test(value.slice(prefix.length))) ||
        `a secret beginning ${prefix}`,
    ),
  );
}

/**
 * An enroll: the id the box minted for itself once and keeps, its name (its
 * hostname), and its platform and architecture. The install token is its
 * credential, so it rides as the call's bearer (`Authorization: Bearer
 * lkh_…`) as a device secret does on every later call, and its daemon's
 * version in `HOST_WIRE.VERSION_HEADER`.
 */
export const hostEnrollRequestSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
});

export type HostEnrollRequest = typeof hostEnrollRequestSchema.Type;

/**
 * What an enroll answers: the device's id, and its secret, answered this
 * once and kept by the service only as a hash. The id of a host the member
 * removed may be enrolled again, which brings it back with a new secret; a
 * standing host's id is refused, so a token alone never takes over a box.
 */
export const hostEnrollAnswerSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  deviceSecret: secretOf(HOST_WIRE.DEVICE_SECRET_PREFIX),
});

export type HostEnrollAnswer = typeof hostEnrollAnswerSchema.Type;

/** What an upgrade-needed refusal carries beside its slug: the lowest daemon version the service takes. */
export const hostUpgradeNeededDataSchema = EffectSchema.Struct({
  minimumVersion: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * One of the member's hosts, as Settings lists it: its name, the epoch
 * milliseconds it was last seen, which a reader holds against its own clock
 * as a Mac's, which a window does not judge by (`deviceStanding`), the daemon version it last called with, none before its
 * first call that carried one, and whether that version is below the
 * service's floor.
 */
const hostSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  seenAt: countedNumber,
  version: EffectSchema.NullOr(EffectSchema.String),
  upgradeNeeded: EffectSchema.Boolean,
});

export type Host = typeof hostSchema.Type;

/** The member's hosts (GET), by name, and the install script's address on the service's own origin, which the upgrade command names. */
export const hostsAnswerSchema = EffectSchema.Struct({
  hosts: EffectSchema.Array(hostSchema),
  installScriptUrl: EffectSchema.String,
});

export type HostsAnswer = typeof hostsAnswerSchema.Type;

/**
 * How long ago each of the reader's own devices last beat, in milliseconds
 * on the service's own clock, and nothing else of it. A window ages this on
 * its own monotonic clock rather than comparing a timestamp with its wall
 * clock, so a window whose clock is off judges the same as one whose clock is
 * right. A device that is gone, has not registered, or is a teammate's is
 * left out: the window cannot speak for it.
 */
export const devicePresenceAnswerSchema = EffectSchema.Struct({
  devices: EffectSchema.Array(
    EffectSchema.Struct({ deviceId: wireUuidSchema, ageMs: countedNumber }),
  ),
});

export type DevicePresenceAnswer = typeof devicePresenceAnswerSchema.Type;

/** A SHA-256 in lowercase hex. */
const sha256Hex = EffectSchema.String.check(
  EffectSchema.makeFilter((value: string) => /^[0-9a-f]{64}$/u.test(value) || "a SHA-256 in hex"),
);

/**
 * An install token to keep (POST), by its SHA-256 alone: the member's own
 * Luke mints the token where the member is (`@luke/host`'s hosts composer)
 * and shows it there once, so the token itself never reaches the service.
 */
export const hostInstallTokenRequestSchema = EffectSchema.Struct({ tokenHash: sha256Hex });

/** What keeping an install token answers: its id, which revokes it, when it expires in epoch milliseconds, and the install script's address, which the command names. */
export const hostInstallTokenAnswerSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  expiresAt: countedNumber,
  installScriptUrl: EffectSchema.String,
});

export type HostInstallTokenAnswer = typeof hostInstallTokenAnswerSchema.Type;

/** An install token revoked, or a host removed, by its id. */
export const hostIdRequestSchema = EffectSchema.Struct({ id: wireUuidSchema });

/** What a revoke or a remove answers. */
export const hostDoneAnswerSchema = EffectSchema.Struct({ done: EffectSchema.Literal(true) });

/** The command that installs and enrolls a box as root, the install token in it. */
export function hostInstallCommand(installScriptUrl: string, installToken: string): string {
  return `curl -fsSL ${installScriptUrl} | sudo sh -s -- --token ${installToken}`;
}

/**
 * The same command run over SSH on many servers at once, each named in the
 * loop's list, for the member to fill in. One line that bash and zsh both
 * run, in a subshell so its names stay out of the member's shell: each ssh
 * is backgrounded, then each is waited for by its own pid, and the line
 * exits non-zero if any server failed. Note that `pipefail` keeps ssh's
 * status through the `sed` that prefixes each server's lines with its name,
 * since twelve servers' output would otherwise run together, and that `-n`
 * keeps a backgrounded ssh off the terminal's input.
 */
export function hostInstallLoopCommand(installScriptUrl: string, installToken: string): string {
  return `( pids=(); for h in server-1 server-2 server-3; do ( set -o pipefail; ssh -n root@$h 'curl -fsSL ${installScriptUrl} | sh -s -- --token ${installToken}' 2>&1 | sed "s/^/\${h}: /" ) & pids+=($!); done; rc=0; for p in "\${pids[@]}"; do wait $p || rc=1; done; [ $rc = 0 ] )`;
}

/**
 * The prompt that has a coding agent on the member's own computer install
 * every server it can reach, in parallel: plain text to paste into Claude
 * Code or Codex, with the install command and its token in it, and when the
 * token stops working. The token is shown in the prompt as in the commands,
 * once, and the prompt tells the agent to keep it to itself.
 */
export function hostSetupPrompt(
  installScriptUrl: string,
  installToken: string,
  expiresAt: number,
): string {
  return `Install Luke's host program on my Linux servers, so Luke can run its agents on them.

Follow these steps in order.

1. List the servers you can reach. If Tailscale is installed, use \`tailscale status\`; otherwise ask me for the hostnames. Show me the list and wait for me to confirm it before you go on.
2. Over SSH, check each server. It must be Linux (\`uname -s\`), x64 or arm64 (\`uname -m\` prints x86_64, aarch64 or arm64), and have \`/dev/kvm\` (\`test -c /dev/kvm\`). Skip any server that fails, and say why.
3. Run this command over SSH on every remaining server at the same time, as root or with sudo (drop \`sudo\` where you log in as root):

${hostInstallCommand(installScriptUrl, installToken)}

   It prints a ✓ line for each step, and keeps going after the connection check, so read its whole output, not just its end. "✓ Connected to Luke" means the server is installed and connected. A line beginning "! Not connected to Luke yet" means it is installed but not connected yet, and you report it that way. A ✗ line means it failed, and the command exits non-zero. It can take several minutes, because it also fetches a 1.3 GB image at the end, so wait for it.
4. When every server has finished, reply with a table: server, result (connected, installed but not connected, skipped or failed) and, for a skip or a failure, the reason. For a failure, give the last ✗ line the server printed, or its last line of output if there is none.
5. The install token in the command is a secret, and stops working at ${new Date(expiresAt).toISOString()}. Pass the command straight to ssh. Never write the token to a file, a memory or a note, and never repeat it in your reply or summary.
`;
}

/** The command that upgrades an enrolled box in place, keeping its secret: the install command with no token. */
export function hostUpgradeCommand(installScriptUrl: string): string {
  return `curl -fsSL ${installScriptUrl} | sudo sh`;
}
