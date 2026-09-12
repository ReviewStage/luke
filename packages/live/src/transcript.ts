/**
 * The record of what was said on one session, kept from the transcript
 * fragments both speakers' deltas carry. The API gives no turn boundary and
 * no item id, and forbids reading silence into a missing event, so the ledger
 * keeps every fragment exactly as received with its place on the session
 * timeline, and groups them into utterances by the gaps between them: a
 * grouping the guide says to keep revisable, which it is, since a late
 * fragment joins the utterance its timestamps place it in. The groups draw
 * the captions, compose a delegation's ask from the transcript since the
 * previous one, and become the Conversation's lines once they settle.
 */

export const TRANSCRIPT_SPEAKER = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type TranscriptSpeaker = (typeof TRANSCRIPT_SPEAKER)[keyof typeof TRANSCRIPT_SPEAKER];

/** How the ask context labels each speaker's lines for the backend that reads them. */
export const TRANSCRIPT_ROLE_LABEL = {
  [TRANSCRIPT_SPEAKER.USER]: "Developer",
  [TRANSCRIPT_SPEAKER.ASSISTANT]: "Assistant",
} as const satisfies Record<TranscriptSpeaker, string>;

/**
 * The silence between two of one speaker's fragments that starts a new
 * utterance. Ours to tune against recorded conversations, as the guide says;
 * a brief acknowledgment from the other speaker never splits one.
 */
export const UTTERANCE_GAP_MS = 1_200;

/**
 * After the gap that ends an utterance, the margin a late fragment is still
 * waited for before the utterance is written to the record, and before a
 * caption row stops being drawn as still spoken. One constant, so the host's
 * lines and the renderer's captions settle on the same clock.
 */
export const UTTERANCE_SETTLE_MARGIN_MS = 800;

/**
 * The pause in the developer's own fragments after which the words so far are
 * handed to the brain as an anticipation of the ask, so a read the answer
 * will need can begin before the utterance ends. Short of the gap that ends
 * an utterance on purpose: the point is to start while they are still
 * talking, and the next fragment supersedes what was anticipated.
 */
export const PREFETCH_DEBOUNCE_MS = 400;

export interface TranscriptFragment {
  speaker: TranscriptSpeaker;
  /** The delta exactly as received, untrimmed and unpadded. */
  text: string;
  /** Milliseconds on the session timeline; the start is included and the end excluded. */
  startMs: number;
  endMs: number;
}

export interface TranscriptUtterance {
  /** Assigned once when the utterance begins and never moved, so a caption row stays where it was drawn. */
  rowId: number;
  speaker: TranscriptSpeaker;
  /** The fragments' text concatenated exactly as received, in arrival order. */
  text: string;
  startMs: number;
  endMs: number;
}

export interface UtteranceQuery {
  /** Only utterances that end after this instant on the session timeline. */
  sinceMs?: number;
}

export interface AskContext {
  /** Both speakers' utterances since the instant asked for, oldest first. */
  turns: readonly TranscriptUtterance[];
  /** The developer's latest utterance in that span, which is what a delegation asks about. */
  ask: TranscriptUtterance | undefined;
}

/**
 * The developer's ask as far as it has been said, for the brain to read ahead
 * of: the row it is being said on, its words so far, and the span it stands
 * in. Nothing about it is settled; the row id is what a later reading is
 * matched against.
 */
export interface Anticipation {
  rowId: number;
  text: string;
  context: AskContext;
}

/** The anticipation an ask context stands for, or nothing while no developer utterance is in the span. */
export function anticipationOf(context: AskContext): Anticipation | undefined {
  const ask = context.ask;
  if (!ask) return undefined;
  return { rowId: ask.rowId, text: ask.text, context };
}

interface Group {
  rowId: number;
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

export class TranscriptLedger {
  private readonly groups: Group[] = [];
  private nextRowId = 1;
  private latestEndMs: number | undefined;

  /**
   * Records one fragment. It joins the utterance of the same speaker whose
   * span it falls within or touches within the gap, wherever that utterance
   * sits, so a fragment delivered late still lands in the group its timing
   * says it belongs to; otherwise it begins a new utterance with the next
   * row id. A fragment with an end before its start is refused.
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
      rowId: this.nextRowId,
      speaker: fragment.speaker,
      fragments: [],
      startMs: fragment.startMs,
      endMs: fragment.endMs,
    };
    this.nextRowId += 1;
    this.groups.push(group);
    return group;
  }

  /** One speaker's utterances, or both speakers' when none is named, ordered by where they start. */
  utterances(
    speaker?: TranscriptSpeaker,
    query: UtteranceQuery = {},
  ): readonly TranscriptUtterance[] {
    const since = query.sinceMs ?? Number.NEGATIVE_INFINITY;
    return this.groups
      .filter((group) => speaker === undefined || group.speaker === speaker)
      .filter((group) => group.endMs > since)
      .sort((left, right) => left.startMs - right.startMs || left.rowId - right.rowId)
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
