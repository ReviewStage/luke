/**
 * feedback-dialog.tsx -- a note to the people who make Luke, written in a modal over the window: words, screenshots, and whether to sign it.
 *
 * The window asks the way every desktop app's "Send feedback" asks: it dims,
 * a card holds one field and the few things that go with it, and Cancel and
 * Send sit at its foot. The field takes focus, Tab stays inside the card, and
 * focus goes back to whatever opened it. Command-Enter sends from anywhere in
 * the card.
 *
 * One rule keeps the draft: Cancel and a delivered send discard it; Escape
 * and a press on the dimmed window only close the card, keeping the words
 * and screenshots for the next opening — unless there are no words yet, in
 * which case there is nothing worth keeping and they discard it too.
 *
 * What a send carries is exactly what the card shows: the words, the
 * screenshots drawn in it, and — only while "Include my name and email" is
 * ticked — the signed-in account's name and address, the line beside the
 * box reads out. Nothing else rides along, a credential least of all. The
 * whole card is left out of the screen recording (`ph-no-capture`), because a
 * screenshot is a picture of the person's screen and could carry another
 * app's words.
 */

import { useAtom } from "@effect/atom-react";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import {
  FEEDBACK_KIND,
  FEEDBACK_LIMITS,
  type FeedbackImage,
  type FeedbackKind,
  type FeedbackSubmission,
} from "@sidecar/feedback";
import { CheckIcon, ImageIcon, RemoveIcon } from "@sidecar/panel";
import { Duration, Effect } from "effect";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import { encodeFeedbackImage, imageFiles } from "./feedback-images";
import { rendererRuntime } from "./renderer-runtime";
import { trappedTab } from "./settings/confirm-dialog";
import { useStagedFocus } from "./staged-focus";
import { Tooltip } from "./tooltip";
import { useStateWithRef } from "./use-state-with-ref";

/**
 * Each kind in its own words: the title its dialog and its Settings button
 * carry, the field's name, and the hint the empty field shows. The wire still
 * calls the second kind a prompt; to the person writing it, it is a feature
 * they would like Luke to have.
 */
export const FEEDBACK_COPY = {
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
  UNREADABLE: "That file could not come along as a screenshot.",
  FULL: `Up to ${FEEDBACK_LIMITS.MAX_IMAGES} screenshots can come along.`,
} as const;

const SEND_REFUSAL = "Could not send that. Try again.";

/** How long "Thanks — sent" stays: read on the way back from the Send button, gone before anyone wonders. */
const SENT_NOTICE = Duration.seconds(3);

/**
 * The thank-you's life, as an atom whose work is the wait: it is waiting for
 * exactly as long as the notice stands, and a second send restarts it.
 */
const sentNoticeAtom = rendererRuntime.fn(() => Effect.sleep(SENT_NOTICE));

/** The note as it stands between openings: its words, its screenshots, and whether it is signed. */
interface FeedbackDraft {
  message: string;
  images: readonly FeedbackImage[];
  signed: boolean;
}

const FRESH_DRAFT: FeedbackDraft = { message: "", images: [], signed: true };

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
): FeedbackSubmission {
  const credit = draft.signed ? signature : undefined;
  return {
    kind,
    message: draft.message.trim(),
    ...(credit?.name ? { name: credit.name } : undefined),
    ...(credit ? { email: credit.email } : undefined),
    images: draft.images,
  };
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
    const image = await encodeFeedbackImage(file);
    if (image) images.push(image);
    else unreadable = true;
  }
  if (unreadable) return { images, refusal: IMAGE_REFUSAL.UNREADABLE };
  if (files.length > room) return { images, refusal: IMAGE_REFUSAL.FULL };
  return { images };
}

/** The quiet line that says it went, at the window's foot, for a moment after the dialog closes. */
function SentNotice(): React.JSX.Element {
  return createPortal(
    <p className="feedback-sent" role="status">
      <CheckIcon />
      Thanks — sent
    </p>,
    document.body,
  );
}

/** One screenshot coming along, small enough to recognise, with the way to take it off. */
function ImageThumbnail({
  image,
  busy,
  onRemove,
}: {
  image: FeedbackImage;
  busy: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <li className="feedback-dialog-image">
      <img src={feedbackImageUrl(image)} alt={image.name} />
      <button
        type="button"
        className="feedback-dialog-image-remove"
        aria-label={`Remove ${image.name}`}
        disabled={busy}
        onClick={onRemove}
      >
        <RemoveIcon />
      </button>
    </li>
  );
}

/**
 * The dialog for the kind asked for, while one is, and the thank-you after a
 * send lands. Always mounted by the app, because the draft it keeps between
 * openings lives here.
 */
export function FeedbackDialog({
  kind,
  account,
  onClose,
}: {
  /** The kind being written, or nothing while the dialog is closed. */
  kind: FeedbackKind | undefined;
  account: AccountSnapshot | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [draft, setDraft, latestDraft] = useStateWithRef<FeedbackDraft>(FRESH_DRAFT);
  const [busy, setBusy, latestBusy] = useStateWithRef(false);
  const [rejection, setRejection] = useState<string>();
  const [dropping, setDropping] = useState(false);
  const [sent, showSent] = useAtom(sentNoticeAtom);
  const open = kind !== undefined;
  const field = useRef<HTMLTextAreaElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const signatureId = useId();
  const signature = accountSignature(account);

  // Note that the invoker is read before the field takes focus, because once
  // it has, the control that opened the dialog no longer holds it.
  useLayoutEffect(() => {
    if (!open) return;
    invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
      invoker.current = null;
    };
  }, [open]);

  useStagedFocus(field, open && !busy);
  // The field is stilled while the note is on its way, so the card holds
  // focus itself rather than letting it fall to the window behind.
  useStagedFocus(card, open && busy);

  // Closing puts a drop's highlight away, whatever became of the drag.
  useEffect(() => {
    if (!open) setDropping(false);
  }, [open]);

  const changeDraft = (next: Partial<FeedbackDraft>) => {
    setDraft({ ...latestDraft(), ...next });
    setRejection(undefined);
  };

  const close = (discard: boolean) => {
    if (latestBusy()) return;
    if (discard || !hasWords(latestDraft())) setDraft(FRESH_DRAFT);
    setRejection(undefined);
    onClose();
  };

  const attach = async (files: readonly File[]) => {
    if (files.length === 0 || latestBusy()) return;
    const taken = await takenImages(
      files,
      FEEDBACK_LIMITS.MAX_IMAGES - latestDraft().images.length,
    );
    // Read again after the encoding: typing meanwhile replaced the draft.
    const current = latestDraft();
    setDraft({
      ...current,
      images: [...current.images, ...taken.images].slice(0, FEEDBACK_LIMITS.MAX_IMAGES),
    });
    setRejection(taken.refusal);
  };

  const send = async () => {
    const current = latestDraft();
    if (kind === undefined || latestBusy() || !hasWords(current)) return;
    setBusy(true);
    setRejection(undefined);
    const refusal = await act(ACT_KIND.FEEDBACK_SEND, {
      submission: draftSubmission(kind, current, signature),
    }).then(
      (result) => (result.delivered ? undefined : (result.reason ?? SEND_REFUSAL)),
      () => SEND_REFUSAL,
    );
    setBusy(false);
    if (refusal !== undefined) {
      setRejection(refusal);
      return;
    }
    setDraft(FRESH_DRAFT);
    onClose();
    showSent();
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the dialog goes on to the window, because
    // a window chord would change what stands behind a note being written.
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      trappedTab(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(false);
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  const ready = hasWords(draft) && !busy;
  const full = draft.images.length >= FEEDBACK_LIMITS.MAX_IMAGES;

  return (
    <>
      {sent.waiting && !open ? <SentNotice /> : null}
      {kind === undefined
        ? null
        : createPortal(
            // A press that begins and ends on the dimmed window closes the
            // dialog; a text selection dragged out of the card is no press
            // on the window. The whole window takes a dropped screenshot.
            // biome-ignore lint/a11y/noStaticElementInteractions: the dimmed window is a pointer and drop target alone; the keys it hears come from the card's own focus.
            <div
              className="confirm-dialog-backdrop"
              onPointerDown={(event) => {
                pressedBackdrop.current = event.target === event.currentTarget;
              }}
              onClick={(event) => {
                if (pressedBackdrop.current && event.target === event.currentTarget) close(false);
                pressedBackdrop.current = false;
              }}
              onKeyDown={keyDown}
              onDragOver={(event) => {
                if (!carriesFiles(event)) return;
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={(event) => {
                if (event.relatedTarget === null) setDropping(false);
              }}
              onDrop={(event) => {
                if (!carriesFiles(event)) return;
                event.preventDefault();
                setDropping(false);
                void attach(imageFiles(event.dataTransfer.files));
              }}
            >
              <div
                ref={card}
                className="confirm-dialog feedback-dialog ph-no-capture"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-busy={busy}
                data-dropping={String(dropping)}
                tabIndex={-1}
              >
                <h2 id={titleId} className="confirm-dialog-title">
                  {FEEDBACK_COPY[kind].title}
                </h2>
                <textarea
                  ref={field}
                  className="feedback-dialog-message"
                  aria-label={FEEDBACK_COPY[kind].field}
                  placeholder={FEEDBACK_COPY[kind].placeholder}
                  maxLength={FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH}
                  value={draft.message}
                  disabled={busy}
                  onChange={(event) => changeDraft({ message: event.target.value })}
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
                      <ImageThumbnail
                        key={`${image.name}-${String(index)}`}
                        image={image}
                        busy={busy}
                        onRemove={() =>
                          changeDraft({
                            images: latestDraft().images.filter((_, held) => held !== index),
                          })
                        }
                      />
                    ))}
                  </ul>
                ) : null}
                {signature ? (
                  <div className="feedback-dialog-signature">
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.signed}
                        disabled={busy}
                        aria-describedby={signatureId}
                        onChange={(event) => changeDraft({ signed: event.target.checked })}
                      />
                      Include my name and email
                    </label>
                    <span
                      id={signatureId}
                      className="feedback-dialog-identity"
                      data-signed={String(draft.signed)}
                    >
                      {draft.signed
                        ? `Sending as ${[signature.name, signature.email].filter(Boolean).join(" · ")}`
                        : "Sending without your name"}
                    </span>
                  </div>
                ) : null}
                {rejection === undefined ? null : (
                  <p className="confirm-dialog-error" role="alert">
                    {rejection}
                  </p>
                )}
                <div className="confirm-dialog-actions">
                  <Tooltip label="Attach screenshot">
                    <button
                      type="button"
                      className="toolbar-button toolbar-icon-button feedback-dialog-attach"
                      aria-label="Attach screenshot"
                      disabled={busy || full}
                      onClick={() => picker.current?.click()}
                    >
                      <ImageIcon />
                    </button>
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
                  <button
                    type="button"
                    className="confirm-dialog-button"
                    disabled={busy}
                    onClick={() => close(true)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="confirm-dialog-button"
                    data-primary="true"
                    aria-keyshortcuts="Meta+Enter"
                    disabled={!ready}
                    onClick={() => void send()}
                  >
                    {busy ? "Sending…" : "Send"}
                    <span className="shortcut-glyphs" aria-hidden="true">
                      <span>⌘</span>
                      <span>↩</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
    </>
  );
}
