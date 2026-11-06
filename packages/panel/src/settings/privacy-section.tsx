import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { formatInstant } from "@repo/features/time-format";
import { ACT_KIND } from "@repo/host/acts";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { BUTTON_VARIANT, Button, SettingsRow, SettingsSection } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { pressMutation } from "../act-mutations.js";
import { appStateQuery, selectAccess, selectAccount } from "../use-app-state.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

const SUPPORT_ACCESS_MEANING = `A ${PRODUCT_NAME} maintainer may sign in as you, for up to an hour at a time, to help.`;

function SupportAccessRow(): React.JSX.Element {
  const access = useQuery({ ...appStateQuery, select: selectAccess }).data;
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const until = access?.supportAccessUntil;
  const granted = until !== undefined && until > Date.now();
  const impersonated = account?.status === ACCOUNT_STATUS.SIGNED_IN && account.impersonated;
  const supportAccess = useMutation(pressMutation(ACT_KIND.ACCOUNT_SUPPORT_ACCESS));
  const press = {
    busy: supportAccess.isPending,
    onPress: () => supportAccess.mutate({ grant: !granted }),
  };
  return (
    <SettingsRow
      label="Support access"
      description={
        granted
          ? `Granted until ${formatInstant(until)}. ${SUPPORT_ACCESS_MEANING}`
          : `${SUPPORT_ACCESS_MEANING} A grant lasts seven days, and you can revoke it at any time.`
      }
    >
      {() =>
        granted ? (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={press.busy}
            busyLabel="Revoking"
            onClick={press.onPress}
          >
            Revoke
          </Button>
        ) : impersonated || access === undefined || access.pending === true ? null : (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={press.busy}
            busyLabel="Granting"
            onClick={press.onPress}
          >
            Grant for 7 days
          </Button>
        )
      }
    </SettingsRow>
  );
}

export function PrivacySection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Privacy">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.PRIVACY}
        view={view}
      />
      <SupportAccessRow />
    </SettingsSection>
  );
}
