import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { loadModule, type RepositoryGuard, readJson, record, text } from "./guard.ts";

const SDK = "@anthropic-ai/claude-agent-sdk";
const RUNNER = "packages/agent-runner";
const DOCKERFILE = "apps/web/agent-image/Dockerfile";

const IMAGE_ARGS = {
  CLAUDE_AGENT_SDK_VERSION: "CLAUDE_CODE_PIN.SDK_VERSION",
  CLAUDE_CODE_VERSION: "CLAUDE_CODE_PIN.VERSION",
  CODEX_VERSION: "CODEX_PIN.VERSION",
  PLAYWRIGHT_VERSION: "PLAYWRIGHT_PIN.VERSION",
} as const;

export interface HostCliPin {
  readonly name: string;
  readonly version: string;
  readonly archive: string;
}

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
  readonly pinnedPlaywright: string;
  readonly imageArgs: Readonly<Record<string, string>>;
}

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
      if (!pin.archive.includes(pin.version)) {
        problems.push(`${pin.name}.ARCHIVE names no ${pin.version}: ${pin.archive}`);
      }
    }
  }
  const pinned: Record<keyof typeof IMAGE_ARGS, string> = {
    CLAUDE_AGENT_SDK_VERSION: pins.pinnedSdk,
    CLAUDE_CODE_VERSION: pins.pinnedClaude,
    CODEX_VERSION: pins.pinnedCodex,
    PLAYWRIGHT_VERSION: pins.pinnedPlaywright,
  };
  for (const [arg, pin] of Object.entries(IMAGE_ARGS) as [keyof typeof IMAGE_ARGS, string][]) {
    differ(`${DOCKERFILE}'s ${arg} against ${pin}`, pins.imageArgs[arg], pinned[arg]);
  }
  return problems;
}

function dockerfileArgs(root: string): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [, name = "", value = ""] of readFileSync(
    path.join(root, DOCKERFILE),
    "utf8",
  ).matchAll(/^ARG ([A-Z_]+)=(\S+)$/gmu)) {
    args[name] = value;
  }
  return args;
}

function installedManifest(root: string, workspace: string, name: string): Record<string, unknown> {
  const resolve = createRequire(path.join(root, workspace, "package.json")).resolve;
  const entry = resolve(name);
  const manifest = path.join(path.dirname(entry), "package.json");
  return record(JSON.parse(readFileSync(manifest, "utf8")), manifest);
}

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
  const playwright = record(pins.PLAYWRIGHT_PIN, "PLAYWRIGHT_PIN");
  const generated = await loadModule(root, `${RUNNER}/src/codex-protocol/generated-from.ts`);
  const runner = record(readJson(root, `${RUNNER}/package.json`).dependencies, "dependencies");
  const sdk = installedManifest(root, RUNNER, SDK);
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
    pinnedPlaywright: text(playwright.VERSION, "PLAYWRIGHT_PIN.VERSION"),
    imageArgs: dockerfileArgs(root),
  };
}

export const agentPinsGuard: RepositoryGuard = {
  holds:
    "the agents' pins agree with what is installed: move the pin and what it names in the same change",
  problems: async (root) => pinProblems(await readPins(root)),
};
