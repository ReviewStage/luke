/**
 * feedback-dialog.tsx -- a note to the people who make Luke, written in a modal over the window: words, screenshots, and whether to sign it.
 *
 * The window asks the way every desktop app's "Send feedback" asks: it dims,
 * a card holds one field and the few things that go with it, and Cancel and
 * Send sit at its foot. The field takes focus, Tab stays inside the card, and
 * focus goes back to whatever opened it. Command-Enter sends from anywhere in
 * the card.
 *
 * Each kind keeps its own draft, so a note is always sent as the kind it was
 * written as. One rule keeps it: Cancel and a delivered send discard it;
 * Escape and a press on the dimmed window only close the card, keeping the
 * words and screenshots for the next opening of that kind — unless there are
 * no words yet, in which case there is nothing worth keeping and they discard
 * it too.
 *
 * What a send carries is exactly what the card shows: the words, the
 * screenshots drawn in it, which experiment the note is about where its
 * title names one (opened from that experiment's row in Settings ›
 * Experimental), and — only while "Include my name and email" is
 * ticked — the signed-in account's name and address, the line beside the
 * box reads out. Nothing else rides along, a credential least of all. The
 * whole card is left out of the screen recording (`ph-no-capture`), because a
 * screenshot is a picture of the person's screen and could carry another
 * app's words.
 */

import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIMITS,
  type FeedbackImage,
  type FeedbackKind,
  type FeedbackSubmission,
} from "@luke/features/feedback";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENTS, type Experiment } from "@luke/settings";
import {
  AttachmentChip,
  BUTTON_VARIANT,
  Button,
  Checkbox,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  IconButton,
  ImageIcon,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextArea,
} from "@luke/ui";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { Duration } from "effect";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "#shared/shortcuts";
import { useAct } from "./act";
import { encodeImage, imageFiles } from "./feedback-images";
import { Shortcut } from "./shortcut";
import { TOAST_TONE, type ToastNotice, useToast } from "./toast";
import { Tooltip } from "./tooltip";

/**
 * Each kind in its own words: the title its dialog carries, the field's
 * name, and the hint the empty field shows. The wire still
 * calls the second kind a prompt; to the person writing it, it is a feature
 * they would like Luke to have.
 */
const FEEDBACK_COPY = {
  [FEEDBACK_KIND.FEEDBACK]: {
    title: "Send feedback",
    field: "Feedback",
    placeholder: "What happened, and what did you expect?",
  },
  [FEEDBACK_KIND.PROMPT]: {
    title: "Suggest a feature",
    field: "Feature suggestion",
    placeholder: "Describe a feature you'd like Luke to have…",
  },
} as const;

/**
 * Why an attachment did not come along, in the dialog's own words. Said
 * beside the field rather than thrown, because attaching is the user's action.
 */
const IMAGE_REFUSAL = {
  UNREADABLE: "That file could not be attached.",
  FULL: `You can attach up to ${FEEDBACK_LIMITS.MAX_IMAGES} screenshots.`,
} as const;

const SEND_REFUSAL = "Could not send that. Try again.";

/** How many lines the empty note stands tall before it grows with its words. */
const MESSAGE_ROWS = 5;

/** The chord that sends from anywhere in the dialog, as Send draws and announces it. */
const SEND_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** The toast a delivered note is thanked with: read on the way back from the Send button, gone before anyone wonders. */
const SENT_NOTICE: ToastNotice = {
  words: "Sent",
  tone: TOAST_TONE.DONE,
  hold: Duration.seconds(3),
};

/** The note as it stands between openings: its words, its screenshots, and whether it is signed. */
interface FeedbackDraft {
  message: string;
  images: readonly FeedbackImage[];
  signed: boolean;
}

const FRESH_DRAFT: FeedbackDraft = { message: "", images: [], signed: true };

type FeedbackDrafts = Readonly<Record<FeedbackKind, FeedbackDraft>>;

const FRESH_DRAFTS = {
  [FEEDBACK_KIND.FEEDBACK]: FRESH_DRAFT,
  [FEEDBACK_KIND.PROMPT]: FRESH_DRAFT,
} satisfies FeedbackDrafts;

/** The credit a signed note carries: the signed-in account's own name and address. */
interface FeedbackSignature {
  name?: string;
  email: string;
}

function accountSignature(account: AccountSnapshot | undefined): FeedbackSignature | undefined {
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN) return undefined;
  return { ...(account.name ? { name: account.name } : undefined), email: account.email };
}

function hasWords(draft: FeedbackDraft): boolean {
  return draft.message.trim().length > 0;
}

/** What a send carries: the draft's words and screenshots, and the signature only while it is ticked. */
function draftSubmission(
  kind: FeedbackKind,
  draft: FeedbackDraft,
  signature: FeedbackSignature | undefined,
  about: Experiment | undefined,
): FeedbackSubmission {
  const credit = draft.signed ? signature : undefined;
  return {
    kind,
    message: draft.message.trim(),
    ...(credit?.name ? { name: credit.name } : undefined),
    ...(credit ? { email: credit.email } : undefined),
    images: draft.images,
    ...(about === undefined ? undefined : { experiment: about }),
  };
}

/** The dialog's title: the kind's own, or which experiment a note is about where it was opened from that experiment's row. */
function dialogTitle(kind: FeedbackKind, about: Experiment | undefined): string {
  const experiment = EXPERIMENTS.find((entry) => entry.key === about);
  return experiment ? `Feedback on ${experiment.name}` : FEEDBACK_COPY[kind].title;
}

function feedbackImageUrl(image: FeedbackImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

/** Whether a drag carries files, which is all the card offers to take. */
function carriesFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Encodes picked, pasted, or dropped files on this machine — scaled and
 * re-written where a screenshot would not fit the request a submission
 * travels as — and says what could not come rather than dropping it.
 */
async function takenImages(
  files: readonly File[],
  room: number,
): Promise<{ images: FeedbackImage[]; refusal?: string }> {
  const images: FeedbackImage[] = [];
  let unreadable = false;
  for (const file of files.slice(0, Math.max(0, room))) {
    const image = await encodeImage(file);
    if (image) images.push(image);
    else unreadable = true;
  }
  if (unreadable) return { images, refusal: IMAGE_REFUSAL.UNREADABLE };
  if (files.length > room) return { images, refusal: IMAGE_REFUSAL.FULL };
  return { images };
}

/**
 * The dialog for the kind asked for, while one is, and the thank-you after a
 * send lands. Always mounted by the app, because the drafts it keeps between
 * openings live here.
 */
export function FeedbackDialog({
  kind,
  about,
  account,
  onClose,
}: {
  /** The kind being written, or nothing while the dialog is closed. */
  kind: FeedbackKind | undefined;
  /** The experiment the note is about, where an experiment's row opened it. */
  about?: Experiment | undefined;
  account: AccountSnapshot | undefined;
  onClose: () => void;
}): React.JSX.Element | null {
  const { act } = useAct();
  const [drafts, setDrafts, latestDrafts] = useStateWithRef<FeedbackDrafts>(FRESH_DRAFTS);
  /**
   * Counts each kind's discards, so a screenshot still being read when its
   * draft was cancelled or sent lands in no draft at all.
   */
  const discards = useRef<Record<FeedbackKind, number>>({
    [FEEDBACK_KIND.FEEDBACK]: 0,
    [FEEDBACK_KIND.PROMPT]: 0,
  });
  /** The kind on screen now, for work that finishes renders after it began. */
  const shownKind = useRef(kind);
  shownKind.current = kind;
  const [busy, setBusy, latestBusy] = useStateWithRef(false);
  const [rejection, setRejection] = useState<string>();
  const [dropping, setDropping] = useState(false);
  const showToast = useToast();
  const open = kind !== undefined;
  const field = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const signatureId = useId();
  const signature = accountSignature(account);

  /**
   * Which experiment each kind's kept draft was written about. A note kept by
   * Escape belongs to the place it was written from, so opened about another
   * experiment, or about none, that kind starts fresh rather than sending the
   * old words under the new title.
   */
  const draftAbout = useRef<Record<FeedbackKind, Experiment | undefined>>({
    [FEEDBACK_KIND.FEEDBACK]: undefined,
    [FEEDBACK_KIND.PROMPT]: undefined,
  });
  useLayoutEffect(() => {
    if (kind === undefined || draftAbout.current[kind] === about) return;
    draftAbout.current[kind] = about;
    discards.current[kind] += 1;
    setDrafts({ ...latestDrafts(), [kind]: FRESH_DRAFT });
  }, [kind, about, latestDrafts, setDrafts]);

  // Closing puts a drop's highlight away, whatever became of the drag.
  useEffect(() => {
    if (!open) setDropping(false);
  }, [open]);

  const draft = drafts[kind ?? FEEDBACK_KIND.FEEDBACK];

  const writeDraft = (of: FeedbackKind, next: FeedbackDraft) => {
    setDrafts({ ...latestDrafts(), [of]: next });
  };

  const discardDraft = (of: FeedbackKind) => {
    discards.current[of] += 1;
    writeDraft(of, FRESH_DRAFT);
  };

  const changeDraft = (next: Partial<FeedbackDraft>) => {
    if (kind === undefined) return;
    writeDraft(kind, { ...latestDrafts()[kind], ...next });
    setRejection(undefined);
  };

  const close = (discard: boolean) => {
    if (kind === undefined || latestBusy()) return;
    if (discard || !hasWords(latestDrafts()[kind])) discardDraft(kind);
    setRejection(undefined);
    onClose();
  };

  const attach = async (files: readonly File[]) => {
    if (kind === undefined || files.length === 0 || latestBusy()) return;
    const of = kind;
    const discarded = discards.current[of];
    const taken = await takenImages(
      files,
      FEEDBACK_LIMITS.MAX_IMAGES - latestDrafts()[of].images.length,
    );
    // Note that a draft cancelled or sent while its screenshots were read
    // takes none of them, and neither does one now being sent, because
    // either would carry a picture into a note nobody attached it to.
    if (discards.current[of] !== discarded || latestBusy()) return;
    // Read again after the encoding: typing meanwhile replaced the draft.
    const current = latestDrafts()[of];
    writeDraft(of, {
      ...current,
      images: [...current.images, ...taken.images].slice(0, FEEDBACK_LIMITS.MAX_IMAGES),
    });
    if (shownKind.current === of) setRejection(taken.refusal);
  };

  const send = async () => {
    if (kind === undefined) return;
    const current = latestDrafts()[kind];
    if (latestBusy() || !hasWords(current)) return;
    setBusy(true);
    setRejection(undefined);
    const refusal = await act(ACT_KIND.FEEDBACK_SEND, {
      submission: draftSubmission(kind, current, signature, about),
    }).then(
      (result) => (result.delivered ? undefined : (result.reason ?? SEND_REFUSAL)),
      () => SEND_REFUSAL,
    );
    setBusy(false);
    if (refusal !== undefined) {
      setRejection(refusal);
      return;
    }
    discardDraft(kind);
    onClose();
    showToast(SENT_NOTICE);
  };

  // Command-Return sends from anywhere in the card.
  const sendKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void send();
  };

  const full = draft.images.length >= FEEDBACK_LIMITS.MAX_IMAGES;

  return kind === undefined ? null : (
    // The whole dimmed window takes a dropped screenshot.
    <Dialog
      size={DIALOG_SIZE.WIDE}
      labelledBy={titleId}
      busy={busy}
      initialFocus={field}
      onDismiss={() => close(false)}
      onKeyDown={sendKey}
      dropping={dropping}
      dropTarget={{
        onDragOver: (event) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: (event) => {
          if (event.relatedTarget === null) setDropping(false);
        },
        onDrop: (event) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          setDropping(false);
          void attach(imageFiles(event.dataTransfer.files));
        },
      }}
    >
      <div className="feedback-dialog ph-no-capture">
        <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
          {dialogTitle(kind, about)}
        </Text>
        <TextArea
          ref={field}
          label={FEEDBACK_COPY[kind].field}
          placeholder={FEEDBACK_COPY[kind].placeholder}
          maxLength={FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH}
          value={draft.message}
          disabled={busy}
          rows={MESSAGE_ROWS}
          grow
          onChange={(message) => changeDraft({ message })}
          onPaste={(event) => {
            // A screenshot on the clipboard is an attachment, not text
            // that failed to paste; text pastes as it always does.
            const pasted = imageFiles(event.clipboardData.files);
            if (pasted.length === 0) return;
            event.preventDefault();
            void attach(pasted);
          }}
        />
        {draft.images.length > 0 ? (
          <ul className="feedback-dialog-images" aria-label="Screenshots">
            {draft.images.map((image, index) => (
              <AttachmentChip
                key={`${image.name}-${String(index)}`}
                name={image.name}
                image={feedbackImageUrl(image)}
                removeDisabled={busy}
                onRemove={() =>
                  changeDraft({
                    images: latestDrafts()[kind].images.filter((_, held) => held !== index),
                  })
                }
              />
            ))}
          </ul>
        ) : null}
        {signature ? (
          <div className="feedback-dialog-signature">
            <Checkbox
              checked={draft.signed}
              disabled={busy}
              aria-describedby={signatureId}
              onChange={(signed) => changeDraft({ signed })}
            >
              Include my name and email
            </Checkbox>
            <span id={signatureId} className="feedback-dialog-identity">
              {draft.signed
                ? `Sending as ${[signature.name, signature.email].filter(Boolean).join(" · ")}`
                : null}
            </span>
          </div>
        ) : null}
        {rejection === undefined ? null : <ErrorState>{rejection}</ErrorState>}
        <div className="feedback-dialog-actions">
          <Tooltip label="Attach screenshot">
            <IconButton
              icon={<ImageIcon />}
              label="Attach screenshot"
              disabled={busy || full}
              onClick={() => picker.current?.click()}
            />
          </Tooltip>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const picked = imageFiles(event.currentTarget.files);
              // Cleared so the same file can be picked again after a removal.
              event.currentTarget.value = "";
              void attach(picked);
            }}
          />
          <div className="feedback-dialog-answers">
            <Button disabled={busy} onClick={() => close(true)}>
              Cancel
            </Button>
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              aria-keyshortcuts={shortcutAria(SEND_CHORD)}
              disabled={!hasWords(draft)}
              busy={busy}
              busyLabel="Sending"
              onClick={() => void send()}
            >
              Send
              <Shortcut chord={SEND_CHORD} />
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
