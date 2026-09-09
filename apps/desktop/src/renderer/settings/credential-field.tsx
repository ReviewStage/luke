import type { CredentialProvider, CredentialSource } from "@sidecar/credentials/vocabulary";
import { useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "../act";
import {
  CREDENTIAL_PLACEHOLDER,
  type CredentialEntry,
  type CredentialEntryControl,
  isSubmittable,
  useStagedFocus,
} from "../credential-entry";
import { DestinationNote } from "../destination-note";

/**
 * The panel's own field for a provider's key, drawn inside the credential
 * block rather than in the slot: asking to write one stands the panel down to
 * the slot, so this is what the panel shows when it is brought back around an
 * entry that is still open.
 *
 * Named as a group, because Cancel, Save, and the link to the provider's own
 * page are the same three words on every row.
 */
export function CredentialField({
  provider,
  credential,
  source,
  entry,
  control,
  panelOpen,
}: {
  provider: CredentialProvider;
  /** What to paste, in the provider's own word for it. */
  credential: string;
  /** Where the credential comes from now, which is what the placeholder says. */
  source: CredentialSource;
  entry: CredentialEntry;
  control: CredentialEntryControl;
  /** True while the panel is the shape on screen, which is when a field can hold the caret. */
  panelOpen: boolean;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const fieldId = `${provider.id}-api-key`;
  const busy = entry.busy;

  // The field takes the caret whenever the panel is the shape around it: coming
  // back to a panel mid-entry — pressing the capsule while the slot holds the
  // credential — hands focus out of an inert stage on the way, and returns
  // someone who was in the middle of typing.
  useStagedFocus(field, panelOpen && !busy);

  return (
    <fieldset className="credential-editor" aria-label={`${provider.displayName} ${credential}`}>
      <label className="settings-field" htmlFor={fieldId}>
        {/* The provider is named on the line above, so the visible label does
            not repeat it — but a reader hearing the field alone still needs to
            know whose key it is. */}
        <span className="settings-label">{credential}</span>
        <input
          id={fieldId}
          ref={field}
          aria-label={`${provider.displayName} ${credential}`}
          className="settings-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={CREDENTIAL_PLACEHOLDER[source]}
          value={entry.draft}
          disabled={busy}
          onChange={(event) => control.change(event.target.value)}
          onFocus={() => {
            // The panel can be showing without its window being key, and a
            // field that cannot be typed into is worse than no field.
            tell(ACT_KIND.WINDOW_FOCUS_PANEL);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isSubmittable(entry)) control.commit();
            // Escape closes the editor rather than the panel behind it.
            if (event.key === "Escape") {
              event.stopPropagation();
              control.cancel();
            }
          }}
        />
      </label>
      <div className="settings-row">
        {provider.hint ? (
          <DestinationNote {...provider.hint} disabled={busy} onOpen={() => control.fetchKey()} />
        ) : null}
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
            className="action-button"
            disabled={busy || !isSubmittable(entry)}
            onClick={() => control.commit()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </fieldset>
  );
}
