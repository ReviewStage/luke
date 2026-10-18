import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, type ACCOUNT_STATUS } from "@luke/credentials/snapshot";
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
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { wholeWordsHint } from "../tooltip";

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
