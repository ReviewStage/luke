export type SessionState = "working" | "attention" | "complete";

export interface SessionSnapshot {
  id: string;
  title: string;
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
      provider: "Codex",
      detail: "Testing Electron window semantics",
      state: "working",
    },
    {
      id: "claude-review",
      title: "Review trust constraints",
      provider: "Claude Code",
      detail: "One architecture decision is ready",
      state: "attention",
    },
    {
      id: "codex-evidence",
      title: "Capture deterministic evidence",
      provider: "Codex",
      detail: "Fixture requires no live sessions",
      state: "complete",
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
  return snapshot.sessions.filter((session) => session.state === "attention").length;
}
