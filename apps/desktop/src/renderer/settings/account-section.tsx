import {
  ACCOUNT_PROVIDER,
  type ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { UserIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { ConfirmDialog, DIALOG_TONE, useConfirmDialog } from "./confirm-dialog";
import { SettingsGroup } from "./settings-group";

/**
 * Who is signed in, and the two ways out of that. It sits at the foot of
 * General: signing out and deleting are done once or never. Both ways out ask
 * first in the confirm dialog, as the sidebar's Log out does: getting back in
 * costs a whole trip through the browser, and deleting erases the account at
 * the service, which no sign-in brings back. The dialog is modal, so only one
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
        {/* The provider's own picture of the person, when their identity
            carried one from a host this build pins — otherwise a glyph, so
            the line never shows a broken image. */}
        {account.pictureUrl ? (
          <img
            className="account-avatar"
            src={account.pictureUrl}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
          />
        ) : (
          <span className="account-avatar account-avatar-fallback" aria-hidden="true">
            <UserIcon />
          </span>
        )}
        <span className="settings-copy">
          <strong>{account.email}</strong>
          <small>
            Signed in with {account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}
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
          body: "Your plans stay with your account. Signing back in takes a trip through the browser.",
          verb: "Sign out",
          running: "Signing out",
          tone: DIALOG_TONE.PRIMARY,
        }}
      />
      <ConfirmDialog
        confirm={deletion}
        question={{
          title: `Delete the account ${account.email}?`,
          body: "The service erases it, and no sign-in brings it back. This cannot be undone.",
          verb: "Delete account",
          running: "Deleting account",
        }}
      />
    </SettingsGroup>
  );
}
