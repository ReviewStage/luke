import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  AccountWords,
  MoreButton,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
  TextButton,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * account-words.tsx -- an account's name beside its provider's: two accounts
 * at one provider, a lone named one, a long address cut short, an expired
 * one mended on its line, and a provider that names none, as Settings › Integrations draws
 * them, at a settings page's measure and narrower than 380px.
 */

type Provider = (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER];

interface Account {
  readonly key: string;
  readonly provider: Provider;
  readonly name: string;
  readonly account?: string;
  readonly expired?: boolean;
}

const ACCOUNTS: readonly Account[] = [
  {
    key: "gmail",
    provider: INTEGRATION_PROVIDER.GMAIL,
    name: "Gmail",
    account: "ada@analytical-engine.example",
  },
  {
    key: "gmail-2",
    provider: INTEGRATION_PROVIDER.GMAIL,
    name: "Gmail",
    account: "ada.lovelace@mailbox.example",
  },
  {
    key: "granola",
    provider: INTEGRATION_PROVIDER.GRANOLA,
    name: "Granola",
    account: "augusta.ada.king-noel@countess-of-lovelace-correspondence.example",
  },
  {
    key: "linear",
    provider: INTEGRATION_PROVIDER.LINEAR,
    name: "Linear",
    account: "Analytical Engine",
  },
  {
    key: "slack",
    provider: INTEGRATION_PROVIDER.SLACK,
    name: "Slack",
    account: "Analytical Engine",
    expired: true,
  },
  { key: "supabase", provider: INTEGRATION_PROVIDER.SUPABASE, name: "Supabase" },
];

function Rows(): React.JSX.Element {
  return (
    <SettingsSection title="Connected">
      {ACCOUNTS.map((row) => (
        <SettingsRow
          key={row.key}
          label={row.name}
          adornment={
            row.account === undefined ? undefined : <AccountWords>{row.account}</AccountWords>
          }
          leading={
            <SettingsRowMark>
              <ProviderMark provider={row.provider} />
            </SettingsRowMark>
          }
          description={
            row.expired ? (
              <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION} wrap>
                {"Sign-in expired · "}
                <TextButton aria-label={`Reconnect ${row.name}`} onClick={() => undefined}>
                  Reconnect
                </TextButton>
              </SettingsRowStateLine>
            ) : (
              <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
                Connected · 12 tools
              </SettingsRowStateLine>
            )
          }
        >
          {() => (row.expired ? null : <MoreButton thing={row.name} />)}
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

function AccountWordsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="account-words-wide" title="Beside a settings row's name">
        <div className="catalog-settings">
          <Rows />
        </div>
      </CatalogSection>
      <CatalogSection id="account-words-narrow" title="Narrower than 380px">
        <div className="catalog-settings catalog-settings-narrow">
          <Rows />
        </div>
      </CatalogSection>
    </>
  );
}

export const ACCOUNT_WORDS_EXAMPLE: Example = {
  id: "account-words",
  title: "Account words",
  Render: AccountWordsExample,
};
