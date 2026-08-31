import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDERS,
  providerRunsSessionsInCloud,
} from "@sidecar/credentials/vocabulary";
import { CloudBadge, ProviderMark } from "@sidecar/panel";
import { useEffect, useRef } from "react";
import type { CredentialSource } from "#shared/wire/account";
import {
  CREDENTIAL_PLACEHOLDER,
  type CredentialEntryControl,
  isSubmittable,
  useStagedFocus,
} from "./credential-entry";
import { DestinationNote } from "./destination-note";
import { HIT_REGION } from "./panel-state";

/**
 * The panel stood down to the one thing anyone entering a key needs: somewhere
 * to paste it, and the way to go and get one.
 *
 * Asking to write a key is asking for one thing, and Luke floats above every
 * window — including the page the key has to be copied from. So the panel gets
 * out of the way of its own field: the slot is narrow enough to leave that page
 * readable and it stays put — nothing the pointer does dismisses it — because a
 * credential on the clipboard is only worth as much as the place to put it. The
 * provider's mark comes along so the field is never anonymous, the label says
 * what to paste in the provider's own word for it, and the confirm is quiet
 * until there is something to confirm.
 */
export function KeySlot({
  control,
  source,
  drawn,
  measure,
}: {
  control: CredentialEntryControl;
  /**
   * Where the entered provider's credential comes from now, which is what the
   * field is for. It is read while an entry is live and held with it after, so
   * an exit finishes saying what it was saying.
   */
  source: CredentialSource;
  /** True while the slot is the shape the surface is drawn as. */
  drawn: boolean;
  /** Reports the slot's height, so the surface can end where it does. */
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element | null {
  const field = useRef<HTMLInputElement | null>(null);
  const held = useRef(control.entry);
  const heldSource = useRef(source);
  // The slot has to outlive the entry that filled it: emptying the field on the
  // frame the credential is saved would leave a blank pill on screen for as long
  // as the shape takes to grow back into the panel. It keeps drawing what it
  // last held until the shape has left it behind — and that is everything it
  // draws, not only the entry. Where the credential came from decides what the
  // field says it is for, and it stops answering for a provider the moment the
  // entry does, so it is held with it rather than read live.
  if (control.entry) {
    held.current = control.entry;
    heldSource.current = source;
  }
  const entry = held.current;
  // Drawn and live are not the same thing for the length of an exit: what is on
  // screen is what it last held, but there is nothing behind it to act on any
  // more, so it stops taking the caret and stops answering at the same moment
  // the entry ends rather than when the shape finally goes.
  const live = drawn && control.entry !== undefined;

  useStagedFocus(field, live && !control.entry?.busy);

  useEffect(() => {
    if (!live) return;
    // Coming back from the browser with a key on the clipboard should cost one
    // gesture, not two: however the window is raised, the caret is already where
    // the key goes. The slot is long since drawn by then, so this can ask
    // directly.
    const takeCaret = () => field.current?.focus({ preventScroll: true });
    window.addEventListener("focus", takeCaret);
    return () => window.removeEventListener("focus", takeCaret);
  }, [live]);

  if (!entry) return null;

  const provider = CREDENTIAL_PROVIDERS[entry.providerId];
  if (provider.connection !== CREDENTIAL_CONNECTION.KEY) return null;

  const credential = "keyFormat" in provider ? (provider.keyFormat?.label ?? "API key") : "API key";
  // Holding a key is what brings the confirm out; being able to send it is what
  // makes it pressable. They differ while one is being written, and the button
  // has to stay on screen to say so.
  const filled = entry.draft.trim().length > 0;
  const ready = isSubmittable(entry);

  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!live} inert={!live}>
      {/* No grouping role: the field names the provider itself, and everything
          beside it acts on that one field. */}
      <div className="key-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        {/* What to paste, in the provider's own word for it. The line this
            opened from labels its field the same way, and the placeholder
            beneath is the one both share, so neither has to repeat the other. */}
        <span className="settings-label key-slot-label">{credential}</span>
        <div className="key-slot-row">
          {/* Whose key this is, said exactly the way the settings line says
              it: an agent provider's mark keeps the cloud badge its session
              rows wear, and a service Luke merely uses — Linear, OpenAI —
              stands bare, because the same mark cannot differ between the
              line and the slot it opens. */}
          <span className="key-slot-mark">
            <ProviderMark providerId={provider.id} />
            {providerRunsSessionsInCloud(provider.id) ? <CloudBadge /> : null}
          </span>
          <input
            ref={field}
            className="settings-input key-slot-input"
            type="password"
            aria-label={`${provider.displayName} ${credential}`}
            autoComplete="off"
            spellCheck={false}
            placeholder={CREDENTIAL_PLACEHOLDER[heldSource.current]}
            value={entry.draft}
            disabled={entry.busy}
            onChange={(event) => control.change(event.target.value)}
            onFocus={() => {
              // The slot is shown without stealing focus, and a field that
              // cannot be typed into is worse than no field.
              window.sidecar.focusPanel();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && ready) control.commit();
              // Escape belongs to the entry here: there is no panel behind the
              // slot to close.
              if (event.key === "Escape") {
                event.stopPropagation();
                control.cancel();
              }
            }}
          />
        </div>
        {/* The panel's own editor, at the slot's width: what it takes on one
            line, where to go and get it on the next. Making the field the whole
            width is not a flourish — the sentence it holds is the same one the
            panel's field holds, and it has to fit. */}
        <div className="settings-row key-slot-foot">
          {/* Opening the key page is what the slot is standing aside for, so
              the press does not move the shape again. */}
          {provider.hint ? (
            <DestinationNote
              {...provider.hint}
              disabled={entry.busy}
              onOpen={() => control.fetchKey()}
            />
          ) : null}
          <span className="settings-actions">
            <button
              type="button"
              className="quiet-button"
              disabled={entry.busy}
              onClick={() => control.cancel()}
            >
              Cancel
            </button>
            {/* The same words the panel's own editor uses, because it is the
                same entry — only the place it is drawn has changed. It is quiet
                and small until the key lands in the field, and comes up to size
                and into the accent when it does; its place on the line never
                moves, so nothing else on the line moves either. */}
            <button
              type="button"
              className="action-button key-slot-confirm"
              data-ready={String(filled)}
              disabled={!ready}
              onClick={() => control.commit()}
            >
              {entry.busy ? "Saving…" : "Save"}
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
  );
}
