import { LINE_GRACE_MILLIS, STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import { AGENT_MACHINE, type AgentMachineKind } from "@repo/features/agent-wire";
import { GITHUB_TOKEN_REFRESH } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";

export const CODER = {
  SANDBOX_TIMEOUT_MS: 20 * 60 * 1_000,
  SANDBOX_MAX_LIFETIME_MS: 24 * 60 * 60 * 1_000,
  SANDBOX_KEEP_ALIVE_EVERY: Duration.minutes(5),
  SANDBOX_VCPUS: 2,
  SANDBOX_VCPUS_BY_REPOSITORY: new Map([["reviewstage/vespin", 4]]) as ReadonlyMap<string, number>,
  SANDBOX_SNAPSHOTS: { count: 1, expiration: Duration.days(3), deleteEvicted: true },
  GITHUB_TOKEN_REFRESH,
  FALLBACK_CONTEXT_WINDOW_TOKENS: 200_000,
  COMPACTION_THRESHOLD_SHARE: 0.9,
  CLAUDE_CODE_COMPACTION_RESERVE_TOKENS: 20_000 + 13_000,
  CHECKOUT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  BRANCH_PREFIX: "agent/",
  LEGACY_BRANCH_PREFIX: "luke/",
  CI_FIX_ROUNDS: 3,
  MESSAGES_HOLD: Duration.seconds(20),
  MESSAGES_POLL: Duration.millis(500),
  READ_CONCURRENCY: 4,
  ACCOUNT_INBOX_POLL: Duration.seconds(2),
  TITLE_TIMEOUT: Duration.seconds(20),
  TITLE_TURNS: 3,
  PUBLISHED_TTL: Duration.seconds(30),
  PUBLISHED_ROW_FRESH: Duration.seconds(60),
  PUBLISHED_CLOSED_FRESH: Duration.minutes(10),
  STARTING_GRACE: Duration.millis(STARTING_GRACE_MILLIS),
  LINE_GRACE: Duration.millis(LINE_GRACE_MILLIS),
  RUNNER_LEASE: {
    HOLD: Duration.minutes(5),
    WAIT: Duration.minutes(2),
    POLL: Duration.millis(250),
  },
  RUNNER_WARM: {
    [AGENT_MACHINE.VERCEL]: Duration.zero,
    [AGENT_MACHINE.DEVICE]: Duration.minutes(30),
  } satisfies Record<AgentMachineKind, Duration.Duration>,
  RUNNER_EXIT_READ: Duration.seconds(1),
  CREDENTIAL_RENEWAL: Duration.seconds(5),
  RUNNER_HALT: Duration.seconds(15),
  STOP_CONFIRM: Duration.seconds(10),
  RESUME_WHILE_ENDING: { SPACING: Duration.seconds(2), TRIES: 30 },
} as const;

export const CODER_REFUSAL = {
  NO_AGENT: "Not run: this conversation is no agent's.",
  NO_REPOSITORY: "Not run: the agent works in no repository.",
  FAST_ON_OWN_KEY: `Not run: Fast isn't available on your own API key; ${PRODUCT_NAME} runs Fast on its own Anthropic key alone. Choose the model with Fast off.`,
  FAST_NOT_ENABLED:
    "Not run: Fast mode isn't enabled for this Anthropic organization. Choose the model with Fast off.",
  ACCOUNT_KEY_UNREADABLE:
    "Not run: your own API key for the agent's model provider cannot be read. Replace it in Settings.",
  ACCOUNT_KEY_REFUSED:
    "Not run: the provider refused your own API key for the agent's model. Replace it in Settings.",
  ACCOUNT_KEY_NO_QUOTA:
    "Not run: the provider refused the work for your own API key's billing or quota.",
  NOT_REACHABLE:
    "Not run: the agent's repository is not reachable through the GitHub installation connected to its task's workspace.",
  GITHUB_UNAVAILABLE: "Not run: GitHub could not be asked for the repository's credential.",
} as const;

export type CoderRefusal = (typeof CODER_REFUSAL)[keyof typeof CODER_REFUSAL];

export function sandboxVcpus(repository: string | null): number {
  if (repository === null) return CODER.SANDBOX_VCPUS;
  return CODER.SANDBOX_VCPUS_BY_REPOSITORY.get(repository.toLowerCase()) ?? CODER.SANDBOX_VCPUS;
}

export function isAgentBranch(branch: string): boolean {
  return branch.startsWith(CODER.BRANCH_PREFIX) || branch.startsWith(CODER.LEGACY_BRANCH_PREFIX);
}
