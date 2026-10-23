import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, type ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { GitHubTokenSummary } from "@luke/features/github-token-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
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
  wholeWordsHint,
} from "@luke/ui";
import { accountActor } from "@luke/ui/actor-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { GitHubTokenDialog, TokenFacts } from "./github-dialog.js";

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/**
 * The member's own GitHub personal access token: its hint, login, and
 * expiry once one is saved, nothing while none is, and Manage or Add, which
 * opens the token's dialog (`github-dialog.tsx`). The token is read as the
 * row is drawn, again for each account it is drawn for (the section keys it
 * by the account); a read that fails draws Try again in place of Add or
 * Manage, since what stands is unknown.
 */
function GitHubTokenRow(): React.JSX.Element {
  const { act } = useAct();
  const [token, setToken] = useState<GitHubTokenSummary | null | undefined>(undefined);
  const [managing, setManaging] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setReadFailed(false);
    act(ACT_KIND.GITHUB_TOKEN_READ)
      .catch(() => undefined)
      .then((answer) => {
        if (!live) return;
        if (answer === undefined || "failure" in answer) setReadFailed(true);
        else setToken(answer.token);
      });
    return () => {
      live = false;
    };
  }, [act, attempt]);

  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.GITHUB_ACCESS)} className={NO_CAPTURE}>
      <SettingsRow
        leading={
          <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} size={PROVIDER_MARK_SIZE.ROW} />
        }
        label="GitHub personal access token"
        description={token ? <TokenFacts token={token} /> : undefined}
      >
        {() =>
          token === undefined ? (
            readFailed ? (
              <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            ) : null
          ) : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setManaging(true)}>
              {token === null ? "Add" : "Manage"}
            </Button>
          )
        }
      </SettingsRow>
      {managing && token !== undefined ? (
        <GitHubTokenDialog token={token} onToken={setToken} onClose={() => setManaging(false)} />
      ) : null}
    </div>
  );
}

/**
 * Who is signed in, the member's own GitHub personal access token, and the
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
      <GitHubTokenRow key={account.id} />
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
        gate={account.email}
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
