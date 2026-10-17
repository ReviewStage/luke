import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, type ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import { ConfirmDialog, DIALOG_TONE, ProviderMark, useConfirmDialog } from "@luke/ui";
import { accountActor } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { OneLine } from "./one-line";
import { SettingsGroup } from "./settings-group";

/**
 * Who is signed in, and the two ways out of that, at the head of the Account
 * page Settings opens on, and the one place either is offered. Both ways out ask
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
  // The sign-out cannot be refused, so its answer is the accepted one every
  // confirming action reports through.
  const signOut = useConfirmDialog(surroundings, async () => {
    await onSignOut();
    return { status: ACTION_RESULT_STATUS.ACCEPTED } satisfies ActionResult;
  });
  const deletion = useConfirmDialog(surroundings, onDeleteAccount);

  return (
    <SettingsGroup title="Account">
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.SIGN_OUT)}>
        {/* The account's face as the sidebar's foot and every list draw it: its picture, else its letter on its hue. */}
        <ActorMark actor={accountActor(account)} size={ACTOR_SIZE.CARD} />
        <span className="settings-copy">
          <OneLine as="strong" text={account.email} />
          <small className="account-provider">
            Signed in with
            <ProviderMark provider={account.provider} />
            {account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}
          </small>
        </span>
        <button
          type="button"
          className="toolbar-button bordered-button"
          disabled={signOut.busy || deletion.busy}
          onClick={signOut.ask}
        >
          Sign out
        </button>
      </div>
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.DELETE_ACCOUNT)}>
        <span className="settings-copy">
          <strong>Delete account</strong>
        </span>
        <button
          type="button"
          className="toolbar-button bordered-button"
          data-danger="true"
          disabled={signOut.busy || deletion.busy}
          onClick={deletion.ask}
        >
          Delete account
        </button>
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
    </SettingsGroup>
  );
}
