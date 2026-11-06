import { ACCOUNT_STATUS, signedInAccountId } from "@repo/credentials/snapshot";
import { CLI_COMMAND, CLI_LINK_FOLDER } from "@repo/features/cli-release";
import { LIVE_READ } from "@repo/features/live-wire";
import { MCP_ACCESS_TOKEN_MINUTES, type McpClient } from "@repo/features/mcp-client-wire";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { CLI_INSTALL_OUTCOME, type CliInstallAnswer } from "@repo/host/contract";
import { HOST_CAPABILITY } from "@repo/settings";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  ErrorState,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  TIME_LOOK,
  Time,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useState } from "react";
import { askActResult, useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { APP_SLICE, useAppSlice, useCapability } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { useBusyPress } from "./busy-press.js";

/**
 * cli-page.tsx -- Settings › CLI, the page named for our command: the `vespin` command's install, to copy and, in the desktop app, run here as VS Code installs `code`, and its sign-in, with Sign out everywhere once it holds one.
 *
 * Install's row holds `npm i -g vespin` in `@repo/ui`'s `CopyField`, as the
 * MCP page's Connect step holds its command; a browser tab shows that alone.
 * Where the client runs the install itself (`HOST_CAPABILITY.CLI_INSTALL`,
 * the desktop app once its build names a release), the row ends in Install,
 * which runs the service's install script in this Mac's account. Once it
 * lands, the row's line says the version installed, or that `~/.local/bin`
 * needs adding to the PATH, and the button becomes Reinstall; an install
 * that did not land says why in the row's failure line, in the script's own
 * words.
 *
 * Sign in reads the command's grant from the clients the account allowed
 * (`LIVE_READ.MCP_CLIENTS`, the MCP page's Connected read, which this page
 * narrows to `vespin-cli` and that page leaves it out of). With none, it shows
 * `vespin login` to copy. With one, its row names the account and when the
 * command was last active, and Sign out everywhere revokes the grant, asking
 * first in the confirm dialog as Connected's Disconnect does: every token the
 * command holds for the account goes, so every computer it is signed in on
 * is signed out, though an access token it already holds keeps working until
 * it expires. A grant revoked while the page shows stays signed out here
 * until the read no longer lists it, unless the command signs in again.
 */

const SECTION_TITLE = {
  INSTALL: "Install",
  SIGN_IN: "Sign in",
} as const;

const PAGE_LINE = {
  INSTALL_LABEL: `Install the ${PRODUCT_NAME.toLowerCase()} command`,
  INSTALL_HERE: "On this Mac, or with npm anywhere.",
  INSTALL_NPM: "With npm, on Node 20 or later.",
  INSTALL: "Install",
  REINSTALL: "Reinstall",
  INSTALLING: "Installing the command-line tool",
  NPM_COMMAND: "npm command",
  SIGN_IN_LABEL: "Sign in from your terminal",
  SIGN_IN_WORDS: "It opens your browser to sign in.",
  LOGIN_COMMAND: "Sign-in command",
  SIGNED_IN: "Signed in",
  SIGN_OUT: "Sign out everywhere",
  SIGNING_OUT: "Signing out",
  SIGN_OUT_REFUSED: "Signing out didn't finish. Try again.",
  READ_FAILED: "The command's sign-in could not be read.",
} as const;

/** The page as it stands while the sign-in is read: Install's row, ending in Install where the client runs it, and Sign in's one row. */
function pageSkeleton(installs: boolean): readonly SettingsSectionSkeletonShape[] {
  return [
    {
      headed: true,
      rows: [{ described: true, controls: installs ? [SETTINGS_SKELETON_CONTROL.BUTTON] : [] }],
    },
    { headed: true, rows: [{ described: true, controls: [] }] },
  ];
}

/** The install row's line once the command is installed: its version, and where the shell will not find it, that its folder needs adding. */
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

/** Install: the npm install to copy, and, where the client runs it, Install and how it went. */
function InstallSection({ installs }: { installs: boolean }): React.JSX.Element {
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
    <SettingsSection title={SECTION_TITLE.INSTALL} anchor={SETTINGS_SEARCH_ROW.CLI_INSTALL}>
      <SettingsRow
        label={PAGE_LINE.INSTALL_LABEL}
        description={
          installed === undefined ? (
            installs ? (
              PAGE_LINE.INSTALL_HERE
            ) : (
              PAGE_LINE.INSTALL_NPM
            )
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
                  busyLabel={PAGE_LINE.INSTALLING}
                >
                  {installed === undefined ? PAGE_LINE.INSTALL : PAGE_LINE.REINSTALL}
                </Button>
              ),
            }
          : undefined)}
        below={() => (
          <CopyField
            label={PAGE_LINE.NPM_COMMAND}
            value={CLI_COMMAND.NPM_INSTALL}
            what="command"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
            prompt={COPY_FIELD_PROMPT.SHELL}
          />
        )}
      />
    </SettingsSection>
  );
}

/** When the command signed in, and when it was last active, where it has been. */
function GrantLine({ grant }: { grant: McpClient }): React.JSX.Element {
  return (
    <>
      {PAGE_LINE.SIGNED_IN}
      {grant.lastRefreshedAt !== null ? (
        <>
          {" · Active "}
          <Time at={grant.lastRefreshedAt} look={TIME_LOOK.AGO} />
        </>
      ) : grant.allowedAt !== null ? (
        <>
          {" "}
          <Time at={grant.allowedAt} look={TIME_LOOK.PROVENANCE} />
        </>
      ) : null}
    </>
  );
}

/** The command signed in: the account it is signed in as, when it was last active, and Sign out everywhere. */
function SignedInRow({
  email,
  grant,
  onSignedOut,
}: {
  email: string;
  grant: McpClient;
  onSignedOut: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const refused: ActionResult = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: PAGE_LINE.SIGN_OUT_REFUSED,
  };
  const signOut = (): Promise<ActionResult> => {
    setRejection(undefined);
    return act(ACT_KIND.MCP_CLIENTS_REVOKE, { clientId: grant.clientId }).then(
      (answer): ActionResult => {
        if ("failure" in answer) {
          setRejection(refused.reason);
          return refused;
        }
        onSignedOut();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      () => {
        setRejection(refused.reason);
        return refused;
      },
    );
  };
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    signOut,
    confirmFailure(FAILURE_SURFACE.MCP_CLIENT_REVOKE),
  );
  return (
    <>
      <SettingsRow
        label={<ReplayMask>{email}</ReplayMask>}
        description={<GrantLine grant={grant} />}
        error={refusedShown(rejection, FAILURE_SURFACE.MCP_CLIENT_REVOKE)}
      >
        {() => (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={confirm.ask}>
            {PAGE_LINE.SIGN_OUT}
          </Button>
        )}
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={confirm}
        question={{
          title: `Sign out of the ${PRODUCT_NAME.toLowerCase()} command everywhere?`,
          body: `It signs out on every computer it's signed in on. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
          verb: PAGE_LINE.SIGN_OUT,
          running: PAGE_LINE.SIGNING_OUT,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
        }}
      />
    </>
  );
}

/** The command not signed in: `vespin login` to copy. */
function SignInRow(): React.JSX.Element {
  return (
    <SettingsRow
      label={PAGE_LINE.SIGN_IN_LABEL}
      description={PAGE_LINE.SIGN_IN_WORDS}
      below={() => (
        <CopyField
          label={PAGE_LINE.LOGIN_COMMAND}
          value={CLI_COMMAND.LOGIN}
          what="command"
          copy={copyThroughShell}
          width={COPY_FIELD_WIDTH.FULL}
          prompt={COPY_FIELD_PROMPT.SHELL}
        />
      )}
    />
  );
}

/** The command's grant among the clients the account allowed, where it holds one. */
function cliGrant(clients: readonly McpClient[]): McpClient | undefined {
  return clients.find((client) => client.clientId === FIRST_PARTY_OAUTH_CLIENT_ID.CLI);
}

/** Settings › CLI, for the account signed in: Install, then Sign in as the command's grant stands. */
export function CliPage(): React.JSX.Element {
  const installs = useCapability(HOST_CAPABILITY.CLI_INSTALL);
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const accountId = signedInAccountId(account);
  const { rows, status, retry } = useHostRead(LIVE_READ.MCP_CLIENTS, accountId);
  // The grant signed out while the page shows, by when it was allowed, which stands signed out until the read drops it or a new sign-in replaces it.
  const [signedOutAt, setSignedOutAt] = useState<number | null | undefined>(undefined);
  if (rows === undefined) {
    return status === HOST_READ_STATUS.FAILED ? (
      <>
        <InstallSection installs={installs} />
        <SettingsSection title={SECTION_TITLE.SIGN_IN} anchor={SETTINGS_SEARCH_ROW.CLI_SIGN_IN}>
          <SettingsLine>
            <ErrorState failure={unreadShown(FAILURE_SURFACE.MCP_CLIENTS_READ)} onRetry={retry}>
              {PAGE_LINE.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        </SettingsSection>
      </>
    ) : (
      <SettingsSectionsSkeleton
        label={readingWords("the command's sign-in")}
        sections={pageSkeleton(installs)}
      />
    );
  }
  const listed = cliGrant(rows.clients);
  const grant =
    listed === undefined || (signedOutAt !== undefined && listed.allowedAt === signedOutAt)
      ? undefined
      : listed;
  const email = account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
  return (
    <>
      <InstallSection installs={installs} />
      <SettingsSection title={SECTION_TITLE.SIGN_IN} anchor={SETTINGS_SEARCH_ROW.CLI_SIGN_IN}>
        {grant === undefined || email === undefined ? (
          <SignInRow />
        ) : (
          <SignedInRow
            email={email}
            grant={grant}
            onSignedOut={() => setSignedOutAt(grant.allowedAt)}
          />
        )}
      </SettingsSection>
    </>
  );
}
