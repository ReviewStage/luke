import { pgTable, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { codingAgent } from "./coding-agent.js";

/**
 * coding-agent-runner-lease.ts -- the lease one call holds on a native agent's runner while it reads whether the runner runs and then writes to it or launches it.
 *
 * A message, a change of model, a Stop, and an open each read the runner's
 * place from its sandbox and then write to its stdin or launch it anew
 * (`coder-host/runner-sessions.ts`). Two calls doing that at once would both
 * relaunch, each minting a bearer that shuts the other's runner out, or
 * write at one stdin offset, the later write clobbering the earlier. So each
 * holds this lease across the read and the write or launch: at most one row
 * per agent, claimed where none stands or the one standing lapsed, and
 * deleted by its holder alone. `held_until` is what lets a lease go whose
 * holder was killed before it let go. The row names an agent, a holder's
 * random id, and an instant alone, and goes with its agent.
 */
export const codingAgentRunnerLease = pgTable("coding_agent_runner_lease", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => codingAgent.id, { onDelete: "cascade" }),
  /** The holder's own id, minted for the one call, so only that call lets the lease go. */
  holder: uuid("holder").notNull(),
  /** The instant the lease lapses, so a holder killed mid-launch holds it no longer. */
  heldUntil: timestamptz("held_until").notNull(),
});
