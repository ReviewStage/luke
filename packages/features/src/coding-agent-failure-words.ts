import { CODING_AGENT_FAILURE, type CodingAgentFailure } from "./coding-agent-wire.js";

/**
 * coding-agent-failure-words.ts -- why an agent's turn failed, in the words the window says it in: one phrase per failure word the service answers.
 *
 * A failed agent's end line says it after "Failed", and an automation's run
 * whose agent failed says it after "Its agent failed", so the two read one
 * table. A failure the window has no words for says nothing more. A
 * failure a new agent mends says so after its words, unless one already
 * continued it, when the advice is stale.
 */

/** Why a turn failed, by the service's one word for it; nothing for a reason with no words. */
const AGENT_FAILURE_WORDS = {
  [CODING_AGENT_FAILURE.MODEL]: "the model call failed",
  [CODING_AGENT_FAILURE.SANDBOX]: "the sandbox or checkout failed",
  [CODING_AGENT_FAILURE.GITHUB]: "GitHub refused or could not be reached",
  [CODING_AGENT_FAILURE.ABANDONED]: "the turn ran past its bound and was ended",
  [CODING_AGENT_FAILURE.PROVIDER_KEY]:
    "your API key was refused or can't be read; check Settings › Coding agents › API keys",
  [CODING_AGENT_FAILURE.NOT_STARTED]: "the agent never started",
  [CODING_AGENT_FAILURE.FAST_ON_OWN_KEY]:
    "Fast isn't available on your own API key; choose the model with Fast off",
  [CODING_AGENT_FAILURE.FAST_NOT_ENABLED]:
    "Fast mode isn't enabled for this Anthropic organization; choose the model with Fast off",
  [CODING_AGENT_FAILURE.CONTEXT_OVERFLOW]: "the conversation was too long for the model",
  [CODING_AGENT_FAILURE.OTHER]: undefined,
} as const satisfies Record<CodingAgentFailure, string | undefined>;

/** What a failure that only a new agent mends adds after its words. */
const RESTART_ADVICE = "start a new one";

/** The failures only a new agent mends. */
const MENDED_BY_NEW_AGENT: ReadonlySet<CodingAgentFailure> = new Set([
  CODING_AGENT_FAILURE.NOT_STARTED,
]);

/**
 * Why a turn failed, said of the key it ran on: the reader's own where no
 * one is named, else the named holder's, whose Settings the reader has no
 * way to mend, so the words name whose key it was and leave the way out.
 */
export function agentFailureWords(
  failure: CodingAgentFailure,
  holder: string | undefined,
  continued = false,
): string | undefined {
  if (holder !== undefined && failure === CODING_AGENT_FAILURE.PROVIDER_KEY) {
    return `${holder}'s API key was refused or can't be read`;
  }
  if (holder !== undefined && failure === CODING_AGENT_FAILURE.FAST_ON_OWN_KEY) {
    return `Fast isn't available on ${holder}'s own API key; choose the model with Fast off`;
  }
  const words = AGENT_FAILURE_WORDS[failure];
  const advises = !continued && MENDED_BY_NEW_AGENT.has(failure);
  return words === undefined || !advises ? words : `${words}; ${RESTART_ADVICE}`;
}
