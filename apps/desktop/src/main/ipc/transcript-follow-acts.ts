/**
 * transcript-follow-acts.ts -- an agent's, a worker's, or a planning worker's transcript followed for the panels that draw it, and each page pushed to those panels alone.
 *
 * A panel says which transcripts its shown tabs draw, one follow each, and
 * lets each go when the tab stops showing; the host follows each transcript
 * while any panel does (over Neon Realtime) and tells main every page, which
 * is sent on to the panels following it and to no other window. Every
 * follow asks the host to follow from the start again, so a panel coming to
 * a transcript another already draws hears it whole, and the others hear
 * pages they hold again, which join by id where they stand. A panel may
 * follow the same transcript from several tabs, so its follows are counted,
 * and the transcript is let go at the host once no panel holds one. A panel
 * whose page is gone lets go of everything it followed.
 *
 * Nothing of a transcript's words is kept here: only which panels follow it.
 */

import {
  type CodingAgentTranscriptChanged,
  type CodingAgentTranscriptKey,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import { ActRefused, type ActRows, type ActSender } from "@luke/host/act-router";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import { Effect } from "effect";
import type { WebContents } from "electron";

type TranscriptFollowActKind =
  | typeof ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW
  | typeof ACT_KIND.CODING_AGENTS_TRANSCRIPT_UNFOLLOW;

type TranscriptKind = CodingAgentTranscriptKey["kind"];

export interface TranscriptFollowActsDependencies {
  host: Pick<HostOperator, "transcriptFollow" | "transcriptUnfollow" | "onTranscriptChanged">;
  /** Sends one panel a followed transcript's next page. */
  deliver: (sender: WebContents, changed: CodingAgentTranscriptChanged) => void;
  /** Calls `then` once, when the panel's page is gone. */
  whenGone: (sender: WebContents, then: () => void) => void;
  /** Runs what a page's end asks of the host, from the page's own callback. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** One followed transcript: which it is, and how many follows each panel holds of it. */
interface Followed {
  readonly transcript: CodingAgentTranscriptKey;
  readonly panels: Map<WebContents, number>;
}

/** Every followed transcript, by its kind, then its agent's or task's id, then its call where it has one. */
type FollowedTable = Map<TranscriptKind, Map<string, Map<string | undefined, Followed>>>;

/** The agent's or the task's id a transcript is under. */
function ownerOf(transcript: CodingAgentTranscriptKey): string {
  return transcript.kind === TRANSCRIPT_KIND.AGENT ? transcript.agentId : transcript.taskId;
}

/** The calls of one owner's followed transcripts, where any is followed. */
function callsOf(
  table: FollowedTable,
  transcript: CodingAgentTranscriptKey,
): Map<string | undefined, Followed> | undefined {
  return table.get(transcript.kind)?.get(ownerOf(transcript));
}

/** The calls of one owner's followed transcripts, made where none is followed yet. */
function callsMade(
  table: FollowedTable,
  transcript: CodingAgentTranscriptKey,
): Map<string | undefined, Followed> {
  const byOwner =
    table.get(transcript.kind) ?? new Map<string, Map<string | undefined, Followed>>();
  table.set(transcript.kind, byOwner);
  const calls = byOwner.get(ownerOf(transcript)) ?? new Map<string | undefined, Followed>();
  byOwner.set(ownerOf(transcript), calls);
  return calls;
}

/** The refusal a window that draws no transcript hears, in its kind's own words. */
function refuseUnlessPanel(kind: TranscriptFollowActKind, sender: ActSender<WebContents>): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function transcriptFollowActRows(
  dependencies: TranscriptFollowActsDependencies,
): Pick<ActRows<WebContents>, TranscriptFollowActKind> {
  const { host, deliver, whenGone, run } = dependencies;
  const followed: FollowedTable = new Map();
  /** The panels whose page's end is watched, so it is watched once. */
  const watched = new Set<WebContents>();

  host.onTranscriptChanged((changed) => {
    const held = callsOf(followed, changed.transcript)?.get(changed.transcript.callId);
    if (held === undefined) return;
    for (const panel of held.panels.keys()) deliver(panel, changed);
  });

  /** One follow of the panel's let go, or all of them, and the transcript let go at the host once no panel holds one. */
  const release = (transcript: CodingAgentTranscriptKey, panel: WebContents, all: boolean) =>
    Effect.suspend(() => {
      const calls = callsOf(followed, transcript);
      const held = calls?.get(transcript.callId);
      const count = held?.panels.get(panel);
      if (calls === undefined || held === undefined || count === undefined) return Effect.void;
      if (all || count === 1) held.panels.delete(panel);
      else held.panels.set(panel, count - 1);
      if (held.panels.size > 0) return Effect.void;
      calls.delete(transcript.callId);
      return host.transcriptUnfollow(held.transcript);
    });

  /** Everything the panel followed let go, as its page is gone. */
  const gone = (panel: WebContents) => {
    watched.delete(panel);
    const transcripts = [...followed.values()]
      .flatMap((byOwner) => [...byOwner.values()])
      .flatMap((calls) => [...calls.values()])
      .flatMap((held) => (held.panels.has(panel) ? [held.transcript] : []));
    void run(
      Effect.forEach(transcripts, (transcript) => release(transcript, panel, true), {
        discard: true,
      }),
    );
  };

  return {
    [ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW]: (transcript, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW, sender);
      const panel = sender.sender;
      if (!watched.has(panel)) {
        watched.add(panel);
        whenGone(panel, () => gone(panel));
      }
      const calls = callsMade(followed, transcript);
      const held = calls.get(transcript.callId) ?? { transcript, panels: new Map() };
      calls.set(transcript.callId, held);
      held.panels.set(panel, (held.panels.get(panel) ?? 0) + 1);
      // Note that every follow starts the host over, so the panel that asked hears the transcript whole.
      return host.transcriptFollow(transcript);
    },
    [ACT_KIND.CODING_AGENTS_TRANSCRIPT_UNFOLLOW]: (transcript, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, sender);
      return release(transcript, sender.sender, false);
    },
  };
}
