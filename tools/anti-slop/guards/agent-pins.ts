import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { loadModule, type RepositoryGuard, readJson, record, text } from "./guard.ts";

/**
 * agent-pins.ts -- the agents' images install what the code was written against.
 *
 * The runner bundles the Agent SDK `CLAUDE_CODE_PIN` names, and the image
 * checks for the `claude` that SDK carries; the Codex protocol types were
 * generated from the Codex `CODEX_PIN` installs; every host fetches its own
 * Claude Code and Codex of the same releases, each pin's address, size, and
 * digests read off its release, so one left behind by a bump is refused on
 * every host as it fetches; and the coding agent's
 * sandbox template starts from the base image of the eve the service runs.
 * A pin moved on one side alone builds, typechecks, and fails only in a
 * hosted sandbox.
 */

const SDK = "@anthropic-ai/claude-agent-sdk";
const RUNNER = "packages/agent-runner";
const SERVICE = "packages/service";
const EVE_BASE_IMAGE_REPOSITORY = "vcr.vercel.com/vercel/eve/base";

/** A host's own build of an agent CLI as the guard reads its pin: its name in `pins.ts`, its release, and its address. */
export interface HostCliPin {
  readonly name: string;
  readonly version: string;
  readonly archive: string;
}

/** The versions each side states, as the guard reads them. */
export interface AgentPins {
  readonly runnerSdkDependency: string | undefined;
  readonly pinnedSdk: string;
  readonly pinnedClaude: string;
  readonly installedSdk: string;
  readonly installedSdkClaude: string;
  readonly codexProtocol: string;
  readonly pinnedCodex: string;
  readonly hostClaudePins: readonly HostCliPin[];
  readonly hostCodexPins: readonly HostCliPin[];
  readonly eveBaseImage: string;
  readonly installedEve: string;
}

/** Where the pins disagree, each as a line naming both sides. */
export function pinProblems(pins: AgentPins): readonly string[] {
  const problems: string[] = [];
  const differ = (what: string, left: string | undefined, right: string): void => {
    if (left !== right) problems.push(`${what}: ${left ?? "nothing"} against ${right}`);
  };
  differ(
    `${RUNNER}/package.json's ${SDK} against CLAUDE_CODE_PIN.SDK_VERSION`,
    pins.runnerSdkDependency,
    pins.pinnedSdk,
  );
  differ(
    `the installed ${SDK} against CLAUDE_CODE_PIN.SDK_VERSION`,
    pins.installedSdk,
    pins.pinnedSdk,
  );
  differ(
    `the installed ${SDK}'s claudeCodeVersion against CLAUDE_CODE_PIN.VERSION`,
    pins.installedSdkClaude,
    pins.pinnedClaude,
  );
  differ("CODEX_PROTOCOL_VERSION against CODEX_PIN.VERSION", pins.codexProtocol, pins.pinnedCodex);
  const hostPins = [
    { pins: pins.hostClaudePins, against: "CLAUDE_CODE_PIN.SDK_VERSION", pinned: pins.pinnedSdk },
    { pins: pins.hostCodexPins, against: "CODEX_PIN.VERSION", pinned: pins.pinnedCodex },
  ];
  for (const { pins: each, against, pinned } of hostPins) {
    for (const pin of each) {
      differ(`${pin.name}.VERSION against ${against}`, pin.version, pinned);
      // Note that a pin's address is checked to name its release too, since its size and digests are read off that address.
      if (!pin.archive.includes(pin.version)) {
        problems.push(`${pin.name}.ARCHIVE names no ${pin.version}: ${pin.archive}`);
      }
    }
  }
  // Note that an eve version may carry build metadata (`+…`), which no image tag does.
  const eveVersion = pins.installedEve.split("+")[0] ?? "";
  differ(
    "EVE_BASE_IMAGE against the installed eve",
    pins.eveBaseImage,
    `${EVE_BASE_IMAGE_REPOSITORY}:${eveVersion}`,
  );
  return problems;
}

/** A package's manifest as `workspace` resolves it. */
function installedManifest(root: string, workspace: string, name: string): Record<string, unknown> {
  const resolve = createRequire(path.join(root, workspace, "package.json")).resolve;
  // Note that the SDK exports no `package.json`, so its manifest is found beside its entry.
  const entry = resolve(name);
  const manifest = path.join(path.dirname(entry), "package.json");
  return record(JSON.parse(readFileSync(manifest, "utf8")), manifest);
}

/** The host builds a pin of `pins.ts` names, one for a Mac's pin and one per architecture for a Linux host's. */
function hostCliPins(pins: Record<string, unknown>, mac: string, linux: string): HostCliPin[] {
  const read = (name: string, value: unknown): HostCliPin => {
    const pin = record(value, name);
    return {
      name,
      version: text(pin.VERSION, `${name}.VERSION`),
      archive: text(pin.ARCHIVE, `${name}.ARCHIVE`),
    };
  };
  const builds = record(pins[linux], linux);
  return [
    read(mac, pins[mac]),
    ...Object.entries(builds).map(([arch, pin]) => read(`${linux}.${arch}`, pin)),
  ];
}

async function readPins(root: string): Promise<AgentPins> {
  const pins = await loadModule(root, `${RUNNER}/src/pins.ts`);
  const claude = record(pins.CLAUDE_CODE_PIN, "CLAUDE_CODE_PIN");
  const codex = record(pins.CODEX_PIN, "CODEX_PIN");
  const generated = await loadModule(root, `${RUNNER}/src/codex-protocol/generated-from.ts`);
  const template = await loadModule(root, `${SERVICE}/src/agents/native-sandbox-template.ts`);
  const runner = record(readJson(root, `${RUNNER}/package.json`).dependencies, "dependencies");
  const sdk = installedManifest(root, RUNNER, SDK);
  const eveManifest = createRequire(path.join(root, SERVICE, "package.json")).resolve(
    "eve/package.json",
  );
  const eve = record(JSON.parse(readFileSync(eveManifest, "utf8")), eveManifest);
  const dependency = runner[SDK];
  return {
    runnerSdkDependency: typeof dependency === "string" ? dependency : undefined,
    pinnedSdk: text(claude.SDK_VERSION, "CLAUDE_CODE_PIN.SDK_VERSION"),
    pinnedClaude: text(claude.VERSION, "CLAUDE_CODE_PIN.VERSION"),
    installedSdk: text(sdk.version, `${SDK}'s version`),
    installedSdkClaude: text(sdk.claudeCodeVersion, `${SDK}'s claudeCodeVersion`),
    codexProtocol: text(generated.CODEX_PROTOCOL_VERSION, "CODEX_PROTOCOL_VERSION"),
    pinnedCodex: text(codex.VERSION, "CODEX_PIN.VERSION"),
    hostClaudePins: hostCliPins(pins, "CLAUDE_CODE_MAC_PIN", "CLAUDE_CODE_LINUX_PINS"),
    hostCodexPins: hostCliPins(pins, "CODEX_MAC_PIN", "CODEX_LINUX_PINS"),
    eveBaseImage: text(template.EVE_BASE_IMAGE, "EVE_BASE_IMAGE"),
    installedEve: text(eve.version, "eve's version"),
  };
}

export const agentPinsGuard: RepositoryGuard = {
  holds:
    "the agents' pins agree with what is installed: move the pin and what it names in the same change",
  problems: async (root) => pinProblems(await readPins(root)),
};
