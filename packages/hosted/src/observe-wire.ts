import { normalizeSessionDetail, SESSION_CONTROL_KIND } from "@sidecar/session";
import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { writtenText } from "./service-wire.js";

/**
 * What the observe endpoint answers: one bounded row per cloud session. A
 * malformed row is skipped rather than failing the roster, and a field a row
 * could do without is dropped rather than failing the row, because a phone
 * that can draw four sessions of five is better off than one that draws none.
 */

/**
 * One control a session's provider advertised for it, as the observe endpoint
 * reports it: the id an act names, and the label and kind the row draws. What
 * the control targets never travels — the act endpoint re-observes and builds
 * the write from its own fresh advertisement, so the wire copy can gate a
 * button but can never redirect a write.
 */
export interface ObservedSessionControl {
  id: string;
  label: string;
  /** One of the SESSION_CONTROL_KIND string values, when the provider named one. */
  kind?: string;
}

/**
 * One cloud session as reported by the observe endpoint. The fields are a
 * bounded subset of `ProviderSessionObservation`: what mobile can show in a
 * roster row, and which acts that row may offer. The service maps the
 * adapter's observation onto this shape and stores nothing — a new request is
 * a new observation pass, and every act endpoint re-observes for itself
 * rather than trusting these advertisements.
 */
export interface ObservedSession {
  /** The vault provider id for this session (conductor today). */
  providerId: string;
  /** The provider's own id for this session. */
  sessionId: string;
  /** Bounded session title. */
  title: string;
  /** One of the SESSION_STATUS string values. */
  status: string;
  /** Repository label or workspace name, when the provider reported one. */
  workspace?: string;
  /** Current branch, when the provider reported one. */
  branch?: string;
  /** HTTPS address of the work the session published, when it reported one. */
  change?: string;
  /**
   * Provider-owned address that opens this session where it lives, when the
   * provider reported one. Bounded to the openable session-link schemes —
   * this is the one observed field a surface acts on rather than draws, so
   * an address outside the set never crosses the wire at all.
   */
  link?: string;
  /** Error description, when the session stopped on something it cannot pass. */
  error?: string;
  /** Unix milliseconds of the provider's last write about the session, when it reported one. */
  lastActivityAt?: number;
  /**
   * The name `lastActivityAt` traveled under before it was renamed. The
   * service still writes it beside the new name, and a reader still accepts
   * it, so an installed iOS build keeps its age chip and recency sort until
   * it updates; it may go once the first iOS release that reads
   * `lastActivityAt` has shipped. Nothing else reads or writes it.
   */
  observedAt?: number;
  /** Whether the session's latest observation advertised taking a message. */
  canReceiveMessage?: boolean;
  /** The controls the session's latest observation advertised, if any. */
  controls?: ObservedSessionControl[];
  /** Agent kinds the latest observation listed as spawnable in this session's workspace. */
  spawnableAgents?: string[];
  /** Whether the latest observation advertised renaming the session itself. */
  canRename?: boolean;
  /** Whether the latest observation advertised renaming the session's workspace. */
  canRenameWorkspace?: boolean;
  /**
   * Whether the messages endpoint can read this session's conversation — a
   * capability of the provider's documented transcript read, not a per-turn
   * state, so a screen that sees it absent has no conversation to draw and
   * says so.
   */
  canReadConversation?: boolean;
}

/** The observe endpoint answer: the caller's cloud sessions across all providers. */
export interface ObserveAnswer {
  sessions: ObservedSession[];
}

/**
 * The statuses a roster row may carry. Named here rather than imported from
 * `@sidecar/session`'s own set: what a client outside this build may be shown
 * is a wire decision, and widening it is one too.
 */
const OBSERVED_SESSION_STATUS_NAMES = ["working", "waiting", "error", "complete", "unknown"];

const observedSessionControlSchema: Schema<ObservedSessionControl> = s.record(
  {
    id: s.text(),
    label: s.text(),
    kind: s.dropRefused(s.enumOf(Object.values(SESSION_CONTROL_KIND), { ends: TEXT_ENDS.TRIM })),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/**
 * The two details a surface acts on rather than draws. Each goes through the
 * same normalizer the desktop's own rows go through, which is what decides
 * whether the address may be opened at all; one it turns down is dropped like
 * any other unreadable field.
 */
const changeSchema = s.dropRefused(
  s.map(s.text(), (value) => normalizeSessionDetail({ change: value }).change),
);

const linkSchema = s.dropRefused(
  s.map(s.text(), (value) => normalizeSessionDetail({ link: value }).link),
);

const observedSessionSchema: Schema<ObservedSession> = s.map(
  s.record(
    {
      providerId: s.text(),
      sessionId: s.text(),
      title: s.text(),
      status: s.enumOf(OBSERVED_SESSION_STATUS_NAMES, { ends: TEXT_ENDS.TRIM }),
      workspace: s.dropRefused(s.text()),
      branch: s.dropRefused(s.text()),
      change: changeSchema,
      link: linkSchema,
      error: s.dropRefused(s.text()),
      lastActivityAt: s.dropRefused(s.number()),
      observedAt: s.dropRefused(s.number()),
      canReceiveMessage: s.dropRefused(s.literal(true)),
      controls: s.dropRefused(
        s.array(observedSessionControlSchema, { skipRefused: true, minimum: 1 }),
      ),
      spawnableAgents: s.dropRefused(s.array(writtenText(), { skipRefused: true, minimum: 1 })),
      canRename: s.dropRefused(s.literal(true)),
      canRenameWorkspace: s.dropRefused(s.literal(true)),
      canReadConversation: s.dropRefused(s.literal(true)),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  // The old name is folded into the new one here and travels no further, so
  // nothing downstream of this read has two names for one instant.
  ({ observedAt, ...session }) => {
    const lastActivityAt = session.lastActivityAt ?? observedAt;
    return lastActivityAt === undefined ? session : { ...session, lastActivityAt };
  },
);

/** A malformed session entry is skipped, not fatal. */
export const observeAnswerSchema: Schema<ObserveAnswer> = s.record(
  { sessions: s.array(observedSessionSchema, { skipRefused: true }) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
