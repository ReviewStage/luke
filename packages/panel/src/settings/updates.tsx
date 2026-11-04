import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { UPDATE_ENDPOINT } from "@repo/host/update-service";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import type { UpdateControl } from "@repo/settings/settings-controls";
import { UPDATE_FAILURE } from "@repo/settings/update";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "@repo/settings/update-row";
import {
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CheckIcon,
  ExternalIcon,
  FailureNote,
  GAP,
  Inline,
  Progress,
  SettingsRow,
  SettingsSection,
} from "@repo/ui";
import { useAct } from "../act.js";
import { failureShown, type ShownFailure } from "../failure-report.js";

/**
 * An install a read-only volume refused, as its note reports it: a refusal
 * the row named, so Sentry hears a log line under its own code rather than
 * an issue, and one value, so the note standing is reported once.
 */
const READ_ONLY_VOLUME_FAILURE: ShownFailure = {
  surface: FAILURE_SURFACE.UPDATE_CHECK,
  cause: { code: UPDATE_FAILURE.READ_ONLY_VOLUME },
  refused: true,
};

/**
 * The row's one act, in the outline face every Settings row's act wears:
 * restart into the release, reach its page in the browser as a link, move
 * the app into Applications beside that link, check for one,
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
    case UPDATE_ROW_ACTION.MOVE:
      return (
        <Inline gap={GAP.CONTROL}>
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={control.onMoveToApplications}>
            Move to Applications
          </Button>
          {updateButton(UPDATE_ROW_ACTION.GET, control)}
        </Inline>
      );
    case UPDATE_ROW_ACTION.GET:
      return (
        <ButtonLink
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<ExternalIcon />}
          href={UPDATE_ENDPOINT.LATEST_RELEASE_PAGE_URL}
          // Note that the page opens through the update act, as a toast's link does, so a refusal toasts.
          onClick={(event) => {
            event.preventDefault();
            control.onOpenLatest();
          }}
        >
          Download
        </ButtonLink>
      );
    // Note that a failed check's Retry stands in its `FailureNote` under the row.
    case UPDATE_ROW_ACTION.RETRY:
      return null;
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
 * The group is `@repo/ui`'s `SettingsSection` and each line its
 * `SettingsRow`, every act the outline `Button` or, where it opens a page, `ButtonLink`. Note that each row stands
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
  const { press } = useAct();
  const row = updateRow(control.update, control.build);
  return (
    <SettingsSection>
      {offered ? (
        <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.UPDATES)}>
          <SettingsRow
            label={
              <Inline gap={GAP.ICON} wrap={false}>
                {row.title}
                {row.current ? <CheckIcon /> : null}
              </Inline>
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
            // Note that a failure is a `FailureNote` under the row, an alert
            // announced as it lands, with Retry where asking again can mend
            // it; every other detail is read with the row rather than spoken
            // over whatever the reader is on.
            below={
              row.failed
                ? () => (
                    <FailureNote
                      failure={failureShown(
                        row.action === UPDATE_ROW_ACTION.MOVE
                          ? READ_ONLY_VOLUME_FAILURE
                          : {
                              surface: FAILURE_SURFACE.UPDATE_CHECK,
                              cause: FAILURE_CONDITION.UNREAD,
                            },
                      )}
                      onRetry={
                        row.action === UPDATE_ROW_ACTION.RETRY
                          ? () => void control.onCheck()
                          : undefined
                      }
                    >
                      {row.detail}
                    </FailureNote>
                  )
                : undefined
            }
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
            <ButtonLink
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<ExternalIcon />}
              href={UPDATE_ENDPOINT.CHANGELOG_PAGE_URL}
              onClick={(event) => {
                event.preventDefault();
                press(ACT_KIND.UPDATE_OPEN_CHANGELOG);
              }}
            >
              Open changelog
            </ButtonLink>
          )}
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}
