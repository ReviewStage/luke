import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "@luke/settings/update-row";
import {
  BUTTON_VARIANT,
  Button,
  CheckIcon,
  ExternalIcon,
  Progress,
  SettingsRow,
  SettingsSection,
} from "@luke/ui";
import type { UpdateControl } from "@luke/voice/settings-controls";

/**
 * The row's one act, in the outline face every Settings row's act wears:
 * restart into the release, reach its page in the browser, check for one,
 * or check again — or none at all, while a download runs or for a
 * development build no release is newer than. The accent is kept for a
 * form's Save alone.
 */
function updateButton(action: UpdateRowAction, control: UpdateControl): React.JSX.Element | null {
  switch (action) {
    case UPDATE_ROW_ACTION.NONE:
    case UPDATE_ROW_ACTION.DOWNLOADING:
      return null;
    case UPDATE_ROW_ACTION.RESTART:
      return (
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={control.onInstall}>
          Restart to update
        </Button>
      );
    case UPDATE_ROW_ACTION.GET:
      return (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<ExternalIcon />}
          onClick={control.onOpenLatest}
        >
          Download
        </Button>
      );
    case UPDATE_ROW_ACTION.RETRY:
      return (
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => void control.onCheck()}>
          Try again
        </Button>
      );
    default:
      return (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          busy={action === UPDATE_ROW_ACTION.CHECKING}
          busyLabel="Checking for updates"
          onClick={() => void control.onCheck()}
        >
          Check for updates
        </Button>
      );
  }
}

/**
 * Where the build stands against the latest release, and what it changed: the
 * About page's one group, while the sidebar's update row carries the news
 * outside. A platform that offers no updates draws the changelog alone.
 *
 * The group is `@luke/ui`'s `SettingsSection` and each line its
 * `SettingsRow`, every act the outline `Button`. Note that each row stands
 * in a wrapper wearing its search anchor, because the shared row takes no
 * attribute of a caller's.
 */
export function UpdatesSection({
  control,
  offered,
}: {
  control: UpdateControl;
  /** Whether the platform offers updates; where it does not, the changelog stands alone. */
  offered: boolean;
}): React.JSX.Element {
  const { tell } = useAct();
  const row = updateRow(control.update, control.build);
  return (
    <SettingsSection>
      {offered ? (
        <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.UPDATES)}>
          <SettingsRow
            label={
              <span className="settings-name">
                {row.title}
                {row.current ? <CheckIcon /> : null}
              </span>
            }
            description={
              row.failed ? undefined : (
                <>
                  {row.detail}
                  {/* Note that the bar is the picture of the detail's numbers, so it says nothing to a reader. */}
                  {row.progress === undefined ? null : <Progress value={row.progress} />}
                </>
              )
            }
            // Note that a failure is the row's error, announced as it lands;
            // every other detail is read with the row rather than spoken over
            // whatever the reader is on.
            error={row.failed ? row.detail : undefined}
          >
            {() => updateButton(row.action, control)}
          </SettingsRow>
        </div>
      ) : null}
      {/* What the versions the row talks about actually changed — beside the
          version, as a trip to the fixed changelog page in the browser. */}
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.CHANGELOG)}>
        <SettingsRow label="Changelog">
          {() => (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<ExternalIcon />}
              onClick={() => tell(ACT_KIND.UPDATE_OPEN_CHANGELOG)}
            >
              Open
            </Button>
          )}
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}
