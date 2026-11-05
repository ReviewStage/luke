import { CLI_COMMAND, CLI_LINK_FOLDER } from "@repo/features/cli-release";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { CLI_INSTALL_OUTCOME, type CliInstallAnswer } from "@repo/host/contract";
import { HOST_CAPABILITY } from "@repo/settings";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  COPY_FIELD_WIDTH,
  CopyField,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useState } from "react";
import { askActResult, useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { refusedShown } from "../failure-report.js";
import { useCapability } from "../use-app-state.js";
import { useBusyPress } from "./busy-press.js";

/**
 * cli-section.tsx -- Settings › our MCP's command-line tool: one row naming the `vespin` command, its npm install to copy, and, in the desktop app, Install, as VS Code installs `code`.
 *
 * The row says what the command is for and that `vespin login` follows,
 * and holds `npm i -g vespin` in `@repo/ui`'s `CopyField`, as Connect an
 * agent holds its command; a browser tab shows that alone. Where the client
 * runs the install itself (`HOST_CAPABILITY.CLI_INSTALL`, the desktop app
 * alone), the row ends in Install, which runs the service's install script
 * in this Mac's account. Once it lands, the row's line says the version
 * installed, or that `~/.local/bin` needs adding to the PATH, and the button
 * becomes Reinstall; an install that did not land says why in the row's
 * failure line, in the script's own words.
 */

const SECTION_TITLE = "Command-line tool";

const ROW_LINE = {
  LABEL: `Install the ${PRODUCT_NAME.toLowerCase()} command`,
  WORDS: `Use ${PRODUCT_NAME} from your terminal and your agents. Then run `,
  INSTALL: "Install",
  REINSTALL: "Reinstall",
  INSTALLING: "Installing the command-line tool",
  COMMAND: "npm command",
} as const;

/** The section as it stands while the page reads: its one row, ending in Install where the client runs it. */
export function cliSectionSkeleton(installs: boolean): SettingsSectionSkeletonShape {
  return {
    headed: true,
    rows: [{ described: true, controls: installs ? [SETTINGS_SKELETON_CONTROL.BUTTON] : [] }],
  };
}

/** What the row says the command is for, ending in its sign-in set as code. */
function RowWords(): React.JSX.Element {
  return (
    <>
      {ROW_LINE.WORDS}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
        {CLI_COMMAND.LOGIN}
      </Text>
      .
    </>
  );
}

/** The row's line once the command is installed: its version, and where the shell will not find it, that its folder needs adding. */
function InstalledLine({ version, onPath }: { version: string; onPath: boolean }) {
  return onPath ? (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
      Installed · v{version}
    </SettingsRowStateLine>
  ) : (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
      Installed · v{version} · Add {CLI_LINK_FOLDER} to your PATH
    </SettingsRowStateLine>
  );
}

/** The command-line tool's section: its one row, Install on the desktop, and the npm install to copy. */
export function CliSection(): React.JSX.Element {
  const installs = useCapability(HOST_CAPABILITY.CLI_INSTALL);
  const { act } = useAct();
  const [answer, setAnswer] = useState<CliInstallAnswer | undefined>(undefined);
  const install = useBusyPress(() =>
    askActResult(
      act(ACT_KIND.CLI_INSTALL).then((answered) => {
        setAnswer(answered);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      }),
    ).then((result) => {
      if (result.status === ACTION_RESULT_STATUS.REJECTED) {
        setAnswer({ outcome: CLI_INSTALL_OUTCOME.FAILED, reason: result.reason });
      }
    }),
  );
  const installed = answer?.outcome === CLI_INSTALL_OUTCOME.INSTALLED ? answer : undefined;
  const failed = answer?.outcome === CLI_INSTALL_OUTCOME.FAILED ? answer.reason : undefined;
  return (
    <SettingsSection title={SECTION_TITLE} anchor={SETTINGS_SEARCH_ROW.MCP_CLI}>
      <SettingsRow
        label={ROW_LINE.LABEL}
        description={
          installed === undefined ? (
            <RowWords />
          ) : (
            <InstalledLine version={installed.version} onPath={installed.onPath} />
          )
        }
        error={refusedShown(failed, FAILURE_SURFACE.CLI_INSTALL)}
        {...(installs
          ? {
              children: () => (
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  onClick={install.onPress}
                  busy={install.busy}
                  busyLabel={ROW_LINE.INSTALLING}
                >
                  {installed === undefined ? ROW_LINE.INSTALL : ROW_LINE.REINSTALL}
                </Button>
              ),
            }
          : undefined)}
        below={() => (
          <CopyField
            label={ROW_LINE.COMMAND}
            value={CLI_COMMAND.NPM_INSTALL}
            what="command"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
          />
        )}
      />
    </SettingsSection>
  );
}
