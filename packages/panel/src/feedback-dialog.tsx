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
 * written as. One rule keeps it: only a delivered send discards it; Cancel,
 * Escape and a press on the dimmed window only close the card, keeping the
 * words and screenshots for the next opening of that kind — unless there are
 * no words yet, in which case there is nothing worth keeping and they discard
 * it too. While there are words, the first of them nudges the card and keeps
 * it open, so a stray press never takes the card from under a note being
 * written, and the next closes it. A send refused shakes the card.
 *
 * What a send carries is exactly what the card shows: the words, the
 * screenshots drawn in it, which experiment the note is about where its
 * title names one (opened from that experiment's row in Settings ›
 * Experimental), and — only while "Include my name and email" is
 * ticked — the signed-in account's name and address, the line beside the
 * box reads out. Nothing else rides along, a credential least of all. All the
 * card holds between its title and its answers is left out of the screen
 * recording (`ph-no-capture`), because a screenshot is a picture of the
 * person's screen and could carry another app's words.
 */

import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIMITS,
  type FeedbackImage,
  type FeedbackKind,
  type FeedbackSubmission,
} from "@luke/features/feedback";
import { pasteCutWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENTS, type Experiment } from "@luke/settings";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "@luke/settings/shortcuts";
import {
  ALIGN,
  AttachmentChip,
  BUTTON_VARIANT,
  Button,
  Checkbox,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  FormField,
  GAP,
  IconButton,
  ImageIcon,
  Inline,
  LAYOUT_ELEMENT,
  Shortcut,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextArea,
  Tooltip,
  useFilePicker,
} from "@luke/ui";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAct } from "./act.js";
import { modEnterSends } from "./enter-sends.js";
import { encodeImage, imageFiles } from "./feedback-images.js";
import { DROP_LEAVE, useFileDrop } from "./use-file-drop.js";

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
    placeholder: "What would you want Luke to do?",
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
   * draft was discarded or sent lands in no draft at all.
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
  // The words a paste past the cap left once it was cut to fit; the note stands while they do.
  const [cutWords, setCutWords] = useState<string>();
  const fileDrop = useFileDrop((files) => void attach(imageFiles(files)), {
    leave: DROP_LEAVE.WINDOW,
  });
  const open = kind !== undefined;
  const field = useRef<HTMLTextAreaElement | null>(null);
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
    if (!open) fileDrop.clear();
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

  // Note that the browser cuts a paste to the room left without a word, so the words it leaves are worked out here to tell it.
  const noteCutPaste = (box: HTMLTextAreaElement, pasted: string) => {
    const kept = box.value.slice(0, box.selectionStart) + box.value.slice(box.selectionEnd);
    const room = FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH - kept.length;
    const text = pasted.replaceAll("\r\n", "\n");
    if (text.length <= room) return;
    setCutWords(
      box.value.slice(0, box.selectionStart) +
        text.slice(0, room) +
        box.value.slice(box.selectionEnd),
    );
  };

  const close = () => {
    if (kind === undefined || latestBusy()) return;
    if (!hasWords(latestDrafts()[kind])) discardDraft(kind);
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
    // Note that a draft discarded or sent while its screenshots were read
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

  const picker = useFilePicker({
    accept: "image/*",
    multiple: true,
    onFiles: (picked) => void attach(imageFiles(picked)),
  });

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
  };

  // Command or Ctrl with Return sends from anywhere in the card.
  const sendKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!modEnterSends(event)) return;
    event.preventDefault();
    void send();
  };

  // Note that the card is drawn as it last stood while it fades out, because
  // what it was opened with, and the draft a send has emptied, are let go
  // the moment it closes.
  const standing = useRef<
    { kind: FeedbackKind; about: Experiment | undefined; draft: FeedbackDraft } | undefined
  >(undefined);
  if (kind !== undefined) standing.current = { kind, about, draft };
  const shown = standing.current;

  const full = draft.images.length >= FEEDBACK_LIMITS.MAX_IMAGES;

  return shown === undefined ? null : (
    // The whole dimmed window takes a dropped screenshot.
    <Dialog
      open={open}
      size={DIALOG_SIZE.WIDE}
      title={dialogTitle(shown.kind, shown.about)}
      busy={busy}
      refused={rejection !== undefined}
      holding={hasWords(draft)}
      initialFocus={field}
      onDismiss={close}
      onKeyDown={sendKey}
      dropping={fileDrop.dropping}
      dropTarget={fileDrop.target}
      actionsStart={
        <>
          <Tooltip label="Attach screenshot">
            <IconButton
              icon={<ImageIcon />}
              label="Attach screenshot"
              disabled={busy || full}
              onClick={picker.open}
            />
          </Tooltip>
          {picker.input}
        </>
      }
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} disabled={busy} onClick={close}>
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
            <Shortcut chord={SEND_CHORD} className="button-chord" />
          </Button>
        </>
      }
    >
      <div className="feedback-dialog ph-no-capture">
        <FormField
          label={FEEDBACK_COPY[shown.kind].field}
          description={
            cutWords === shown.draft.message
              ? pasteCutWords(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH)
              : undefined
          }
          count={{
            length: shown.draft.message.length,
            limit: FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH,
          }}
        >
          {(control) => (
            <TextArea
              ref={field}
              field={control}
              placeholder={FEEDBACK_COPY[shown.kind].placeholder}
              maxLength={FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH}
              value={shown.draft.message}
              disabled={busy}
              rows={MESSAGE_ROWS}
              grow
              onChange={(message) => changeDraft({ message })}
              onPaste={(event) => {
                // A screenshot on the clipboard is an attachment, not text
                // that failed to paste; text pastes as it always does.
                const pasted = imageFiles(event.clipboardData.files);
                if (pasted.length === 0) {
                  noteCutPaste(event.currentTarget, event.clipboardData.getData("text"));
                  return;
                }
                event.preventDefault();
                void attach(pasted);
              }}
            />
          )}
        </FormField>
        {shown.draft.images.length > 0 ? (
          <Inline
            as={LAYOUT_ELEMENT.UL}
            gap={GAP.CONTROL}
            align={ALIGN.STRETCH}
            className="feedback-dialog-images"
            aria-label="Screenshots"
          >
            {shown.draft.images.map((image, index) => (
              <AttachmentChip
                key={`${image.name}-${String(index)}`}
                name={image.name}
                image={feedbackImageUrl(image)}
                removeDisabled={busy}
                onRemove={() =>
                  changeDraft({
                    images: latestDrafts()[shown.kind].images.filter((_, held) => held !== index),
                  })
                }
              />
            ))}
          </Inline>
        ) : null}
        {signature ? (
          <div className="feedback-dialog-signature">
            <Checkbox
              checked={shown.draft.signed}
              disabled={busy}
              aria-describedby={signatureId}
              onChange={(signed) => changeDraft({ signed })}
            >
              Include my name and email
            </Checkbox>
            <Text
              as={TEXT_ELEMENT.SPAN}
              variant={TEXT_VARIANT.INHERIT}
              truncate
              id={signatureId}
              className="feedback-dialog-identity"
            >
              {shown.draft.signed
                ? `Sending as ${[signature.name, signature.email].filter(Boolean).join(" · ")}`
                : null}
            </Text>
          </div>
        ) : null}
        {rejection === undefined ? null : <ErrorState>{rejection}</ErrorState>}
      </div>
    </Dialog>
  );
}
