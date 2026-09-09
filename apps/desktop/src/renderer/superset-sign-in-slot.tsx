import { CREDENTIAL_SOURCE } from "@sidecar/credentials/vocabulary";
import { ExternalIcon, ProviderMark } from "@sidecar/panel";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import { useEffect, useState } from "react";
import type { SupersetSignInSnapshot } from "#shared/messages/session";
import { SUPERSET_SIGN_IN_STAGE } from "#shared/messages/session";
import { CREDENTIAL_PLACEHOLDER } from "./credential-entry";
import { HIT_REGION } from "./panel-state";
import { SecretSlot } from "./settings/secret-slot";

/**
 * The panel stood down to Superset's sign-in code, on the key slot's exact
 * terms: to anyone standing in front of Luke, a one-time code and an API key
 * are the same errand with a different word on it, so the code wears the same
 * `SecretSlot` a key does. Only the stages a key never has — choosing an
 * organization, the switch that choice starts, a sign-in that failed — keep
 * the waiting popups' one-line dress, worded the way the consent slot words
 * them: an organization switch asks for no code, so it never wears the field.
 */
export function SupersetSignInSlot({
  state,
  drawn,
  onSubmit,
  onReopen,
  onCancel,
  onRetry,
  onChooseOrganization,
  measure,
}: {
  state: SupersetSignInSnapshot;
  drawn: boolean;
  onSubmit: (code: string) => void;
  onReopen: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onChooseOrganization: (slug: string) => void;
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element {
  const [code, setCode] = useState("");
  useEffect(() => {
    if (state.stage !== SUPERSET_SIGN_IN_STAGE.BROWSER_CODE) setCode("");
  }, [state.stage]);

  const waiting = state.stage === SUPERSET_SIGN_IN_STAGE.BROWSER_CODE;
  const exchanging = state.stage === SUPERSET_SIGN_IN_STAGE.EXCHANGING;
  const failed = state.stage === SUPERSET_SIGN_IN_STAGE.FAILURE;
  const choosing = state.stage === SUPERSET_SIGN_IN_STAGE.ORGANIZATION;
  const switching = state.stage === SUPERSET_SIGN_IN_STAGE.SWITCHING;

  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!drawn} inert={!drawn}>
      <div className="key-slot sign-in-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        {waiting || exchanging ? (
          <SecretSlot
            label="Sign-in code"
            mark={<ProviderMark providerId={SUPERSET_WORKSPACE_PROVIDER_ID} />}
            ariaLabel="Superset sign-in code"
            entry={{ draft: code, busy: exchanging }}
            live={drawn && waiting}
            placeholder={CREDENTIAL_PLACEHOLDER[CREDENTIAL_SOURCE.NONE]}
            /* The key hints' own sentence shape: the main process reopens the
               page the waiting flow built, and no address crosses from here. */
            hint={{
              lead: "Superset shows a one-time code at the end of",
              destination: "its sign-in page",
            }}
            verb="Connect"
            running="Connecting…"
            onChange={setCode}
            onCommit={() => onSubmit(code)}
            onCancel={onCancel}
            onFetch={onReopen}
          />
        ) : null}
        {choosing || switching || failed ? (
          <div className="key-slot-row">
            <span className="key-slot-mark">
              <ProviderMark providerId={SUPERSET_WORKSPACE_PROVIDER_ID} />
            </span>
            <span className="sign-in-slot-copy" role="status">
              <strong>
                {failed
                  ? "Not connected"
                  : switching
                    ? "Connecting…"
                    : "Choose a Superset organization"}
              </strong>
              {failed ? (
                <small>
                  {state.failure}{" "}
                  {/* The settings row's word for redoing the sign-in, dressed
                      like the way back to a lost tab: retrying opens
                      Superset's page again. */}
                  <button type="button" className="link-button" onClick={onRetry}>
                    Sign in again
                    <ExternalIcon />
                  </button>
                </small>
              ) : null}
            </span>
            <button type="button" className="quiet-button" onClick={onCancel}>
              {failed ? "Close" : "Cancel"}
            </button>
          </div>
        ) : null}
        {choosing ? (
          <div className="superset-organization-list">
            {state.organizations.map((organization) => (
              <button
                key={organization.id}
                type="button"
                className="quiet-button"
                onClick={() => onChooseOrganization(organization.slug)}
              >
                {organization.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
