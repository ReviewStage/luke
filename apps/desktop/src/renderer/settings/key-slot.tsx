import type { CredentialSource } from "@sidecar/credentials/vocabulary";
import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDERS,
  providerRunsSessionsInCloud,
} from "@sidecar/credentials/vocabulary";
import { CloudBadge, ProviderMark } from "@sidecar/panel";
import { useRef } from "react";
import { CREDENTIAL_PLACEHOLDER, type CredentialEntryControl } from "../credential-entry";
import { HIT_REGION } from "../panel-state";
import { SecretSlot } from "./secret-slot";

/**
 * The panel stood down to a provider's key.
 *
 * Asking to write a key is asking for one thing, so the panel gets out of the
 * way of its own field: the slot is narrow enough to leave the page the key is
 * copied from readable, and it stays put — nothing the pointer does dismisses
 * it. What it draws is the one secret field every entry wears, in this
 * provider's own words.
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
  const held = useRef(control.entry);
  const heldSource = useRef(source);
  // The slot has to outlive the entry that filled it: emptying the field on the
  // frame the credential is saved would leave a blank pill on screen for as
  // long as the shape takes to grow back into the panel. It keeps drawing what
  // it last held until the shape has left it behind — and that is everything it
  // draws, not only the entry. Where the credential came from decides what the
  // field says it is for, and it stops answering for a provider the moment the
  // entry does, so it is held with it rather than read live.
  if (control.entry) {
    held.current = control.entry;
    heldSource.current = source;
  }
  const entry = held.current;
  const live = drawn && control.entry !== undefined;

  if (!entry) return null;

  const provider = CREDENTIAL_PROVIDERS[entry.providerId];
  if (provider.connection !== CREDENTIAL_CONNECTION.KEY) return null;

  const credential = provider.keyFormat?.label ?? "API key";

  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!live} inert={!live}>
      {/* No grouping role: the field names the provider itself, and everything
          beside it acts on that one field. */}
      <div className="key-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        <SecretSlot
          label={credential}
          /* An agent provider's mark keeps the cloud badge its session rows
             wear, and a service Luke merely uses — OpenAI — stands
             bare, because the same mark cannot differ between the line and the
             slot it opens. */
          mark={
            <>
              <ProviderMark providerId={provider.id} />
              {providerRunsSessionsInCloud(provider.id) ? <CloudBadge /> : null}
            </>
          }
          ariaLabel={`${provider.displayName} ${credential}`}
          entry={entry}
          live={live}
          placeholder={CREDENTIAL_PLACEHOLDER[heldSource.current]}
          {...(provider.hint ? { hint: provider.hint } : undefined)}
          verb="Save"
          running="Saving…"
          onChange={control.change}
          onCommit={control.commit}
          onCancel={control.cancel}
          onFetch={control.fetchKey}
        />
      </div>
    </div>
  );
}
