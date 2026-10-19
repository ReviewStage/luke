import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, type ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@luke/features/integration-wire";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  DIALOG_TONE,
  OneLine,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SettingsRow,
  SettingsSection,
  useConfirmDialog,
} from "@luke/ui";
import { accountActor } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useGitHubConnection } from "../github-connect.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { wholeWordsHint } from "../tooltip.js";
import { GitHubDialog } from "./github-dialog.js";

/**
 * The account's GitHub: the login where the connection names one, and
 * Manage, which opens the dialog that picks the Luke GitHub App or the
 * member's own personal access token (`github-dialog.tsx`) while GitHub is
 * connected. Whether it is connected is the integrations' own read, which
 * the dialog's Refresh reads again at once.
 */
function GitHubRow(): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const { connection } = useGitHubConnection();
  const [managing, setManaging] = useState(false);
  const status = statuses.statusOf(INTEGRATION_PROVIDER.GITHUB);
  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const login = connected ? (connection?.login ?? null) : null;
  // Note that only a read that found GitHub unlinked says so, because an unread, failed, or unavailable read found nothing.
  const line = connected
    ? (login ?? "Connected")
    : status === INTEGRATION_STATUS.DISCONNECTED || status === INTEGRATION_STATUS.EXPIRED
      ? "Not connected"
      : undefined;
  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.GITHUB_ACCESS)}>
      <SettingsRow
        leading={
          <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} size={PROVIDER_MARK_SIZE.ROW} />
        }
        label="GitHub"
        description={line}
      >
        {() =>
          connected ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setManaging(true)}>
              Manage
            </Button>
          ) : null
        }
      </SettingsRow>
      {managing ? (
        <GitHubDialog
          connected={connected}
          onRefresh={statuses.read}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Who is signed in, the GitHub the account reaches GitHub through, and the
 * two ways out of being signed in, at the head of the Account page Settings
 * opens on, and the one place either way out is offered. Both ways out ask
 * first in the confirm dialog: getting back in
 * takes the browser, and deleting erases the account at the service for
 * good. The dialog is modal, so only one
 * of the two can stand at a time, and a refusal to delete is said in it.
 */
export function AccountSection({
  account,
  onSignOut,
  onDeleteAccount,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<ActionResult>;
}): React.JSX.Element {
  // Note that the section is only drawn while its page is, so the page
  // leaving takes the question with it.
  const surroundings = { subject: true, surfaceOpen: true };
  // A sign-out the host refused, such as a browser's whose service could not
  // end the session, keeps the dialog up saying so, rather than closing on an
  // account still signed in, as the sidebar's Log out does.
  const signOut = useConfirmDialog(surroundings, async (): Promise<ActionResult> => {
    try {
      await onSignOut();
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    } catch {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "Luke could not sign out. Try again.",
      };
    }
  });
  const deletion = useConfirmDialog(surroundings, onDeleteAccount);

  const busy = signOut.busy || deletion.busy;

  // Note that each row stands in a wrapper wearing its search anchor, because
  // a pressed result lands on and rings the whole row, as it did before the
  // row was shared, and the shared row takes no attribute of a caller's.
  return (
    <SettingsSection title="Account">
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.SIGN_OUT)}>
        <SettingsRow
          // The account's face as the sidebar's foot and every list draw it: its picture, else its letter on its hue.
          leading={<ActorMark actor={accountActor(account)} size={ACTOR_SIZE.CARD} />}
          label={<OneLine hint={wholeWordsHint(account.email)}>{account.email}</OneLine>}
          description={
            <span className="account-provider">
              Signed in with
              <ProviderMark provider={account.provider} size={PROVIDER_MARK_SIZE.CAPTION} />
              {account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}
            </span>
          }
        >
          {() => (
            <Button variant={BUTTON_VARIANT.OUTLINE} disabled={busy} onClick={signOut.ask}>
              Sign out
            </Button>
          )}
        </SettingsRow>
      </div>
      <GitHubRow />
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.DELETE_ACCOUNT)}>
        <SettingsRow label="Delete account">
          {() => (
            <Button variant={BUTTON_VARIANT.DANGER_OUTLINE} disabled={busy} onClick={deletion.ask}>
              Delete account
            </Button>
          )}
        </SettingsRow>
      </div>
      <ConfirmDialog
        confirm={signOut}
        question={{
          title: `Sign out of ${account.email}?`,
          verb: "Sign out",
          running: "Signing out",
          tone: DIALOG_TONE.PRIMARY,
        }}
      />
      <ConfirmDialog
        confirm={deletion}
        question={{
          title: `Delete the account ${account.email}?`,
          body: "This cannot be undone.",
          verb: "Delete account",
          running: "Deleting account",
        }}
      />
    </SettingsSection>
  );
}
