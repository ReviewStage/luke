import type { CredentialProviderId } from "@sidecar/credentials/vocabulary";
import type { ActResult } from "@sidecar/wire";
import { type RefObject, useEffect } from "react";
import type { CredentialSource } from "#shared/wire/account";
import { CREDENTIAL_SOURCE } from "#shared/wire/account";

/* One field, three jobs: what it is for depends on what is answering for the
   provider now, and a credential typed here always wins over one read
   elsewhere. The label above names what to paste, so these do not repeat it —
   and cannot, since not every provider calls it the same thing. Both places the
   field is drawn carry that label, so both can use these. */
export const CREDENTIAL_PLACEHOLDER = {
  [CREDENTIAL_SOURCE.NONE]: "Paste it here",
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "Paste one to use instead",
  [CREDENTIAL_SOURCE.ENCRYPTED_FILE]: "Replace what is stored",
} as const satisfies Record<CredentialSource, string>;

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
  /**
   * Begins the entry the way a Connect press asks for it: the field and the
   * page that issues the key, together. Someone connecting has no key yet, so
   * the browser goes to the provider's key page in the same press — the way
   * every consent and CLI connector already opens one — and the entry starts
   * already `away`. A replace stays on {@link begin}, because whoever is
   * rotating a key may already be holding the new one.
   */
  connect(providerId: CredentialProviderId): void;
  change(draft: string): void;
  /**
   * Sends the browser to the provider's key page and stands the panel down to
   * the slot, because Luke floats above the page holding the answer.
   */
  fetchKey(): void;
  cancel(): void;
  commit(): void;
  /** Clears a stored key. Answers why if it could not. */
  remove(providerId: CredentialProviderId): Promise<ActResult>;
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

/**
 * Whether deleting a provider's key also ends the entry in progress. A key that
 * has been removed cannot be replaced, so the entry that was going to replace it
 * goes with it — otherwise a field is left open over nothing, holding the panel
 * against the pointer for a replacement nobody is making. A delete that was
 * refused changes nothing, so it ends nothing.
 */
export function removalEndsEntry(
  entry: CredentialEntry | undefined,
  providerId: CredentialProviderId,
  rejection: string | undefined,
): boolean {
  return rejection === undefined && entry?.providerId === providerId;
}

/** Long enough for any stage to arrive, and short enough to be a backstop. */
export const FOCUS_FRAME_LIMIT = 60;

/**
 * Hands focus to an element as soon as it can take it, and answers with the way
 * to stop waiting.
 *
 * Everything the panel draws around a credential sits in a staged surface that
 * is `visibility: hidden` until its arrival delay has passed, and a hidden
 * element refuses focus outright — so asking on the frame the shape changes
 * silently does nothing. This waits for the stage rather than guessing at its
 * delay, which keeps the timing in the stylesheet where the rest of the motion
 * lives.
 */
export function focusWhenVisible(element: HTMLElement | null): () => void {
  let frame = 0;
  let frames = 0;
  const takeFocus = () => {
    if (!element) return;
    if (getComputedStyle(element).visibility !== "visible") {
      if (frames++ > FOCUS_FRAME_LIMIT) return;
      frame = requestAnimationFrame(takeFocus);
      return;
    }
    element.focus({ preventScroll: true });
  };
  takeFocus();
  return () => cancelAnimationFrame(frame);
}

/**
 * Keeps focus on an element for as long as holding it is what that element is
 * for.
 *
 * A control that goes disabled hands focus out and does not take it back, so
 * `active` falls while a credential is being written and rises again with the
 * refusal that re-opens the field — which is what puts someone straight back to
 * correcting the credential rather than clicking to get there.
 */
export function useStagedFocus<Element extends HTMLElement>(
  target: RefObject<Element | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    return focusWhenVisible(target.current);
  }, [active, target]);
}
