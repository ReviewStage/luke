import {
  CLI_COMMAND,
  CLI_LINK_FOLDER,
  CLI_PATH_LINE,
  cliInstallCommand,
} from "@repo/features/cli-release";
import { HOST_WIRE } from "@repo/features/host-wire";
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
  GAP,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  Stack,
} from "@repo/ui";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useState } from "react";
import { askActResult, useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { refusedShown } from "../failure-report.js";
import { useCapability } from "../use-app-state.js";
import { useBusyPress } from "./busy-press.js";

/**
 * cli-section.tsx -- Settings › our MCP's command-line tool: the `vespin` command for a terminal and the agents that run in one, how to install it and sign it in, and, in the desktop app, its install on this Mac.
 *
 * Each way in is a row whose command is `@repo/ui`'s `CopyField`, its words
 * the shared constants the command's README and the install script spell
 * (`@repo/features/cli-release`): npm, a one-off npx sign-in, and the install
 * script in its `cli` mode at the service's own origin, so a Preview's page
 * names that Preview's script; then `vespin login`. Once it signs in, the
 * command is one of the agents Connected lists, and nothing here repeats it.
 *
 * Where the client can run the install itself (`HOST_CAPABILITY.CLI_INSTALL`,
 * the desktop app alone), the lead row ends in Install command-line tool,
 * which runs that same script in this Mac's account, as VS Code installs
 * `code`, and says under the row how it went: the version installed, and,
 * where the login shell's PATH does not hold `~/.local/bin`, the line to add
 * to its profile; or the words the install failed with. A browser tab shows
 * the commands alone.
 */

const SECTION_TITLE = "Command-line tool";

/** The command, as a person types it. */
const COMMAND_NAME = PRODUCT_NAME.toLowerCase();

const SECTION_LINE = {
  LEAD: `The ${COMMAND_NAME} command, for your terminal and your agents`,
  LEAD_WORDS: `Work with your tasks, plans, and agents from a shell. Agents like Claude Code and Codex can run it too.`,
  INSTALL: "Install command-line tool",
  INSTALLING: "Installing the command-line tool",
  NOT_ON_PATH: `${CLI_LINK_FOLDER} isn't on your shell's PATH. Add this line to your shell's profile, such as ~/.zshrc, then open a new terminal.`,
  PATH_LINE: "PATH line",
} as const;

/** One way in: its row's words and the command it copies. */
interface CliStep {
  readonly label: string;
  readonly words: string;
  readonly command: (installScriptUrl: string) => string;
}

/** The ways to install the command, in the order the page offers them, and the sign-in after any of them. */
const CLI_STEPS: readonly CliStep[] = [
  {
    label: "Install with npm",
    words: "On Node 20 or later.",
    command: () => CLI_COMMAND.NPM_INSTALL,
  },
  {
    label: "Or run it with npx",
    words: "Signs in without installing anything.",
    command: () => CLI_COMMAND.NPX_LOGIN,
  },
  {
    label: "Or install it with its own Node",
    words: `On an Apple silicon Mac or Linux, into ${CLI_LINK_FOLDER}.`,
    command: cliInstallCommand,
  },
  {
    label: "Then sign in",
    words: `It opens your browser. Once you sign in, ${PRODUCT_NAME} CLI shows under Connected.`,
    command: () => CLI_COMMAND.LOGIN,
  },
];

/**
 * The section as it stands while the page reads, shaped as it lands: the
 * lead row, ending in the install where the client runs it, and a described
 * row to each step.
 */
export function cliSectionSkeleton(installs: boolean): SettingsSectionSkeletonShape {
  return {
    headed: true,
    rows: [
      { described: true, controls: installs ? [SETTINGS_SKELETON_CONTROL.BUTTON] : [] },
      ...CLI_STEPS.map(() => ({ described: true, controls: [] })),
    ],
  };
}

/** How the install went, under the lead row: the version installed and, where the shell will not find it, the line that lets it. */
function InstalledLines({ version, onPath }: { version: string; onPath: boolean }) {
  return (
    <Stack gap={GAP.TIGHT}>
      <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED} block>
        Installed {COMMAND_NAME} {version}.
      </SettingsRowStateLine>
      {onPath ? null : (
        <>
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION} block>
            {SECTION_LINE.NOT_ON_PATH}
          </SettingsRowStateLine>
          <CopyField
            label={SECTION_LINE.PATH_LINE}
            value={CLI_PATH_LINE}
            what="line"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
          />
        </>
      )}
    </Stack>
  );
}

/** The lead row: what the command is, and, where the client runs it, its install and how that went. */
function LeadRow(): React.JSX.Element {
  const installs = useCapability(HOST_CAPABILITY.CLI_INSTALL);
  const { act } = useAct();
  const [answer, setAnswer] = useState<CliInstallAnswer | undefined>(undefined);
  const install = useBusyPress(() => {
    setAnswer(undefined);
    return askActResult(
      act(ACT_KIND.CLI_INSTALL).then((answered) => {
        setAnswer(answered);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      }),
    ).then((result) => {
      if (result.status === ACTION_RESULT_STATUS.REJECTED) {
        setAnswer({ outcome: CLI_INSTALL_OUTCOME.FAILED, reason: result.reason });
      }
    });
  });
  const failed = answer?.outcome === CLI_INSTALL_OUTCOME.FAILED ? answer.reason : undefined;
  return (
    <SettingsRow
      label={SECTION_LINE.LEAD}
      description={SECTION_LINE.LEAD_WORDS}
      error={refusedShown(failed, FAILURE_SURFACE.CLI_INSTALL)}
      {...(installs
        ? {
            children: () => (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                onClick={install.onPress}
                busy={install.busy}
                busyLabel={SECTION_LINE.INSTALLING}
              >
                {SECTION_LINE.INSTALL}
              </Button>
            ),
          }
        : undefined)}
      {...(answer?.outcome === CLI_INSTALL_OUTCOME.INSTALLED
        ? { below: () => <InstalledLines version={answer.version} onPath={answer.onPath} /> }
        : undefined)}
    />
  );
}

/** The command-line tool's section, its install script named at the service whose MCP server is `serverUrl`. */
export function CliSection({ serverUrl }: { serverUrl: string }): React.JSX.Element {
  const installScriptUrl = new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, serverUrl).href;
  return (
    <SettingsSection title={SECTION_TITLE} anchor={SETTINGS_SEARCH_ROW.MCP_CLI}>
      <LeadRow />
      {CLI_STEPS.map((step) => (
        <SettingsRow
          key={step.label}
          label={step.label}
          description={step.words}
          below={() => (
            <CopyField
              label={`${step.label} command`}
              value={step.command(installScriptUrl)}
              what="command"
              copy={copyThroughShell}
              width={COPY_FIELD_WIDTH.FULL}
            />
          )}
        />
      ))}
    </SettingsSection>
  );
}
