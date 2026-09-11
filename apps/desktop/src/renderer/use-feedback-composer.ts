import type { FeedbackImage, FeedbackKind } from "@sidecar/feedback";
import { FEEDBACK_LIMITS } from "@sidecar/feedback";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import {
  confirmationHoldMs,
  type FeedbackConfirmation,
  feedbackConfirmation,
} from "./feedback-confirmation";
import {
  accountSignature,
  type FeedbackEntry,
  type FeedbackEntryControl,
  IMAGE_REFUSAL,
  isSendable,
  openedFeedbackEntry,
} from "./feedback-entry";
import { encodeFeedbackImage } from "./feedback-images";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";
import { PANEL_STAND_DOWN, type SettingsView, standDownReturnPage } from "./settings-views";
import { appStateNow } from "./use-app-state";
import { type PanelEntrySurface, panelEntryOpen, usePanelEntry } from "./use-panel-entry";

/**
 * How long the settings tab keeps saying a note to the founders was sent. Long
 * enough to be read on the way back from the Send button, short enough that
 * the line is gone before anyone wonders whether it is stuck.
 */
const FEEDBACK_NOTICE_MS = 6_000;

export interface UseFeedbackComposerOptions {
  surface: PanelEntrySurface;
  /** The presentation as drawn, so the confirmation ends with its shape. */
  presentation: PanelPresentation;
  /** Whether motion is reduced, which shortens the landing's hold. */
  stillMotion: boolean;
  /** Where leaving the composer comes back to. */
  standDownPage: RefObject<SettingsView>;
}

export interface FeedbackComposer {
  control: FeedbackEntryControl;
  /**
   * The landing being played in the composer's shape after a send, keyed by
   * play so a second send restarts the swoop rather than reusing a finished
   * one. Undefined is the composer as it always was.
   */
  confirming: { confirmation: FeedbackConfirmation; play: number } | undefined;
  /**
   * Opens the composer for a kind and stands the panel down to its shape.
   * Reports whether the draft was placed, so the spoken path can say what it
   * found.
   */
  begin: (kind: FeedbackKind, fromPanel: boolean, draft?: string) => boolean;
  /** Leaves the shape and keeps the draft — Escape's meaning here. */
  dismiss: () => void;
  latest: () => FeedbackEntry | undefined;
  /**
   * Holds the words a spoken open asked to start the note with, until the
   * composer's lifecycle event consumes them. The composer's own channel
   * carries names alone, so the draft waits here — and only ever the
   * developer's own words, under the spoken tool's contract.
   */
  holdSpokenDraft: (draft: string | undefined) => void;
  takeSpokenDraft: () => string | undefined;
}

/**
 * The note to the founders, whole: the composer's entry, the "Sent" line, and
 * the landing Luke plays over it. All three end together, because they are one
 * act — writing a note — drawn in one shape.
 */
export function useFeedbackComposer(options: UseFeedbackComposerOptions): FeedbackComposer {
  const { act } = useAct();
  const { surface, presentation, stillMotion, standDownPage } = options;
  const [notice, setNotice] = useState<string>();
  const [confirming, setConfirming] = useState<{
    confirmation: FeedbackConfirmation;
    play: number;
  }>();
  const noticeTimer = useRef<number | undefined>(undefined);
  /**
   * The landing the latest send drew, held so the confirmation's hold waits
   * out the same gesture the slot is playing. The initial flip is fixed
   * because it is never played: a landing is always drawn again on delivery.
   */
  const landing = useRef(feedbackConfirmation(() => 0));
  /** Counts confirmations so each landing's swoop is replayed, not reused. */
  const confirmPlays = useRef(0);
  const confirmTimer = useRef<number | undefined>(undefined);
  /**
   * The panel's deferred return, held for as long as the confirmation plays.
   * Running it is the confirmation ending on time; dropping it is the shape
   * being asked for again — or left — before the celebration finished.
   */
  const finishHeld = useRef<(() => void) | undefined>(undefined);
  const spokenDraft = useRef<string | undefined>(undefined);
  const stillRef = useRef(stillMotion);
  stillRef.current = stillMotion;

  /**
   * Says a send landed, and stops saying it once it has been readable. Long
   * enough to be read on the way back from the Send button, short enough that
   * the line is gone before anyone wonders whether it is stuck.
   */
  const showNotice = useCallback((next: string) => {
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
    setNotice(next);
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = undefined;
      setNotice(undefined);
    }, FEEDBACK_NOTICE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  /**
   * Ends the confirmation without restoring anything: the shape was asked for
   * again, or left, so the finish it held is dropped rather than run.
   */
  const dropConfirmation = useCallback(() => {
    if (confirmTimer.current !== undefined) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = undefined;
    }
    finishHeld.current = undefined;
    setConfirming(undefined);
  }, []);

  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  // A confirmation lives exactly as long as the shape it is drawn in: the
  // presentation moving on ends it and drops the unrun finish it held.
  useEffect(() => {
    if (presentation === PANEL_PRESENTATION.FEEDBACK) return;
    dropConfirmation();
  }, [presentation, dropConfirmation]);

  const entry = usePanelEntry<FeedbackEntry>({
    ...surface,
    aside: PANEL_PRESENTATION.FEEDBACK,
    restoresPanel: (held) => held.fromPanel === true,
    isSendable,
    send: async (sending) => {
      const name = sending.name.trim();
      const email = sending.email.trim();
      try {
        const result = await act(ACT_KIND.FEEDBACK_SEND, {
          submission: {
            kind: sending.kind,
            message: sending.message.trim(),
            ...(name ? { name } : undefined),
            ...(email ? { email } : undefined),
            images: sending.images,
          },
        });
        if (!result.delivered) {
          return { rejection: result.reason ?? "Could not send that. Try again." };
        }
        return {};
      } catch {
        return { rejection: "Could not send that. Try again." };
      }
    },
    onDelivered: () => {
      showNotice("Sent — thank you!");
      // The landing plays in the shape the note left from: Luke swoops down
      // beside the thank-you and plays this send's flip of the coin. The pick
      // is held on a ref so the hold below waits out the same gesture.
      const confirmation = feedbackConfirmation();
      landing.current = confirmation;
      confirmPlays.current += 1;
      setConfirming({ confirmation, play: confirmPlays.current });
    },
    afterDelivery: (finish) => {
      finishHeld.current = finish;
      const { motion } = landing.current;
      if (confirmTimer.current !== undefined) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(
        () => {
          confirmTimer.current = undefined;
          setConfirming(undefined);
          const held = finishHeld.current;
          finishHeld.current = undefined;
          held?.();
        },
        confirmationHoldMs({ motion, still: stillRef.current }),
      );
    },
  });

  /**
   * Opens the composer for a kind — from the section's own buttons or asked of
   * Luke out loud — and stands the panel down to its shape,
   * the way beginning a key entry stands it down to the slot: writing one
   * note is one act. What opening does to a note already there is
   * {@link openedFeedbackEntry}'s to decide — a half-written note is brought
   * back rather than discarded, and a starting draft lands only in an empty
   * one. Reports whether the draft was placed, so the spoken path can say
   * what it found; where leaving returns you follows the latest ask, not the
   * first.
   */
  const begin = useCallback(
    (kind: FeedbackKind, fromPanel: boolean, draft?: string): boolean => {
      setNotice(undefined);
      // The Feedback section is on the front page, so that is where leaving
      // the composer — or the thank-you the send lands in — comes back to.
      standDownPage.current = standDownReturnPage({ kind: PANEL_STAND_DOWN.FEEDBACK });
      // Asking to write again is the confirmation's end: the composer takes
      // the shape back, and the return the landing held is dropped unrun.
      dropConfirmation();
      const opened = openedFeedbackEntry(entry.latest(), {
        kind,
        fromPanel,
        ...(draft !== undefined ? { draft } : undefined),
        // A fresh note starts signed with the account; a note already there
        // keeps its fields as its author left them, cleared ones included.
        signature: accountSignature(appStateNow()?.account),
      });
      if (opened.entry) entry.apply(opened.entry);
      entry.standDown();
      return opened.drafted;
    },
    [dropConfirmation, entry.apply, entry.latest, entry.standDown, standDownPage],
  );

  /**
   * Leaves the shape and keeps the draft — Escape's meaning here. A note is
   * longer than a key, and a key is the only thing Escape is allowed to
   * discard; the way back in is the same button, now reading "keep writing".
   * Where it returns you is where the composer was last asked for from: the
   * panel, or — from a spoken ask — nothing at all.
   */
  const dismiss = useCallback(() => {
    if (surface.presentation() !== PANEL_PRESENTATION.FEEDBACK) return;
    // Escape during the landing skips the celebration, never the return: the
    // finish the confirmation held runs now instead of later.
    if (finishHeld.current) {
      const finish = finishHeld.current;
      dropConfirmation();
      finish();
      return;
    }
    if (entry.latest()?.fromPanel === true) surface.restorePanel();
    else surface.leave();
  }, [dropConfirmation, entry.latest, surface.leave, surface.presentation, surface.restorePanel]);

  /**
   * Takes picked or pasted files aboard. Encoding happens here on the user's
   * machine — scaled and re-written where a screenshot would not fit the
   * request a submission has to travel as — and what could not come is said
   * beside the field rather than dropped in silence.
   */
  const holdSpokenDraft = useCallback((draft: string | undefined) => {
    spokenDraft.current = draft;
  }, []);

  const takeSpokenDraft = useCallback(() => {
    const draft = spokenDraft.current;
    spokenDraft.current = undefined;
    return draft;
  }, []);

  const attach = useCallback(
    async (files: readonly File[]) => {
      const current = entry.latest();
      if (!panelEntryOpen(current)) return;
      const room = FEEDBACK_LIMITS.MAX_IMAGES - current.images.length;
      const taken = files.slice(0, Math.max(0, room));
      const encoded: FeedbackImage[] = [];
      let refused = false;
      for (const file of taken) {
        const image = await encodeFeedbackImage(file);
        if (image) encoded.push(image);
        else refused = true;
      }
      // Read again after the awaits: typing meanwhile replaced the entry
      // object, and Cancel or a send may have ended it altogether.
      const latest = entry.latest();
      if (!panelEntryOpen(latest)) return;
      const rejection = refused
        ? IMAGE_REFUSAL.UNREADABLE
        : files.length > room
          ? IMAGE_REFUSAL.FULL
          : undefined;
      entry.apply({
        ...latest,
        images: [...latest.images, ...encoded].slice(0, FEEDBACK_LIMITS.MAX_IMAGES),
        rejection,
      });
    },
    [entry.apply, entry.latest],
  );

  return {
    control: {
      entry: entry.entry,
      ...(notice ? { notice } : undefined),
      // The section's own buttons are the panel asking, so leaving returns there.
      begin: (kind) => begin(kind, true),
      changeMessage: (message) => entry.patch({ message }),
      changeName: (name) => entry.patch({ name }),
      changeEmail: (email) => entry.patch({ email }),
      attach: (files) => void attach(files),
      removeImage: (index) => {
        const current = entry.latest();
        if (!panelEntryOpen(current)) return;
        entry.apply({
          ...current,
          images: current.images.filter((_, held) => held !== index),
        });
      },
      dismiss,
      cancel: entry.cancel,
      commit: entry.commit,
    },
    confirming,
    begin,
    dismiss,
    latest: entry.latest,
    holdSpokenDraft,
    takeSpokenDraft,
  };
}
