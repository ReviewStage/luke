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
}

export interface FixtureSnapshot {
  scenario: "smoke";
  sessions: readonly SessionSnapshot[];
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
    },
    {
      id: "claude-review",
      title: "Review trust constraints",
      providerId: PROVIDER_ID.CLAUDE_CODE,
      provider: "Claude Code",
      detail: "One architecture decision is ready",
      state: SESSION_STATE.ATTENTION,
    },
    {
      id: "conductor-workspace",
      title: "Observe a cloud workspace",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: "Conductor",
      detail: "Cloud session metadata only · no live credentials",
      state: SESSION_STATE.COMPLETE,
    },
    {
      id: "cursor-agent",
      title: "Follow a cloud agent",
      providerId: PROVIDER_ID.CURSOR,
      provider: "Cursor",
      detail: "Cloud session metadata only · no live credentials",
      state: SESSION_STATE.WORKING,
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
