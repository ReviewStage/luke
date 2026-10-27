import { GH_LINUX_PINS } from "@luke/agent-runner/pins";
import type { DeviceArch } from "@luke/features/device-agent-wire";
import { localAgentTool } from "../local-agent-tools.js";

/**
 * host-tools.ts -- the `gh` a host's agents use, fetched once at its pin (`GH_LINUX_PINS`) and checked before it is kept, beside the Claude Code and Codex the follower fetches.
 *
 * The daemon asks for it as it starts, so a box whose release predates a pin
 * bump fetches the new build on its next start, and every agent's `gh` and
 * git's credential helper are that one binary; none where it cannot be had,
 * which the daemon reports and asks again on its next start.
 */

/** The `gh` for the architecture given, under the daemon's state; none where it cannot be had. */
export const hostGh = (stateRoot: string, arch: DeviceArch) =>
  localAgentTool(stateRoot, GH_LINUX_PINS[arch], undefined);
