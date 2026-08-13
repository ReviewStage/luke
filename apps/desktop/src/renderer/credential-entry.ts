import { type RefObject, useEffect } from "react";
import type { CredentialSource } from "../shared/contracts";
import { CREDENTIAL_SOURCE } from "../shared/contracts";
import type { CredentialProviderId } from "../shared/credential-providers";

/**
 * What the slot's field is for, in a sentence that names the credential.
 *
 * The settings row keys its placeholder to a visible label above the field, so
 * its wording does not repeat what that label already says. The slot has no
 * label — the field is the whole shape — so the sentence has to carry the name
 * itself, and not every provider calls it the same thing.
 */
export function slotPlaceholder(source: CredentialSource, credential: string): string {
  if (source === CREDENTIAL_SOURCE.ENCRYPTED_FILE) return `Replace the stored ${credential}`;
  if (source === CREDENTIAL_SOURCE.ENVIRONMENT) {
    return `Paste a ${credential} to use instead of the one from the environment`;
  }
  return `Paste your ${credential}`;
}

/**
 * A key being entered, wherever it happens to be drawn. Entering one outlives
 * the panel that started it: the field is a row in settings while the panel is
 * open and the slot under the notch while someone is off in a browser fetching
 * the key, and it is the same entry either way — the same draft, the same
 * provider, the same refusal if it comes to that.
 *
 * The credential only ever travels outward. Nothing here is ever filled in from
 * stored state: the main process never sends a key back, only where it resolved
 * one from.
 */
export interface CredentialEntry {
  providerId: CredentialProviderId;
  /** What has been typed or pasted so far. Empty until it has been. */
  draft: string;
  /** True while the key is being written. */
  busy: boolean;
  /**
   * True once the provider's key page has been opened. It is the difference
   * between someone standing in front of Luke and someone reading a browser, so
   * it decides where giving up returns them to.
   */
  away: boolean;
  /** Why the last attempt was refused, if it was. */
  rejection?: string;
}

/**
 * The one way to act on a key. Both the settings row and the slot are views of
 * this: neither holds a draft of its own, so moving between them keeps whatever
 * was half-typed.
 */
export interface CredentialEntryControl {
  entry?: CredentialEntry;
  /** Opens a field for a provider, replacing whatever was being entered. */
  begin(providerId: CredentialProviderId): void;
  change(draft: string): void;
  /**
   * Sends the browser to the provider's key page and stands the panel down to
   * the slot, because Luke floats above the page holding the answer.
   */
  fetchKey(): void;
  cancel(): void;
  commit(): void;
  /** Clears a stored key. Answers why if it could not. */
  remove(providerId: CredentialProviderId): Promise<string | undefined>;
}

/** The entry for one provider, or nothing if another provider holds it. */
export function entryForProvider(
  control: CredentialEntryControl,
  providerId: CredentialProviderId,
): CredentialEntry | undefined {
  return control.entry?.providerId === providerId ? control.entry : undefined;
}

/** A draft worth sending: whitespace is not a key, and neither is one in flight. */
export function isSubmittable(entry: CredentialEntry | undefined): entry is CredentialEntry {
  return entry !== undefined && !entry.busy && entry.draft.trim().length > 0;
}

/** Long enough for any stage to arrive, and short enough to be a backstop. */
const CARET_FRAME_LIMIT = 60;

/**
 * Puts the caret in a field as soon as the field can hold it.
 *
 * Both places an entry is drawn sit in a staged surface that is `visibility:
 * hidden` until its arrival delay has passed, and a hidden element refuses
 * focus outright — so asking on the frame the shape changes silently does
 * nothing. This waits for the stage rather than guessing at its delay, which
 * keeps the timing in the stylesheet where the rest of the motion lives.
 */
export function useFieldCaret(field: RefObject<HTMLInputElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let frames = 0;
    const takeCaret = () => {
      const element = field.current;
      if (!element) return;
      if (getComputedStyle(element).visibility !== "visible") {
        if (frames++ > CARET_FRAME_LIMIT) return;
        frame = requestAnimationFrame(takeCaret);
        return;
      }
      element.focus({ preventScroll: true });
    };
    takeCaret();
    return () => cancelAnimationFrame(frame);
  }, [active, field]);
}
