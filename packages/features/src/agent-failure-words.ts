import {
  AGENT_FAILURE,
  AGENT_RUNTIME,
  type AgentFailure,
  type NativeAgentRuntime,
} from "./agent-wire.js";
import { DEVICE_LAUNCH_STEP, type DeviceLaunchStep } from "./device-agent-wire.js";

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

/**
 * The failures only a new agent mends: one that never started or whose
 * session ended takes no message again, and a conversation too long for the
 * model only grows with one, where a continue starts on its summary. Every
 * other failure leaves the agent taking messages, so a message carries it on.
 */
const MENDED_BY_NEW_AGENT: ReadonlySet<AgentFailure> = new Set([
  AGENT_FAILURE.NOT_STARTED,
  AGENT_FAILURE.SESSION_ENDED,
  AGENT_FAILURE.CONTEXT_OVERFLOW,
]);

/**
 * Why an agent whose host stopped beating while its turn ran failed, said
 * whole in place of a failure's words: the host by its name, and that a
 * message carries the agent on once the host is back.
 */
export function hostLostWords(host: string): string {
  return `${host} went offline during this turn. Send a message to carry on once it's back.`;
}

/** What a host's launch was doing as it stopped, by the step it last reported, as "it failed while" goes on. */
const LAUNCH_STOPPED_WORDS = {
  [DEVICE_LAUNCH_STEP.PREPARING]: "preparing the agent's folder",
  [DEVICE_LAUNCH_STEP.FETCHING]: "fetching the repository",
  [DEVICE_LAUNCH_STEP.STARTING]: "starting the agent",
} as const satisfies Record<DeviceLaunchStep, string>;

/** The harness a launch stopped starting, by name. */
const HARNESS_NAMES = {
  [AGENT_RUNTIME.CLAUDE_CODE]: "Claude Code",
  [AGENT_RUNTIME.CODEX]: "Codex",
} as const satisfies Record<NativeAgentRuntime, string>;

/**
 * Why an agent whose host settled its launch unstarted failed, said whole
 * in place of a failure's words: the step the host last reported, the
 * harness by name where it stopped as it started it, and that a message
 * tries again, since its next message launches it anew.
 */
export function launchStoppedWords(
  step: DeviceLaunchStep,
  runtime: NativeAgentRuntime | undefined,
): string {
  const doing =
    step === DEVICE_LAUNCH_STEP.STARTING && runtime !== undefined
      ? `starting ${HARNESS_NAMES[runtime]}`
      : LAUNCH_STOPPED_WORDS[step];
  return `The host couldn't start this agent: it failed while ${doing}. Send a message to try again.`;
}

/** Whether only a new agent goes on past this failure, rather than a message to the agent that failed. */
export function mendedByNewAgent(failure: AgentFailure | undefined): boolean {
  return failure !== undefined && MENDED_BY_NEW_AGENT.has(failure);
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
  const advises = !continuable && mendedByNewAgent(failure);
  return words === undefined || !advises ? words : `${words}; ${RESTART_ADVICE}`;
}
