import { AGENT_FAILURE, type AgentFailure } from "./agent-wire.js";

/**
 * agent-failure-words.ts -- why an agent's turn failed, in the words the window says it in: one phrase per failure word the service answers.
 *
 * A failed agent's end line says it after "Failed", and an automation's run
 * whose agent failed says it after "Failed", so the two read one table. A failure the window has no words for says nothing more. A
 * failure a new agent mends says so after its words, unless Continue
 * stands beside them or one already continued it (`continuable`), when the
 * advice is redundant or stale.
 *
 * A failure the reader mends in Settings names no path to the page: the
 * line's remedy opens the page itself (`failure-remedy.ts`), by the name
 * the page has now, where a path written into the words would go stale the
 * day the page is renamed.
 */

/** Why a turn failed, by the service's one word for it; nothing for a reason with no words. */
const AGENT_FAILURE_WORDS = {
  [AGENT_FAILURE.MODEL]: "the model call failed",
  [AGENT_FAILURE.SANDBOX]: "the sandbox or checkout failed",
  [AGENT_FAILURE.GITHUB]: "GitHub refused or could not be reached",
  [AGENT_FAILURE.ABANDONED]: "it ran out of time",
  [AGENT_FAILURE.PROVIDER_KEY]: "your API key was refused or cannot be read",
  [AGENT_FAILURE.NOT_STARTED]: "the agent never started",
  [AGENT_FAILURE.FAST_ON_OWN_KEY]:
    "Fast isn't available on your own API key; choose the model with Fast off",
  [AGENT_FAILURE.FAST_NOT_ENABLED]:
    "Fast mode isn't enabled for this Anthropic organization; choose the model with Fast off",
  [AGENT_FAILURE.CONTEXT_OVERFLOW]: "the conversation was too long for the model",
  [AGENT_FAILURE.SESSION_ENDED]: "the agent's session ended and cannot be reached again",
  [AGENT_FAILURE.OTHER]: undefined,
} as const satisfies Record<AgentFailure, string | undefined>;

/** What a failure that only a new agent mends adds after its words. */
const RESTART_ADVICE = "start a new one";

/** The failures only a new agent mends. */
const MENDED_BY_NEW_AGENT: ReadonlySet<AgentFailure> = new Set([
  AGENT_FAILURE.NOT_STARTED,
  AGENT_FAILURE.SESSION_ENDED,
]);

/**
 * Why an agent that ran on its Mac before Luke gave each agent a folder of
 * its own failed there, and where its work still is, said whole in place of
 * a failure's words: on the reader's own Mac where no one is named, else on
 * the named starter's, whose Mac holds it.
 */
export function ranDirectlyWords(folder: string, starter: string | undefined): string {
  const mac = starter === undefined ? "your Mac" : `${starter}'s Mac`;
  const there = starter === undefined ? "" : " there";
  return `This agent ran on ${mac} before Luke gave each agent a folder of its own, so it can't start there again. Its unpushed work is still in ${folder}${there}. Continue in a new agent to carry on.`;
}

/**
 * Why a turn failed, said of the key it ran on: the reader's own where no
 * one is named, else the named holder's, whose Settings the reader has no
 * way to mend, so the words name whose key it was and leave the way out.
 */
export function agentFailureWords(
  failure: AgentFailure,
  holder: string | undefined,
  continuable = false,
): string | undefined {
  if (holder !== undefined && failure === AGENT_FAILURE.PROVIDER_KEY) {
    return `${holder}'s API key was refused or cannot be read`;
  }
  if (holder !== undefined && failure === AGENT_FAILURE.FAST_ON_OWN_KEY) {
    return `Fast isn't available on ${holder}'s own API key; choose the model with Fast off`;
  }
  const words = AGENT_FAILURE_WORDS[failure];
  const advises = !continuable && MENDED_BY_NEW_AGENT.has(failure);
  return words === undefined || !advises ? words : `${words}; ${RESTART_ADVICE}`;
}
