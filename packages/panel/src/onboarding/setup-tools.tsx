import { connectionHealth } from "@repo/features/integration-health";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import {
  ErrorState,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
} from "@repo/ui";
import { namedServers, serverRows } from "@repo/ui/agent-servers-model";
import { unreadShown } from "../failure-report.js";
import { IntegrationRow } from "../integration-row.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { useIntegrationToolReads } from "../integration-tools.js";

/**
 * setup-tools.tsx -- setup's tools step: the integrations a first day's tasks most often come from, each connected by its own sign-in in the browser.
 *
 * Each row is Settings › Integrations' own (`../integration-row.tsx`), drawn
 * from the window's one book of integrations, so a sign-in finished in the
 * browser lands here as it does there: a connected account is named beside
 * its provider ("Notion · Acme"), a sign-in waits with Reopen and Cancel, and
 * one that failed says why with Try again. The rows stand in setup's order,
 * a provider's accounts together in theirs, and a provider this deployment
 * does not offer has none.
 */

/** What setup says the tools step is for. */
export const TOOLS_PURPOSE =
  "Agents read and update these with your own access. Change them anytime in Settings.";

/** The tools setup offers, in its order. */
const TOOLS: readonly IntegrationProvider[] = [
  INTEGRATION_PROVIDER.LINEAR,
  INTEGRATION_PROVIDER.SLACK,
  INTEGRATION_PROVIDER.SENTRY,
  INTEGRATION_PROVIDER.NOTION,
];

/** The provider a server name that parses as none would be drawn as; never reached. */
const FIRST_TOOL = INTEGRATION_PROVIDER.LINEAR;

/** What the rows look like while where they stand is read: each a provider not yet connected, its mark and Connect. */
const TOOLS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: false,
    rows: TOOLS.map(() => ({
      described: false,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
    })),
  },
];

/** Setup's tools step. */
export function ToolRows(): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const { reads, retry } = useIntegrationToolReads(
    namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    })
      .filter((server) => TOOLS.includes(server.provider))
      .map((server) => server.connection),
  );
  const read = TOOLS.some((provider) => statuses.statusOf(provider) !== undefined);
  if (!read && !statuses.readFailed) {
    return (
      <SettingsSectionsSkeleton
        label={readingWords("the integrations")}
        sections={TOOLS_SKELETON}
      />
    );
  }
  // Note that every server here is named from one of setup's tools, so the first stands in only for a name that parses as none.
  const healthOf = (server: string) =>
    connectionHealth(integrationConnectionOf(server)?.provider ?? FIRST_TOOL, reads[server]);
  const rows = serverRows({
    statusOf: statuses.statusOf,
    healthOf,
    signInOf: statuses.signInOf,
    accountsOf: statuses.accountsOf,
    readFailed: statuses.readFailed,
    disabled: [],
  })
    .filter((row) => TOOLS.includes(row.provider))
    .toSorted((one, other) => TOOLS.indexOf(one.provider) - TOOLS.indexOf(other.provider));
  return (
    <SettingsSection>
      {statuses.readFailed ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.INTEGRATIONS_READ)}
            onRetry={() => void statuses.read()}
          >
            Your tools could not be read.
          </ErrorState>
        </SettingsLine>
      ) : null}
      {rows.map((row) => (
        <IntegrationRow
          key={row.connection}
          row={row}
          status={statuses.statusOf(row.connection)}
          health={healthOf(row.connection)}
          statuses={statuses}
          onRetryTools={() => retry(row.connection)}
        />
      ))}
    </SettingsSection>
  );
}
