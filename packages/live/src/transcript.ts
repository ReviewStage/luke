/**
 * The record of what was said on one session, kept from the transcript
 * fragments both speakers' deltas carry. The API gives no turn boundary and
 * no item id, and forbids reading silence into a missing event, so the ledger
 * keeps every fragment exactly as received with its place on the session
 * timeline, and groups them into utterances by the gaps between them: a
 * grouping the guide says to keep revisable, which it is, since a late
 * fragment joins the utterance its timestamps place it in. The groups draw
 * the captions, compose a delegation's ask from the transcript since the
 * previous one, and are the Conversation's lines: each opens under an opaque
 * id the ledger mints, which is the row's for life, so a row on record grows
 * as fragments arrive rather than being cut once. The ledger is the one
 * authority on where an utterance begins and ends; nothing derives an id
 * from text, time, or a fragment's position.
 */

export const TRANSCRIPT_SPEAKER = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type TranscriptSpeaker = (typeof TRANSCRIPT_SPEAKER)[keyof typeof TRANSCRIPT_SPEAKER];

/** How the ask context labels each speaker's lines for the backend that reads them. */
const TRANSCRIPT_ROLE_LABEL = {
  [TRANSCRIPT_SPEAKER.USER]: "Developer",
  [TRANSCRIPT_SPEAKER.ASSISTANT]: "Assistant",
} as const satisfies Record<TranscriptSpeaker, string>;

/**
 * The silence between two of one speaker's fragments that starts a new
 * utterance, one constant for both speakers; a brief acknowledgment from the
 * other speaker never splits one. Ours to tune against recorded conversations,
 * as the guide says, and tuned on 121 sessions: 91% of the developer's
 * inter-fragment gaps are under 0.8 s, 5.6% are over 5 s, and only 51 of 2,865
 * fall between 1.2 s and 5 s, while Luke's between-sentence pauses cluster at
 * 3 to 5 s and above. 4.0 s sits in the trough between the two. 5.0 s was
 * rejected because 48 of Luke's gaps fall in 4 to 5 s, some of them the pause
 * between his acknowledgment and reading a fast brain reply, which are two
 * sentences and not one.
 */
export const UTTERANCE_GAP_MS = 4_000;

interface TranscriptFragment {
  speaker: TranscriptSpeaker;
  /** The delta exactly as received, untrimmed and unpadded. */
  text: string;
  /** Milliseconds on the session timeline; the start is included and the end excluded. */
  startMs: number;
  endMs: number;
}

export interface TranscriptUtterance {
  /** Minted once when the utterance begins and never moved: the row's id on record and on screen alike. */
  rowId: string;
  speaker: TranscriptSpeaker;
  /** The fragments' text concatenated exactly as received, in arrival order. */
  text: string;
  startMs: number;
  endMs: number;
}

interface UtteranceQuery {
  /** Only utterances that end after this instant on the session timeline. */
  sinceMs?: number;
}

interface AskContext {
  /** Both speakers' utterances since the instant asked for, oldest first. */
  turns: readonly TranscriptUtterance[];
  /** The developer's latest utterance in that span, which is what a delegation asks about. */
  ask: TranscriptUtterance | undefined;
}

interface Group {
  rowId: string;
  speaker: TranscriptSpeaker;
  fragments: TranscriptFragment[];
  startMs: number;
  endMs: number;
}

function utteranceOf(group: Group): TranscriptUtterance {
  return {
    rowId: group.rowId,
    speaker: group.speaker,
    text: group.fragments.map((fragment) => fragment.text).join(""),
    startMs: group.startMs,
    endMs: group.endMs,
  };
}

/** How a ledger is built: with the one factory every row id it mints comes from. */
export interface TranscriptLedgerOptions {
  /** Mints an opaque id for a row as its utterance opens; the caller's own UUID source. */
  mintRowId: () => string;
}

export class TranscriptLedger {
  private readonly groups: Group[] = [];
  private readonly mintRowId: () => string;
  private latestEndMs: number | undefined;

  constructor(options: TranscriptLedgerOptions) {
    this.mintRowId = options.mintRowId;
  }

  /**
   * Records one fragment. It joins the utterance of the same speaker whose
   * span it falls within or touches within the gap, wherever that utterance
   * sits, so a fragment delivered late still lands in the group its timing
   * says it belongs to; otherwise it begins a new utterance under a freshly
   * minted row id. A fragment with an end before its start is refused.
   */
  append(fragment: TranscriptFragment): TranscriptUtterance | undefined {
    if (
      !Number.isFinite(fragment.startMs) ||
      !Number.isFinite(fragment.endMs) ||
      fragment.endMs < fragment.startMs
    ) {
      return undefined;
    }
    const group = this.groupFor(fragment) ?? this.openGroup(fragment);
    group.fragments.push(fragment);
    group.startMs = Math.min(group.startMs, fragment.startMs);
    group.endMs = Math.max(group.endMs, fragment.endMs);
    this.latestEndMs =
      this.latestEndMs === undefined ? fragment.endMs : Math.max(this.latestEndMs, fragment.endMs);
    return utteranceOf(group);
  }

  private groupFor(fragment: TranscriptFragment): Group | undefined {
    let nearest: Group | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const group of this.groups) {
      if (group.speaker !== fragment.speaker) continue;
      const distance =
        fragment.startMs > group.endMs
          ? fragment.startMs - group.endMs
          : fragment.endMs < group.startMs
            ? group.startMs - fragment.endMs
            : 0;
      if (distance <= UTTERANCE_GAP_MS && distance < nearestDistance) {
        nearest = group;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private openGroup(fragment: TranscriptFragment): Group {
    const group: Group = {
      rowId: this.mintRowId(),
      speaker: fragment.speaker,
      fragments: [],
      startMs: fragment.startMs,
      endMs: fragment.endMs,
    };
    this.groups.push(group);
    return group;
  }

  /** One utterance by its row, as the ledger holds it now, or nothing for a row it never opened. */
  row(rowId: string): TranscriptUtterance | undefined {
    const group = this.groups.find((candidate) => candidate.rowId === rowId);
    return group === undefined ? undefined : utteranceOf(group);
  }

  /** One speaker's utterances, or both speakers' when none is named, ordered by where they start; two starting together keep the order they opened in, since the sort is stable. */
  utterances(
    speaker?: TranscriptSpeaker,
    query: UtteranceQuery = {},
  ): readonly TranscriptUtterance[] {
    const since = query.sinceMs ?? Number.NEGATIVE_INFINITY;
    return this.groups
      .filter((group) => speaker === undefined || group.speaker === speaker)
      .filter((group) => group.endMs > since)
      .sort((left, right) => left.startMs - right.startMs)
      .map(utteranceOf);
  }

  /** The latest instant any fragment reached on the session timeline, or nothing before the first. */
  lastActivityMs(): number | undefined {
    return this.latestEndMs;
  }

  /**
   * Every utterance as a caption row, in the order the rows were opened, so a
   * row that gains a late fragment grows in place rather than moving.
   */
  captionLines(): readonly TranscriptUtterance[] {
    return this.groups.map(utteranceOf);
  }

  /**
   * What a delegation is about: both speakers' utterances since the previous
   * delegation's offset, with the developer's latest among them as the ask.
   * A span with no developer utterance yet has no ask, and the delegation is
   * retained until a fragment lands rather than answered with nothing heard.
   */
  askContext(sinceMs: number): AskContext {
    const turns = this.utterances(undefined, { sinceMs });
    let ask: TranscriptUtterance | undefined;
    for (const turn of turns) {
      if (turn.speaker === TRANSCRIPT_SPEAKER.USER) ask = turn;
    }
    return { turns, ask };
  }
}

/** The turns as the backend reads them: one role-labelled line per utterance, oldest first. */
export function renderAskContext(context: AskContext): string {
  return context.turns
    .map((turn) => `${TRANSCRIPT_ROLE_LABEL[turn.speaker]}: ${turn.text.trim()}`)
    .join("\n");
}
