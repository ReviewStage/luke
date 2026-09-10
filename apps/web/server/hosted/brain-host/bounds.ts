/**
 * The bounds the hosted brain host runs under. Every one is a product knob
 * as much as an implementation detail: how long a run may execute inside the
 * function window Vercel gives the routes, how a lease is kept and when it is
 * taken over, and how long a briefing nobody claimed stands.
 */
export const BRAIN_HOST = {
  /** The function duration `vercel.json` gives the ask, the wait, the cancel, and the wake. */
  MAX_DURATION_SECONDS: 300,
  /** How long one run may execute before its deadline revokes it, inside that window with room to settle. */
  RUN_DEADLINE_MS: 240_000,
  /**
   * How long a lease stands past its last heartbeat. A holder moves it along
   * every `HEARTBEAT_MS`, so a function cut off mid-run leaves a lease the
   * next request or tick can take over inside half a minute.
   */
  LEASE_TTL_MS: 30_000,
  HEARTBEAT_MS: 10_000,
  /** How long a request waits for a held lease before answering that the conversation is busy. */
  LEASE_WAIT_MS: 20_000,
  LEASE_POLL_MS: 500,
  /** How long an offered briefing stands before it expires unspoken; delivery is the next change's. */
  BRIEFING_EXPIRY_MS: 5 * 60_000,
  /** How often a wait on a run reads the record back while it holds. */
  WAIT_POLL_MS: 1_000,
  /** The wake's own budget: users are started only while a whole run deadline still fits inside the function. */
  WAKE_BUDGET_MS: 300_000 - 240_000 - 10_000,
  /** Users the wake opens turns for at once, each a run of its own. */
  WAKE_CONCURRENCY: 4,
  /** The most users one wake lists, longest waiting first, so nobody starves. */
  WAKE_MAX_USERS: 200,
  /** The name the prompt's workspace section gives the row-backed workspace; a label, never a path anything reads. */
  WORKSPACE_NAME: "workspace",
} as const;

/** The environment the routes read; the OpenAI key and model are the names every hosted route already honours. */
export const BRAIN_HOST_ENVIRONMENT = {
  CRON_SECRET: "CRON_SECRET",
} as const;
