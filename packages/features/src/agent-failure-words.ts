import {
  AGENT_FAILURE,
  AGENT_RUNTIME,
  type AgentFailure,
  type NativeAgentRuntime,
} from "./agent-wire.js";
import {
  DEVICE_LAUNCH_STEP,
  DEVICE_LAUNCH_UNSTARTED,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
} from "./device-agent-wire.js";

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

const RESTART_ADVICE = "start a new one";

const MENDED_BY_NEW_AGENT: ReadonlySet<AgentFailure> = new Set([
  AGENT_FAILURE.NOT_STARTED,
  AGENT_FAILURE.SESSION_ENDED,
  AGENT_FAILURE.CONTEXT_OVERFLOW,
]);

export function hostLostWords(host: string): string {
  return `${host} went offline during this turn. Send a message to carry on once it's back.`;
}

const LAUNCH_STOPPED_WORDS = {
  [DEVICE_LAUNCH_STEP.PREPARING]: "preparing the agent's folder",
  [DEVICE_LAUNCH_STEP.FETCHING]: "fetching the repository",
  [DEVICE_LAUNCH_STEP.STARTING]: "starting the agent",
} as const satisfies Record<DeviceLaunchStep, string>;

const HARNESS_NAMES = {
  [AGENT_RUNTIME.CLAUDE_CODE]: "Claude Code",
  [AGENT_RUNTIME.CODEX]: "Codex",
} as const satisfies Record<NativeAgentRuntime, string>;

const LAUNCH_UNSTARTED_WORDS = {
  [DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN]:
    "The host couldn't start this agent: this Mac's GitHub sign-in can't reach the repository. Sign in with gh auth login, or set up SSH for the repository, then send a message to try again.",
} as const satisfies Record<DeviceLaunchUnstarted, string>;

export function launchStoppedWords(
  step: DeviceLaunchStep,
  runtime: NativeAgentRuntime | undefined,
  unstarted?: DeviceLaunchUnstarted,
): string {
  if (unstarted !== undefined) return LAUNCH_UNSTARTED_WORDS[unstarted];
  const doing =
    step === DEVICE_LAUNCH_STEP.STARTING && runtime !== undefined
      ? `starting ${HARNESS_NAMES[runtime]}`
      : LAUNCH_STOPPED_WORDS[step];
  return `The host couldn't start this agent: it failed while ${doing}. Send a message to try again.`;
}

export function mendedByNewAgent(failure: AgentFailure | undefined): boolean {
  return failure !== undefined && MENDED_BY_NEW_AGENT.has(failure);
}

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
