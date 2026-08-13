import { PROVIDER_ID, type ProviderId } from "./providers";

export const SESSION_STATE = {
  WORKING: "working",
  ATTENTION: "attention",
  COMPLETE: "complete",
  UNKNOWN: "unknown",
} as const;

export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE];

export interface SessionSnapshot {
  id: string;
  title: string;
  /** The observing provider's stable identity, as an adapter reports it. */
  providerId: ProviderId;
  provider: string;
  detail: string;
  state: SessionState;
  /** When the session was last seen, in the same units a live observation uses. */
  observedAt: number;
}

export interface FixtureSnapshot {
  scenario: "smoke";
  sessions: readonly SessionSnapshot[];
}

/**
 * A fixed instant the fixture's observation times are measured back from. A
 * clock read at load would make the ordering depend on when the fixture was
 * read, and the evidence screenshots are only reproducible while it does not.
 */
const FIXTURE_EPOCH_MS = 1_735_689_600_000;

function minutesBeforeEpoch(minutes: number): number {
  return FIXTURE_EPOCH_MS - minutes * 60_000;
}

const smokeFixture: FixtureSnapshot = {
  scenario: "smoke",
  sessions: [
    {
      id: "codex-bootstrap",
      title: "Bootstrap the desktop shell",
      providerId: PROVIDER_ID.CODEX,
      provider: "Codex",
      detail: "Testing Electron window semantics",
      state: SESSION_STATE.WORKING,
      observedAt: minutesBeforeEpoch(4),
    },
    {
      id: "claude-review",
      title: "Review trust constraints",
      providerId: PROVIDER_ID.CLAUDE_CODE,
      provider: "Claude Code",
      detail: "One architecture decision is ready",
      state: SESSION_STATE.ATTENTION,
      observedAt: minutesBeforeEpoch(9),
    },
    // The most recently observed session is also the least urgent one, so the
    // fixture tells the two orderings apart rather than agreeing with both.
    {
      id: "conductor-workspace",
      title: "Observe a cloud workspace",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: "Conductor",
      detail: "Cloud session metadata only · no live credentials",
      state: SESSION_STATE.COMPLETE,
      observedAt: minutesBeforeEpoch(1),
    },
    {
      id: "cursor-agent",
      title: "Follow a cloud agent",
      providerId: PROVIDER_ID.CURSOR,
      provider: "Cursor",
      detail: "Cloud session metadata only · no live credentials",
      state: SESSION_STATE.WORKING,
      observedAt: minutesBeforeEpoch(18),
    },
    // A fifth session keeps every state and every provider mark visible in the
    // one screenshot the visual evidence is reviewed from.
    {
      id: "claude-observe",
      title: "Watch the notch geometry adapter",
      providerId: PROVIDER_ID.CLAUDE_CODE,
      provider: "Claude Code",
      detail: "Idle since the last display change",
      state: SESSION_STATE.UNKNOWN,
      observedAt: minutesBeforeEpoch(41),
    },
  ],
};

export function fixtureSnapshot(name: string): FixtureSnapshot {
  if (name !== "smoke") {
    throw new Error(`Unknown fixture scenario: ${name}`);
  }
  return smokeFixture;
}

export function attentionCount(snapshot: FixtureSnapshot): number {
  return snapshot.sessions.filter((session) => session.state === SESSION_STATE.ATTENTION).length;
}
