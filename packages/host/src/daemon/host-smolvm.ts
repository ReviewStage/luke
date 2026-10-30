import type { AgentToolPin } from "@luke/agent-runner/pins";
import { HOST_SMOLVM, type HostSmolvmSource } from "./host-os.js";

/**
 * host-smolvm.ts -- the `smolvm` a host's daemon hands its platform, asked nothing: the one its agents ran their VMs in before they ran straight on the box, which deletes the VMs those runs left standing.
 *
 * Every agent of a host runs on the box now, so a box needs no `smolvm` to
 * start, and the daemon checks none. One its service still names, or the
 * pinned release a Mac fetched before, is handed on only so the follower can
 * delete what its agents' VMs left (`LocalAgentSandbox.machines` and
 * `deleted`); a box that names none holds none.
 */

/**
 * The `smolvm` a host's agents ran their VMs in before they ran on the box,
 * which deletes what they left standing, from where its OS says it comes,
 * asked nothing: the path its service names, or the pin a Mac fetched;
 * none where its service names none.
 */
export const hostSmolvmLeft = (
  source: HostSmolvmSource,
  environment: Readonly<Record<string, string | undefined>>,
): string | AgentToolPin | undefined => {
  if (source.kind === HOST_SMOLVM.PIN) return source.pin;
  const smolvm = environment[source.variable] ?? "";
  return smolvm.length === 0 ? undefined : smolvm;
};
