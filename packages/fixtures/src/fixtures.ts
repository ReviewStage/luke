import {
  AGENT_IDENTITY,
  type HostedAgentId,
  PROVIDER_ID,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderId,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  type SessionApplicationId,
  type SessionApplicationScope,
  type SessionControl,
  type SessionLocation,
} from "@sidecar/session";
import { SESSION_URGENCY, type SessionUrgency } from "@sidecar/surface";

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
  agentId?: ProviderId | HostedAgentId;
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
  lastActivityAt: number;
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
  /** The workspace this row is one chat of, when its provider nests them. */
  workspace?: WorkspaceSnapshot;
}

export interface FixtureSnapshot {
  scenario: "smoke";
  sessions: readonly SessionSnapshot[];
}

/**
 * What the speaking evidence run captions the reply with. A capture run never
 * opens a call, so there are no words to draw unless the fixture supplies
 * them — and it must, or the caption strip ships unphotographed. Synthetic,
 * like every fixture, and long enough to wrap: a one-line fixture would leave
 * the wrapped form of the strip unphotographed too.
 *
 * It lives here, beside the roster it talks about, because it names that
 * roster's own rows — three chats by title and one workspace by name — and a
 * reply's mentions are what the notice band draws chips for. Reworded apart
 * from the fixture, it would quietly stop naming anything and the band would
 * go unphotographed; the test beside this file is what holds the two
 * together.
 */
export const FIXTURE_SPEAKING_CAPTION =
  "Bootstrap the desktop shell and Review trust constraints are finished, lisbon-v2 is packaging the macOS build, and Follow a cloud agent and Watch a cloud session are waiting on you.";

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

const providerName = (providerId: ProviderId): string =>
  PROVIDER_IDENTITY_BY_ID[providerId].displayName;

/** Smoke rows owned by each provider, including explicit empty coverage. */
export const FIXTURE_SESSION_IDS_BY_PROVIDER = {
  [PROVIDER_ID.CLAUDE_CODE]: ["claude-review"],
  [PROVIDER_ID.CODEX]: ["codex-bootstrap"],
  [PROVIDER_ID.CONDUCTOR]: [
    "conductor-chat-package",
    "conductor-chat-tidy",
    "conductor-cursor-agent",
    "conductor-opencode-session",
  ],
  [PROVIDER_ID.OMP]: [],
} as const satisfies Readonly<Record<ProviderId, readonly string[]>>;

const smokeFixture: FixtureSnapshot = {
  scenario: "smoke",
  sessions: [
    {
      id: "codex-bootstrap",
      title:
        "Bootstrap the desktop shell while keeping every destination visible across a very long Codex conversation title",
      providerId: PROVIDER_ID.CODEX,
      provider: providerName(PROVIDER_ID.CODEX),
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
      lastActivityAt: minutesBeforeEpoch(4),
    },
    {
      id: "claude-review",
      title: "Review trust constraints",
      providerId: PROVIDER_ID.CLAUDE_CODE,
      provider: providerName(PROVIDER_ID.CLAUDE_CODE),
      detail: "Both adapters observe read-only; next, say whether to ship it.",
      repository: "luke",
      branch: "dean/trust-constraints",
      model: "claude-opus-5",
      urgency: SESSION_URGENCY.ATTENTION,
      location: SESSION_LOCATION.LOCAL,
      lastActivityAt: minutesBeforeEpoch(9),
    },
    // Two Conductor chats of one workspace, titled by their own names and
    // grouped under the workspace's — the name the user knows the work by,
    // which never was a branch. The pair is what proves a run of chats joins
    // into one card in the one screenshot the evidence is reviewed from —
    // each row led by the agent's own mark and trailed by the Conductor mark
    // that opens its exact chat, with the tray header carrying the manager's
    // mark once the way a Superset workspace carries its own. Both chats
    // report the workspace's one pull request, so the same screenshot proves
    // the chip is said once on the tray header rather than on each row.
    {
      id: "conductor-chat-package",
      title: "amber-shoal",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: providerName(PROVIDER_ID.CONDUCTOR),
      agentId: PROVIDER_ID.CLAUDE_CODE,
      agent: providerName(PROVIDER_ID.CLAUDE_CODE),
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
      detail: "Packaging the macOS build.",
      repository: "luke",
      model: "claude-opus-5",
      urgency: SESSION_URGENCY.WORKING,
      location: SESSION_LOCATION.CLOUD,
      lastActivityAt: minutesBeforeEpoch(6),
      hasChange: true,
      changeNumber: 245,
      workspace: {
        id: "conductor-lisbon",
        name: "lisbon-v2",
        scopeId: PROVIDER_ID.CONDUCTOR,
        managerName: providerName(PROVIDER_ID.CONDUCTOR),
      },
    },
    // The complete chat is also the most recently observed session while being
    // among the least urgent, so the fixture tells the two orderings apart
    // rather than agreeing with both. A provider that reported no activity,
    // or failure: the surface words the state itself, and this row is
    // what proves it does. Its agent went unreported, so the row's mark falls
    // back to the Conductor mark — the honest fallback this row is also proof
    // of.
    {
      id: "conductor-chat-tidy",
      title: "gentle-cove",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: providerName(PROVIDER_ID.CONDUCTOR),
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
      detail: "",
      repository: "luke",
      model: "claude-opus-5",
      urgency: SESSION_URGENCY.COMPLETE,
      location: SESSION_LOCATION.CLOUD,
      lastActivityAt: minutesBeforeEpoch(1),
      hasChange: true,
      changeNumber: 245,
      workspace: {
        id: "conductor-lisbon",
        name: "lisbon-v2",
        scopeId: PROVIDER_ID.CONDUCTOR,
        managerName: providerName(PROVIDER_ID.CONDUCTOR),
      },
    },
    // A third Conductor workspace whose one chat runs an agent Luke draws
    // only inside a host — Cursor here — so the one screenshot the evidence
    // is reviewed from proves a hosted agent's own mark leads its row while
    // the Conductor mark still trails it.
    {
      id: "conductor-cursor-agent",
      title: "Follow a cloud agent",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: providerName(PROVIDER_ID.CONDUCTOR),
      agentId: AGENT_IDENTITY.CURSOR.id,
      agent: AGENT_IDENTITY.CURSOR.displayName,
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
      detail: "Opened a pull request against sidecar.",
      repository: "sidecar",
      branch: "cursor/follow-agent-a1b2",
      model: "composer-2.5",
      urgency: SESSION_URGENCY.WORKING,
      location: SESSION_LOCATION.CLOUD,
      lastActivityAt: minutesBeforeEpoch(18),
      // What a working Conductor chat advertises live, so the one screenshot
      // the evidence is reviewed from also proves the stop control is drawn —
      // and the pull-request chip beside it, on the row whose sentence names
      // one, titled by a synthetic number the way a live address would title
      // it.
      actions: [{ id: "cancel-run", label: "Stop this run", kind: SESSION_CONTROL_KIND.STOP }],
      hasChange: true,
      changeNumber: 31,
      workspace: {
        id: "conductor-follow",
        name: "follow-agent",
        scopeId: PROVIDER_ID.CONDUCTOR,
        managerName: providerName(PROVIDER_ID.CONDUCTOR),
      },
    },
    // A fifth session keeps every state visible in the one screenshot the
    // visual evidence is reviewed from. Reporting a repository and no branch,
    // it is also the row that shows the identifier line falling back, and its
    // agent is the second hosted kind, so the wing proves two hosted marks
    // apart.
    {
      id: "conductor-opencode-session",
      title: "Watch a cloud session",
      providerId: PROVIDER_ID.CONDUCTOR,
      provider: providerName(PROVIDER_ID.CONDUCTOR),
      agentId: AGENT_IDENTITY.OPENCODE.id,
      agent: AGENT_IDENTITY.OPENCODE.displayName,
      applications: [
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          name: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
      detail: "Suspended before it opened a pull request.",
      repository: "sidecar-native",
      urgency: SESSION_URGENCY.UNKNOWN,
      location: SESSION_LOCATION.CLOUD,
      lastActivityAt: minutesBeforeEpoch(41),
      // A settled Conductor chat takes a message live, so this row is what
      // puts the composer in the evidence.
      canMessage: true,
      workspace: {
        id: "conductor-watch",
        name: "watch-session",
        scopeId: PROVIDER_ID.CONDUCTOR,
        managerName: providerName(PROVIDER_ID.CONDUCTOR),
      },
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
