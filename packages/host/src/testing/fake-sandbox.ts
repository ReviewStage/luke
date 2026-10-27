/**
 * fake-sandbox.ts -- a local agent's VM as a suite stands it in for smolvm (`LocalAgentSandbox`): ready as the suite says, every VM made and woken at once, each command in a VM run as the program `VM_EXEC` with the command after it, and what was handed to it written down.
 */

import { Effect } from "effect";
import type { LocalAgentSandbox, LocalAgentSandboxUnavailable } from "../effect/seams.js";

/** The program a command in a fake VM is spawned as, the command's own program and arguments after it. */
export const VM_EXEC = "/opt/luke/smolvm-exec";

/** Where the sandbox image keeps the harnesses, which a device registers as its own. */
export const VM_TOOLS = {
  node: "node",
  claude: "/usr/local/bin/claude",
  codex: "/usr/local/bin/codex",
} as const;

/** What a suite reads back: the GitHub tokens handed to the VMs and the agents whose VMs were deleted, in order, beside the sandbox. */
export interface FakeSandbox {
  readonly sandbox: LocalAgentSandbox;
  readonly tokens: string[];
  readonly deleted: string[];
}

/** A sandbox whose VMs always start, once `ready` has, at once where the suite names none. */
export function fakeSandbox(
  ready: Effect.Effect<void, LocalAgentSandboxUnavailable> = Effect.void,
): FakeSandbox {
  const tokens: string[] = [];
  const deleted: string[] = [];
  const sandbox: LocalAgentSandbox = {
    tools: VM_TOOLS,
    ready,
    started: () => Effect.void,
    woken: () => Effect.succeed(true),
    exec: (command) => ({
      command: VM_EXEC,
      args: [command.command, ...command.args],
      env: command.env,
    }),
    signalled: () => Effect.void,
    stopped: () => Effect.succeed(true),
    deleted: (agentId) => Effect.sync(() => deleted.push(agentId)),
    githubToken: (_agentId, token) => Effect.sync(() => tokens.push(token)),
    deviceGit: () => ({}),
  };
  return { sandbox, tokens, deleted };
}
