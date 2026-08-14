import { PROVIDER_ID, type ProviderId } from "./providers";
import {
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  type SessionControl,
  type SessionLocation,
} from "./session";

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
  /** What the session is doing, or what stopped it; empty when it said nothing. */
  detail: string;
  /**
   * Which checkout the work is in, as separate fields rather than a composed
   * line: the surface words them, and it needs to know which kind of identifier
   * it is drawing.
   */
  repository?: string;
  branch?: string;
  /** Named on the provider mark's hover rather than spent on a line of its own. */
  model?: string;
  state: SessionState;
  location: SessionLocation;
  /** When the session was last seen, in the same units a live observation uses. */
  observedAt: number;
  /**
   * Drawn only: a fixture row can show the composer a live session would have,
   * but a fixture run refuses every write — its registry is empty, so nothing
   * a capture could press reaches a provider.
   */
  canMessage?: boolean;
  /** Drawn only, like the composer: the controls a live session would show. */
  actions?: readonly SessionControl[];
}

export interface FixtureSnapshot {
  scenario: "smoke";
  sessions: readonly SessionSnapshot[];
}

/**
 * A fixed instant the fixture's observation times are measured back from. A
 * clock read at load would make the ordering depend on when the fixture was
 * read, and the evidence screenshots are only reproducible while it does not.
 * Exported because the surface draws how long ago each session was seen, and a
 * fixture row's age has to be read against this instant rather than the wall
 * clock — measured against the real clock, the labels would grow with every
 * capture run and the PNGs would stop being reproducible.
 */
export const FIXTURE_EPOCH_MS = 1_735_689_600_000;

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
      detail: "exec_command: pnpm --filter @luke/desktop build",
      repository: "luke",
      branch: "dean/desktop-shell",
      model: "gpt-5.6-luna",
      state: SESSION_STATE.WORKING,
      location: SESSION_LOCATION.LOCAL,
      observedAt: minutesBeforeEpoch(4),
    },
    {
      id: "claude-review",
      title: "Review trust constraints",
      providerId: PROVIDER_ID.CLAUDE_CODE,
      provider: "Claude Code",
      detail: "Both adapters observe read-only; next, say whether to ship it.",
      repository: "luke",
      branch: "dean/trust-constraints",
      model: "claude-opus-5",
      state: SESSION_STATE.ATTENTION,
      location: SESSION_LOCATION.LOCAL,
      observedAt: minutesBeforeEpoch(9),
    },
    // The most recently observed session is also the least urgent one, so the
    // fixture tells the two orderings apart rather than agreeing with both.
    {
      id: "conductor-workspace",
      // Conductor sessions are titled by the workspace's own name — the name
      // the user knows the work by — and carry no branch, because the
      // workspace name never was one.
      title: "lisbon-v2",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: "Conductor",
      // A provider that reported no activity, failure, or recap: the surface
      // words the state itself, and this row is what proves it does.
      detail: "",
      repository: "luke",
      model: "claude-opus-5",
      state: SESSION_STATE.COMPLETE,
      location: SESSION_LOCATION.CLOUD,
      observedAt: minutesBeforeEpoch(1),
    },
    {
      id: "cursor-agent",
      title: "Follow a cloud agent",
      providerId: PROVIDER_ID.CURSOR,
      provider: "Cursor",
      detail: "Opened a pull request against sidecar.",
      repository: "sidecar",
      branch: "cursor/follow-agent-a1b2",
      state: SESSION_STATE.WORKING,
      location: SESSION_LOCATION.CLOUD,
      observedAt: minutesBeforeEpoch(18),
      // What a working Cursor agent advertises live, so the one screenshot the
      // evidence is reviewed from also proves the stop control is drawn.
      actions: [{ id: "cancel-run", label: "Stop this run", kind: SESSION_CONTROL_KIND.STOP }],
    },
    // A fifth session keeps every state and every provider mark visible in the
    // one screenshot the visual evidence is reviewed from. It is also one more
    // provider than the wings hold now that the face has the place nearest the
    // housing, so the same screenshot proves the remainder is counted rather
    // than dropped. Reporting a repository and no branch, it is also the row
    // that shows the identifier line falling back.
    {
      id: "devin-session",
      title: "Watch a cloud session",
      providerId: PROVIDER_ID.DEVIN,
      provider: "Devin",
      detail: "Suspended before it opened a pull request.",
      repository: "sidecar-native",
      state: SESSION_STATE.UNKNOWN,
      location: SESSION_LOCATION.CLOUD,
      observedAt: minutesBeforeEpoch(41),
      // A suspended Devin session takes a message live — sending is what
      // resumes one — so this row is what puts the composer in the evidence.
      canMessage: true,
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
