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
  providerId: string;
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
      providerId: "codex",
      provider: "Codex",
      detail: "Testing Electron window semantics",
      state: SESSION_STATE.WORKING,
    },
    {
      id: "claude-review",
      title: "Review trust constraints",
      providerId: "claude-code",
      provider: "Claude Code",
      detail: "One architecture decision is ready",
      state: SESSION_STATE.ATTENTION,
    },
    {
      id: "conductor-workspace",
      title: "Observe a cloud workspace",
      providerId: "conductor",
      provider: "Conductor",
      detail: "Cloud session metadata only · no live credentials",
      state: SESSION_STATE.COMPLETE,
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
