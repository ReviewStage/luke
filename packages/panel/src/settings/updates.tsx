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
import { useMutation } from "@tanstack/react-query";
import { pressMutation } from "../act-mutations.js";
import { failureShown, type ShownFailure } from "../failure-report.js";

const READ_ONLY_VOLUME_FAILURE: ShownFailure = {
  surface: FAILURE_SURFACE.UPDATE_CHECK,
  cause: { code: UPDATE_FAILURE.READ_ONLY_VOLUME },
  refused: true,
};

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
          onClick={(event) => {
            event.preventDefault();
            control.onOpenLatest();
          }}
        >
          Download
        </ButtonLink>
      );
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

export function UpdatesSection({
  control,
  offered,
}: {
  control: UpdateControl;
  offered: boolean;
}): React.JSX.Element {
  const { mutate: sendUpdateOpenChangelog } = useMutation(
    pressMutation(ACT_KIND.UPDATE_OPEN_CHANGELOG),
  );
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
                  {row.progress === undefined ? null : <Progress value={row.progress} />}
                </>
              )
            }
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
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.CHANGELOG)}>
        <SettingsRow label="Changelog">
          {() => (
            <ButtonLink
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<ExternalIcon />}
              href={UPDATE_ENDPOINT.CHANGELOG_PAGE_URL}
              onClick={(event) => {
                event.preventDefault();
                sendUpdateOpenChangelog();
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
