import type { FeedbackImage } from "@sidecar/feedback";
import { FEEDBACK_LIMITS } from "@sidecar/feedback";
import { WingFace as LukeFace } from "@sidecar/panel";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStagedFocus } from "./credential-entry";
import { CONFIRMATION_ENTRANCE_MS, type FeedbackConfirmation } from "./feedback-confirmation";
import {
  FEEDBACK_COPY,
  type FeedbackEntryControl,
  feedbackImageUrl,
  isSendable,
} from "./feedback-entry";
import { imageFiles } from "./feedback-images";
import { HIT_REGION } from "./panel-state";
import { parseMilliseconds, parsePixels, STILL_MS } from "./session-motion";
import { ImageIcon, RemoveIcon } from "./settings-icons";

const MESSAGE_FIELD_ID = "feedback-message";

/**
 * The landing a delivered send plays in the composer's shape: Luke swoops
 * down from above the slot's top edge — the shape clips him until he is
 * inside, so he arrives through it the way the artwork's flyoff leaves — and
 * lands over "Sent — thank you!" to play this send's gesture. The gesture
 * begins on the entrance's own end, told by the same token mirror the main
 * process uses for the collapse, and under reduced motion it never begins:
 * the face rests and the words alone say it.
 */
function FeedbackLanding({
  confirming,
  still,
}: {
  confirming: { confirmation: FeedbackConfirmation; play: number };
  still: boolean;
}): React.JSX.Element {
  // Keyed on the landing's play by the caller, so each send mounts a fresh
  // landing and this begins at rest without watching the play itself.
  const [gesturing, setGesturing] = useState(false);
  useEffect(() => {
    setGesturing(false);
    if (still) return;
    const timer = window.setTimeout(() => setGesturing(true), CONFIRMATION_ENTRANCE_MS);
    return () => window.clearTimeout(timer);
  }, [still]);

  return (
    <div
      className="feedback-confirm"
      data-scene={confirming.confirmation.scene}
      data-gesturing={String(gesturing)}
    >
      <span className="feedback-confirm-luke">
        <LukeFace
          key={gesturing ? confirming.play : 0}
          {...(gesturing ? { motion: confirming.confirmation.motion } : undefined)}
        />
      </span>
      <p className="feedback-confirm-msg" role="status">
        Sent — thank you<span className="feedback-confirm-bang">!</span>
      </p>
    </div>
  );
}

/**
 * The panel stood down to the composer, the way it stands down to the key
 * slot: writing a note to the founders is one act, so the shape it happens in
 * holds the note and nothing else. The same spring carries the morph, the
 * content arrives on the slot's beat, and everything the shape does not cover
 * stays click-through.
 *
 * Escape leaves the shape and keeps the draft — a note is longer than a key,
 * and a key is the only thing Escape is allowed to discard. Only Cancel and a
 * landed send end the entry.
 */
export function FeedbackSlot({
  control,
  drawn,
  measure,
  confirming,
  still,
}: {
  control: FeedbackEntryControl;
  /** True while the composer is the shape the surface is drawn as. */
  drawn: boolean;
  /** Reports the composer's height, so the surface can end where it does. */
  measure: (element: HTMLElement | null) => void;
  /** The landing being played after a delivered send, replacing the fields. */
  confirming?: { confirmation: FeedbackConfirmation; play: number };
  /** Reduced motion: the landing shows its words with the face at rest. */
  still: boolean;
}): React.JSX.Element | null {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const filePicker = useRef<HTMLInputElement | null>(null);
  const previewButton = useRef<HTMLButtonElement | null>(null);
  const followStack = useRef<HTMLDivElement | null>(null);
  const held = useRef(control.entry);
  /** Which attachment is being looked at, begun and ended inside this shape. */
  const [preview, setPreview] = useState<number>();
  /**
   * Whether the preview is in the tree at all. Mounted is a longer life than
   * open: closing fades the image out over `--duration-exit` first, and only
   * the end of that fade takes it out and releases its room — otherwise the
   * shape would shrink out from under a picture still on screen.
   */
  const [previewMounted, setPreviewMounted] = useState(false);
  /** What the reveal draws through its own exit, held like the entry is. */
  const heldPreview = useRef<FeedbackImage | undefined>(undefined);
  // The shape has to outlive the entry that filled it, exactly as the key slot
  // does: emptying on the frame a send lands would leave a blank shape on
  // screen for as long as the morph back to the panel takes. It keeps drawing
  // what it last held until the shape has left it behind.
  if (control.entry) held.current = control.entry;
  const entry = held.current;
  const live = drawn && control.entry !== undefined;
  const busy = control.entry?.busy ?? false;

  useStagedFocus(field, live && !busy);

  // The preview belongs to a visit: leaving the shape puts it away, so coming
  // back starts at the note rather than at a screenshot someone else may have
  // long since finished with. Unmounted outright — the shape it would spring
  // shut inside is itself leaving.
  useEffect(() => {
    if (live) return;
    setPreview(undefined);
    setPreviewMounted(false);
  }, [live]);

  // The preview takes the focus it was asked for with, so the Escape that
  // follows closes the preview rather than reaching the shape behind it.
  useEffect(() => {
    if (preview === undefined) return;
    previewButton.current?.focus({ preventScroll: true });
  }, [preview]);

  // How far the send row has to travel when the preview takes or gives back
  // its room, told to the stylesheet before the first frame paints: the
  // follow animations replay that journey on the shape's own spring. Observed
  // rather than read once, because the image's height is only sure once it
  // has laid out. The gap is the slot's own computed gap, so a retune in the
  // stylesheet is the room the row actually travels.
  useLayoutEffect(() => {
    if (!previewMounted) return;
    const measured = previewButton.current;
    const stack = followStack.current;
    if (!measured || !stack) return;
    const report = () => {
      const slot = measured.parentElement ?? stack;
      const gap = parsePixels(getComputedStyle(slot).gap);
      const room = Math.ceil(measured.getBoundingClientRect().height) + gap;
      stack.style.setProperty("--preview-room", `${room}px`);
    };
    const observer = new ResizeObserver(report);
    observer.observe(measured);
    report();
    return () => observer.disconnect();
  }, [previewMounted]);

  // Whether a mounted preview has been asked away: the fade below normally
  // reports its own end, and that end is what gives the room back.
  const previewClosing =
    previewMounted && (preview === undefined || entry?.images[preview] === undefined);

  // A zero-duration property change runs no transition and fires no end event,
  // so under capture the fade's end would never come and the shape would stay
  // tall around an invisible image. Read the fade's own token the way
  // session-motion reads every duration: below STILL_MS the close is a request
  // for stillness, and the room goes back before the next frame paints.
  useLayoutEffect(() => {
    if (!previewClosing) return;
    const fading = previewButton.current;
    if (!fading) return;
    const exit = parseMilliseconds(getComputedStyle(fading).getPropertyValue("--duration-exit"));
    if (exit >= STILL_MS) return;
    setPreviewMounted(false);
    heldPreview.current = undefined;
  }, [previewClosing]);

  // The landing outlives the ask exactly as the entry does: the panel's
  // return clears it upstream a beat before the presentation actually moves,
  // and falling back to the held fields for those frames would flash the
  // just-sent form and jump the measured height. It keeps drawing what it
  // last held until the shape has left it behind — and a composer asked for
  // again is the landing's end, so a held entry takes the shape back.
  const heldLanding = useRef(confirming);
  if (confirming) heldLanding.current = confirming;
  if (control.entry) heldLanding.current = undefined;
  const landing = confirming ?? heldLanding.current;

  // The landing takes the fields' place in the same shell: same stage, same
  // hit region, same measured height — so the surface takes one clean spring
  // to the landing's own smaller shape and one back when the panel returns.
  // Inert throughout: there is nothing here to press, only something to see.
  if (landing) {
    return (
      <div className="feedback-stage" inert>
        <div className="feedback-slot" ref={measure} data-hit-region={HIT_REGION.FEEDBACK}>
          <FeedbackLanding key={landing.play} confirming={landing} still={still} />
        </div>
      </div>
    );
  }

  if (!entry) return null;

  const copy = FEEDBACK_COPY[entry.kind];
  const ready = isSendable(control.entry);
  // Read against what is actually drawn, so a removed image cannot leave the
  // preview pointing past the end of the list.
  const previewed = preview === undefined ? undefined : entry.images[preview];
  const previewOpen = previewed !== undefined;
  if (previewed) heldPreview.current = previewed;
  // Mounted during the render that opens it rather than from an effect, the
  // way an emptied filter is corrected: the reveal must be in the tree the
  // frame the open begins, or the spring has nothing to start from.
  if (previewOpen && !previewMounted) setPreviewMounted(true);
  const shownPreview = heldPreview.current;

  // The two keys every field answers the same way: Escape leaves the shape
  // with the draft intact — stopping propagation keeps the app's own Escape
  // handling from acting on a press a field answered — and Command-Enter
  // sends from wherever the caret happens to be.
  const fieldKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      control.dismiss();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready) control.commit();
  };

  const openPreview = (index: number) => {
    setPreview(index === preview ? undefined : index);
  };

  // The preview follows the image it shows, not an offset: removing the
  // previewed image closes the preview, and removing one above it moves the
  // index down so the same picture stays on screen.
  const removeImage = (index: number) => {
    if (preview !== undefined) {
      if (index === preview) setPreview(undefined);
      else if (index < preview) setPreview(preview - 1);
    }
    control.removeImage(index);
  };

  return (
    <div className="feedback-stage" aria-hidden={!live} inert={!live}>
      <div className="feedback-slot" ref={measure} data-hit-region={HIT_REGION.FEEDBACK}>
        <label className="settings-label" htmlFor={MESSAGE_FIELD_ID}>
          {copy.label}
        </label>
        <textarea
          id={MESSAGE_FIELD_ID}
          ref={field}
          className="settings-input feedback-message"
          placeholder={copy.placeholder}
          maxLength={FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH}
          value={entry.message}
          disabled={busy}
          onChange={(event) => control.changeMessage(event.target.value)}
          onFocus={() => {
            // The shape is shown without stealing focus, and a field that
            // cannot be typed into is worse than no field.
            window.sidecar.focusPanel();
          }}
          // Enter is a new line in a note this size; Command-Enter sends.
          onKeyDown={fieldKeys}
          onPaste={(event) => {
            // A screenshot on the clipboard is an attachment, not text that
            // failed to paste. Text on the clipboard pastes as it always does.
            const pasted = imageFiles(event.clipboardData?.files);
            if (pasted.length === 0) return;
            event.preventDefault();
            control.attach(pasted);
          }}
        />

        {/* Credit is the user's to claim, so both lines are plainly optional
            and the note below says what they are for. One row: one choice. */}
        <div className="feedback-credit">
          <input
            className="settings-input"
            aria-label="Your name (optional)"
            placeholder="Name (optional)"
            autoComplete="name"
            spellCheck={false}
            maxLength={FEEDBACK_LIMITS.NAME_MAX_LENGTH}
            value={entry.name}
            disabled={busy}
            onChange={(event) => control.changeName(event.target.value)}
            onFocus={() => window.sidecar.focusPanel()}
            onKeyDown={fieldKeys}
          />
          <input
            className="settings-input"
            type="email"
            aria-label="Your email (optional)"
            placeholder="Email (optional)"
            autoComplete="email"
            spellCheck={false}
            maxLength={FEEDBACK_LIMITS.EMAIL_MAX_LENGTH}
            value={entry.email}
            disabled={busy}
            onChange={(event) => control.changeEmail(event.target.value)}
            onFocus={() => window.sidecar.focusPanel()}
            onKeyDown={fieldKeys}
          />
        </div>

        <div className="feedback-images">
          {entry.images.map((image, index) => (
            <span className="feedback-image" key={`${image.name}-${String(index)}`}>
              {/* The chip is the way to look closer: a thumbnail is enough to
                  recognise a screenshot, and the preview below is where it can
                  actually be read. */}
              <button
                type="button"
                className="feedback-image-open"
                aria-label={`Preview ${image.name}`}
                aria-expanded={preview === index}
                title={image.name}
                disabled={busy}
                onClick={() => openPreview(index)}
              >
                <img src={feedbackImageUrl(image)} alt="" />
              </button>
              <button
                type="button"
                className="feedback-image-remove"
                aria-label={`Remove ${image.name}`}
                title="Remove"
                disabled={busy}
                onClick={() => removeImage(index)}
              >
                <RemoveIcon />
              </button>
            </span>
          ))}
          {entry.images.length < FEEDBACK_LIMITS.MAX_IMAGES ? (
            <button
              type="button"
              className="feedback-attach"
              disabled={busy}
              onClick={() => filePicker.current?.click()}
            >
              <ImageIcon />
              {entry.images.length === 0 ? "Add a screenshot" : "Add another"}
            </button>
          ) : null}
          <input
            ref={filePicker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const picked = imageFiles(event.currentTarget.files);
              if (picked.length > 0) control.attach(picked);
              // Cleared so the same file can be picked again after a removal.
              event.currentTarget.value = "";
            }}
          />
        </div>

        {/* The screenshot at a readable size, arriving the way content joins
            any growing shape: its room lands at once — one clean spring for
            the surface, no frame-by-frame chase — and the image fades and
            settles into it on the slot's own beat, so it only ever becomes
            visible over black. Leaving runs the other way round: the image is
            gone over `--duration-exit`, and only its end takes the room with
            it, so the shape never shrinks out from under a picture still on
            screen. The whole image is the way back out, and Escape is too. */}
        {previewMounted && shownPreview ? (
          <button
            type="button"
            ref={previewButton}
            className="feedback-preview"
            data-open={String(previewOpen)}
            aria-label={`Close the preview of ${shownPreview.name}`}
            aria-hidden={!previewOpen}
            inert={!previewOpen}
            onClick={() => setPreview(undefined)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              setPreview(undefined);
            }}
            onTransitionEnd={(event) => {
              // Only the fade-out ending takes the preview's room; an open
              // that finished leaves everything exactly where it is.
              if (event.propertyName !== "opacity" || previewOpen) return;
              setPreviewMounted(false);
              heldPreview.current = undefined;
            }}
          >
            <img src={feedbackImageUrl(shownPreview)} alt={shownPreview.name} />
          </button>
        ) : null}

        {/* Everything below the preview travels with its room: the layout has
            already moved these when a preview mounts or goes, and the follow
            animations replay that journey on the shape's own spring — so the
            send row rides down with the growing image instead of jumping to
            where it will end up. */}
        <div ref={followStack} className="feedback-follow" data-follow={String(previewMounted)}>
          <div className="settings-row feedback-foot">
            <span className="settings-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                onClick={() => control.cancel()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button feedback-send"
                disabled={!ready}
                onClick={() => control.commit()}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </span>
          </div>
          {entry.rejection ? (
            <p className="error-message" role="alert">
              {entry.rejection}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
