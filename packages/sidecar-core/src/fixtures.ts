import { PROVIDER_ID, type ProviderId } from "./providers.js";
import {
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  type SessionApplicationId,
  type SessionApplicationScope,
  type SessionControl,
  type SessionLocation,
} from "./session.js";
import { SESSION_URGENCY, type SessionUrgency } from "./session-display.js";

/** The workspace a fixture row is one chat of, shaped as the surface draws it. */
export interface WorkspaceSnapshot {
  id: string;
  name: string;
  /** The manager whose mark the tray header carries, when one owns the workspace. */
  scopeId?: string;
  managerName?: string;
}

/** One app association drawn by a synthetic fixture row. */
export interface SessionApplicationSnapshot {
  id: SessionApplicationId;
  name: string;
  scope: SessionApplicationScope;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  /** The observing provider's stable identity, as an adapter reports it. */
  providerId: ProviderId;
  provider: string;
  /** The agent behind the chat, when the provider hosts rather than is it. */
  agentId?: ProviderId;
  agent?: string;
  /** Drawn only: apps where this synthetic local chat also appears. */
  applications?: readonly SessionApplicationSnapshot[];
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
  urgency: SessionUrgency;
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
  /** Drawn only: the pull-request chip a live session's published work earns. */
  hasChange?: boolean;
  /** Drawn only: the number the chip is titled by when the address names one. */
  changeNumber?: number;
  /** Drawn only: the standing ask a live row would be marked as listened for. */
  noticeAsk?: string;
  /** The workspace this row is one chat of, when its provider nests them. */
  workspace?: WorkspaceSnapshot;
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
      title:
        "Bootstrap the desktop shell while keeping every destination visible across a very long Codex conversation title",
      providerId: PROVIDER_ID.CODEX,
      provider: "Codex",
      applications: [
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          name: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
      detail: "exec_command: pnpm --filter @luke/desktop build",
      repository: "luke",
      branch: "dean/desktop-shell",
      model: "gpt-5.6-luna",
      urgency: SESSION_URGENCY.WORKING,
      location: SESSION_LOCATION.LOCAL,
      observedAt: minutesBeforeEpoch(4),
      // A synthetic standing ask, so the one screenshot the evidence is
      // reviewed from also proves the listening mark is drawn.
      noticeAsk: "Tell me when the build finishes.",
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
      urgency: SESSION_URGENCY.ATTENTION,
      location: SESSION_LOCATION.LOCAL,
      observedAt: minutesBeforeEpoch(9),
    },
    // Two Conductor chats of one workspace, titled by their own names and
    // grouped under the workspace's — the name the user knows the work by,
    // which never was a branch. The pair is what proves a run of chats joins
    // into one card in the one screenshot the evidence is reviewed from —
    // each row led by the agent's own mark, with the Conductor mark carried
    // once on the tray header the way a Superset workspace carries its own.
    {
      id: "conductor-chat-package",
      title: "amber-shoal",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: "Conductor",
      agentId: PROVIDER_ID.CLAUDE_CODE,
      agent: "Claude Code",
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
        },
      ],
      detail: "Packaging the macOS build.",
      repository: "luke",
      model: "claude-opus-5",
      urgency: SESSION_URGENCY.WORKING,
      location: SESSION_LOCATION.CLOUD,
      observedAt: minutesBeforeEpoch(6),
      workspace: {
        id: "conductor-lisbon",
        name: "lisbon-v2",
        scopeId: PROVIDER_ID.CONDUCTOR,
        managerName: "Conductor",
      },
    },
    // The complete chat is also the most recently observed session while being
    // among the least urgent, so the fixture tells the two orderings apart
    // rather than agreeing with both. A provider that reported no activity,
    // failure, or recap: the surface words the state itself, and this row is
    // what proves it does. Its agent went unreported, so the Conductor mark
    // stands in for the agent's — the honest fallback this row is also proof
    // of — which keeps the fixture at five distinct wing marks.
    {
      id: "conductor-chat-tidy",
      title: "gentle-cove",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: "Conductor",
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
        },
      ],
      detail: "",
      repository: "luke",
      model: "claude-opus-5",
      urgency: SESSION_URGENCY.COMPLETE,
      location: SESSION_LOCATION.CLOUD,
      observedAt: minutesBeforeEpoch(1),
      workspace: {
        id: "conductor-lisbon",
        name: "lisbon-v2",
        scopeId: PROVIDER_ID.CONDUCTOR,
        managerName: "Conductor",
      },
    },
    {
      id: "cursor-agent",
      title: "Follow a cloud agent",
      providerId: PROVIDER_ID.CURSOR,
      provider: "Cursor",
      detail: "Opened a pull request against sidecar.",
      repository: "sidecar",
      branch: "cursor/follow-agent-a1b2",
      urgency: SESSION_URGENCY.WORKING,
      location: SESSION_LOCATION.CLOUD,
      observedAt: minutesBeforeEpoch(18),
      // What a working Cursor agent advertises live, so the one screenshot the
      // evidence is reviewed from also proves the stop control is drawn — and
      // the pull-request chip beside it, on the row whose sentence names one,
      // titled by a synthetic number the way a live address would title it.
      actions: [{ id: "cancel-run", label: "Stop this run", kind: SESSION_CONTROL_KIND.STOP }],
      hasChange: true,
      changeNumber: 31,
    },
    // A fifth session keeps every state and every provider mark visible in the
    // one screenshot the visual evidence is reviewed from. It is also one more
    // provider than the wings hold — the face has the place nearest the
    // housing — so the same screenshot proves the remainder is counted rather
    // than dropped. Reporting a repository and no branch, it is also the row
    // that shows the identifier line falling back.
    {
      id: "devin-session",
      title: "Watch a cloud session",
      providerId: PROVIDER_ID.DEVIN,
      provider: "Devin",
      detail: "Suspended before it opened a pull request.",
      repository: "sidecar-native",
      urgency: SESSION_URGENCY.UNKNOWN,
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
  return snapshot.sessions.filter((session) => session.urgency === SESSION_URGENCY.ATTENTION)
    .length;
}
