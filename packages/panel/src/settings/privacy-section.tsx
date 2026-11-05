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
import { pressAct } from "../act.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { useBusyPress } from "./busy-press.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * privacy-section.tsx -- whether this copy of the app shares its usage data, and whether a maintainer may sign in as the member to help, the Profile page's Privacy group under Links.
 *
 * The switch is kept on this device, but the counts it stops are sent under
 * the account, so it stands on Profile beside what is the account's. The
 * grant of support access is the account's on the service, read on its
 * access and written through the host under the account's own session.
 */

/** What granting means, said beside the row whether or not it stands. */
const SUPPORT_ACCESS_MEANING = `A ${PRODUCT_NAME} maintainer may sign in as you, for up to an hour at a time, to help.`;

/**
 * The member's grant of support access: whether it stands and until when,
 * and the one press that turns it, granting it for seven days or revoking
 * it. Either acts on the press, since the row's other press turns it back.
 * A grant is not offered while a maintainer is already signed in as the
 * member, since the service refuses one then; a revoke still is, and ends
 * that sign-in.
 */
function SupportAccessRow(): React.JSX.Element {
  const access = useAppSlice(APP_SLICE.ACCESS);
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const until = access?.supportAccessUntil;
  const granted = until !== undefined && until > Date.now();
  const impersonated = account?.status === ACCOUNT_STATUS.SIGNED_IN && account.impersonated;
  const press = useBusyPress(() => pressAct(ACT_KIND.ACCOUNT_SUPPORT_ACCESS, { grant: !granted }));
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
        ) : impersonated ? null : (
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
        writes={writes}
      />
      <SupportAccessRow />
    </SettingsSection>
  );
}
