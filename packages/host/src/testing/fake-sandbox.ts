/**
 * fake-sandbox.ts -- a local agent's VM as a suite stands it in for smolvm (`LocalAgentSandbox`): ready as the suite says, every VM made at once, each command in a VM run as the program `VM_EXEC` with the command after it, and what was handed to it written down; and the device's agent CLIs beside it (`LocalAgentClis`), ready as the suite says.
 */

import { Effect, Option } from "effect";
import type { LocalAgentClis, LocalAgentSandbox } from "../effect/seams.js";

/** The program a command in a fake VM is spawned as, the command's own program and arguments after it. */
export const VM_EXEC = "/opt/luke/smolvm-exec";

/** Where the sandbox image keeps the harnesses, which a device registers as its own. */
export const VM_TOOLS = {
  node: "node",
  claude: "/usr/local/bin/claude",
  codex: "/usr/local/bin/codex",
} as const;

/** What a suite reads back: the GitHub tokens handed to the VMs, and the agents whose VMs were signalled in and deleted, in order, beside the sandbox. */
export interface FakeSandbox {
  readonly sandbox: LocalAgentSandbox;
  readonly tokens: string[];
  readonly signalled: string[];
  readonly deleted: string[];
}

/** A sandbox whose VMs always start, once `ready` has, at once and with nothing to fetch where the suite names none. */
export function fakeSandbox(ready: LocalAgentSandbox["ready"] = () => Effect.void): FakeSandbox {
  const tokens: string[] = [];
  const signalled: string[] = [];
  const deleted: string[] = [];
  const sandbox: LocalAgentSandbox = {
    tools: VM_TOOLS,
    ready,
    started: () => Effect.void,
    exec: (command) => ({
      command: VM_EXEC,
      args: [command.command, ...command.args],
      env: command.env,
    }),
    signalled: (agentId) => Effect.sync(() => void signalled.push(agentId)),
    deleted: (agentId) => Effect.sync(() => deleted.push(agentId)).pipe(Effect.as(true)),
    // Note that a fake VM lists nothing, so no suite's follower lets go of an agent unless it says so.
    machines: Effect.succeed(Option.none()),
    githubToken: (_agentId, token) => Effect.sync(() => tokens.push(token)),
    deviceGit: () => ({}),
  };
  return { sandbox, tokens, signalled, deleted };
}

/** The device's agent CLIs, had as `ready` says, at once and with nothing to fetch where the suite names none. */
export function fakeClis(ready: LocalAgentClis["ready"] = () => Effect.void): LocalAgentClis {
  return {
    paths: {
      claude: "/opt/luke/agent-tools/claude",
      codex: "/opt/luke/agent-tools/codex",
      gh: "/opt/luke/agent-tools/gh",
    },
    ready,
  };
}
