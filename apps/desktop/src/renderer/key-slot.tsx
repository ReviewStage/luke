import { useEffect, useRef } from "react";
import type { CredentialSource } from "../shared/contracts";
import { CREDENTIAL_PROVIDERS } from "../shared/credential-providers";
import {
  type CredentialEntryControl,
  isSubmittable,
  slotPlaceholder,
  useFieldCaret,
} from "./credential-entry";
import { HIT_REGION } from "./panel-state";
import { ProviderMark } from "./provider-marks";
import { ExternalIcon } from "./settings-icons";

/**
 * The panel stood down to the one thing anyone entering a key needs: somewhere
 * to paste it, and the way to go and get one.
 *
 * Asking to write a key is asking for one thing, and Luke floats above every
 * window — including the page the key has to be copied from. So the panel gets
 * out of the way of its own field: the slot is narrow enough to leave that page
 * readable and it stays put — nothing the pointer does dismisses it — because a
 * key on the clipboard is only worth as much as the place to put it. The
 * provider's mark comes along so the field is never anonymous, and the confirm
 * is quiet until there is something to confirm.
 */
export function KeySlot({
  control,
  source,
  drawn,
  measure,
}: {
  control: CredentialEntryControl;
  /** Where the provider's key comes from now, which is what the field is for. */
  source: CredentialSource;
  /** True while the slot is the shape the surface is drawn as. */
  drawn: boolean;
  /** Reports the slot's height, so the surface can end where it does. */
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element | null {
  const field = useRef<HTMLInputElement | null>(null);
  const held = useRef(control.entry);
  // The slot has to outlive the entry that filled it: emptying the field on the
  // frame the key is saved would leave a blank pill on screen for as long as the
  // shape takes to grow back into the panel. It keeps drawing what it last held
  // until the shape has left it behind.
  if (control.entry) held.current = control.entry;
  const entry = held.current;

  useFieldCaret(field, drawn);

  useEffect(() => {
    if (!drawn) return;
    // Coming back from the browser with a key on the clipboard should cost one
    // gesture, not two: however the window is raised, the caret is already where
    // the key goes. The slot is long since drawn by then, so this can ask
    // directly.
    const takeCaret = () => field.current?.focus({ preventScroll: true });
    window.addEventListener("focus", takeCaret);
    return () => window.removeEventListener("focus", takeCaret);
  }, [drawn]);

  if (!entry) return null;

  const provider = CREDENTIAL_PROVIDERS[entry.providerId];
  // Most providers issue an API key; one issues something it calls by another
  // name, and the slot says which without a label to say it for them.
  const credential = provider.keyFormat?.label ?? "API key";
  // Holding a key is what brings the confirm out; being able to send it is what
  // makes it pressable. They differ while one is being written, and the button
  // has to stay on screen to say so.
  const filled = entry.draft.trim().length > 0;
  const ready = isSubmittable(entry);

  return (
    <div className="slot-stage" aria-hidden={!drawn} inert={!drawn}>
      {/* No grouping role: the field names the provider itself, and everything
          beside it acts on that one field. */}
      <div className="key-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        <div className="key-slot-row">
          {/* Whose key this is, said the way the panel says it. */}
          <ProviderMark providerId={provider.id} className="key-slot-mark" />
          <input
            ref={field}
            className="settings-input key-slot-input"
            type="password"
            aria-label={`${provider.displayName} ${credential}`}
            autoComplete="off"
            spellCheck={false}
            placeholder={slotPlaceholder(source, credential)}
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
          <small className="settings-note">
            {provider.hint}{" "}
            {/* A button, not an anchor: the renderer has no browser to navigate,
                and the main process opens the page by provider rather than by an
                address the panel supplies. This is what the slot is standing
                aside for, so it does not move the shape again. */}
            <button type="button" className="link-button" onClick={() => control.fetchKey()}>
              Where to get one
              <ExternalIcon />
            </button>
          </small>
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
        {entry.rejection ? <p className="error-message">{entry.rejection}</p> : null}
      </div>
    </div>
  );
}
