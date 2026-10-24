import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, type ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { GitHubTokenSummary } from "@luke/features/github-token-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { VERB } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  FailureNote,
  OneLine,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SettingsRow,
  SettingsSection,
  STATUS_TONE,
  useConfirmDialog,
  wholeWordsHint,
} from "@luke/ui";
import { accountActor } from "@luke/ui/actor-model";
import type { ActionResult } from "@luke/wire";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { useBusyPress } from "./busy-press.js";
import { GitHubTokenDialog, TokenFacts } from "./github-dialog.js";

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** What the row says where the token could not be read, so what stands is unknown. */
const TOKEN_READ_FAILED = "Couldn't read the token.";

/** What the toast says where signing out was refused, so the account is still signed in. */
const SIGN_OUT_FAILED = "The account could not be signed out. Try again.";

/**
 * Signs the account out and answers once that has settled, never by
 * rejecting: a refusal, such as a browser's whose service could not end the
 * session, is said in a toast, since the account is still signed in and the
 * press that asked is gone. Both of the app's Sign outs press through it.
 */
export async function signOutSayingFailure(onSignOut: () => Promise<void>): Promise<void> {
  try {
    await onSignOut();
  } catch {
    showToast({ words: SIGN_OUT_FAILED, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
  }
}

/**
 * The member's own GitHub personal access token: its hint, login, and
 * expiry once one is saved, nothing while none is, and Manage or Add, which
 * opens the token's dialog (`github-dialog.tsx`). The token is read as the
 * row is drawn, again for each account it is drawn for (the section keys it
 * by the account); a read that fails says so under the row in a
 * `FailureNote` whose Retry reads again, and draws neither Add nor Manage,
 * since what stands is unknown.
 */
function GitHubTokenRow(): React.JSX.Element {
  const { act } = useAct();
  const [token, setToken] = useState<GitHubTokenSummary | null | undefined>(undefined);
  const [managing, setManaging] = useState(false);
  // Note that the card is drawn for the token it opened over until its fade has run, so it does not change under its own exit.
  const { held: drawn, onExited } = useHeldThroughExit(
    managing && token !== undefined ? token : undefined,
  );
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
        // Note that a row with nothing below draws no `below` at all, since its box keeps a margin.
        below={
          token === undefined && readFailed
            ? () => (
                <FailureNote onRetry={() => setAttempt((n) => n + 1)}>
                  {TOKEN_READ_FAILED}
                </FailureNote>
              )
            : undefined
        }
      >
        {() =>
          token === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setManaging(true)}>
              {token === null ? "Add" : "Manage"}
            </Button>
          )
        }
      </SettingsRow>
      {drawn === undefined ? null : (
        <GitHubTokenDialog
          open={managing && token !== undefined}
          token={drawn}
          onToken={setToken}
          onClose={() => setManaging(false)}
          onExited={onExited}
        />
      )}
    </div>
  );
}

/**
 * Who is signed in, the member's own GitHub personal access token, and the
 * two ways out of being signed in, at the head of the Account page Settings
 * opens on, and the one place either way out is offered. Sign out acts on
 * the press, since nothing is lost: the host asks first where a call or
 * unsaved words would go. Deleting asks first in the confirm dialog, since it
 * erases the account at the service for good, and a refusal to delete is said
 * in it.
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
  const signOut = useBusyPress(() => signOutSayingFailure(onSignOut));
  // Note that the section is only drawn while its page is, so the page
  // leaving takes the question with it.
  const deletion = useConfirmDialog({ subject: true, surfaceOpen: true }, onDeleteAccount);

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
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={signOut.busy}
              busyLabel="Signing out"
              disabled={deletion.busy}
              onClick={signOut.onPress}
            >
              {VERB.SIGN_OUT}
            </Button>
          )}
        </SettingsRow>
      </div>
      <GitHubTokenRow key={account.id} />
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.DELETE_ACCOUNT)}>
        <SettingsRow label="Delete account">
          {() => (
            <Button
              variant={BUTTON_VARIANT.DANGER_OUTLINE}
              busy={deletion.busy}
              busyLabel="Deleting the account"
              disabled={signOut.busy}
              onClick={deletion.ask}
            >
              Delete account
            </Button>
          )}
        </SettingsRow>
      </div>
      <ConfirmDialog
        open
        confirm={deletion}
        gate={account.email}
        question={{
          title: `Delete the account ${account.email}?`,
          body: "This cannot be undone.",
          verb: "Delete account",
          running: "Deleting account",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </SettingsSection>
  );
}
