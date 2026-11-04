import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import {
  BUTTON_VARIANT,
  Button,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
} from "@repo/ui";
import { useIntegrationGrant } from "../integration-grant.js";
import { useIntegrationStatuses } from "../integration-statuses.js";

/**
 * setup-tools.tsx -- setup's tools step: the integrations a first day's tasks most often come from, each connected by its own sign-in in the browser.
 *
 * The rows draw from the window's one book of integrations, so a sign-in
 * finished in the browser lands here as it does in Settings › Integrations.
 */

/** The tools setup offers, in its order. */
const TOOLS: readonly IntegrationProvider[] = [
  INTEGRATION_PROVIDER.LINEAR,
  INTEGRATION_PROVIDER.SLACK,
  INTEGRATION_PROVIDER.SENTRY,
  INTEGRATION_PROVIDER.NOTION,
];

/** Setup's tools step. */
export function ToolRows(): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const grant = useIntegrationGrant(statuses);
  return (
    <SettingsSection>
      {TOOLS.map((provider) => {
        const name = INTEGRATION_NAME[provider];
        const status = statuses.statusOf(provider);
        const connected = status === INTEGRATION_STATUS.CONNECTED;
        const pending = status === INTEGRATION_STATUS.PENDING;
        return (
          <SettingsRow
            key={provider}
            leading={
              <SettingsRowMark>
                <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ROW} />
              </SettingsRowMark>
            }
            label={name}
            description={
              connected ? (
                <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                  Connected
                </SettingsRowStateLine>
              ) : pending ? (
                "Finish in your browser"
              ) : undefined
            }
          >
            {() =>
              connected ? null : (
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  label={`Connect ${name}`}
                  onClick={() => void grant.begin(provider)}
                >
                  Connect
                </Button>
              )
            }
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
}
