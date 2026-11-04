import type { AccountSnapshot } from "@repo/credentials/snapshot";
import {
  ACCOUNT_PROVIDER,
  type ACCOUNT_STATUS,
  signedInAccountId,
} from "@repo/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS, VERB } from "@repo/features/words";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  FailureNote,
  OneLine,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_LEAD,
  SettingsRow,
  SettingsSection,
  STATUS_TONE,
  useConfirmDialog,
  wholeWordsHint,
} from "@repo/ui";
import { accountActor } from "@repo/ui/actor-model";
import type { ActionResult } from "@repo/wire";
import { useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { useBusyPress } from "./busy-press.js";
import { GitHubTokenDialog, TokenFacts } from "./github-dialog.js";

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** The row's name. */
const TOKEN_LABEL = "GitHub personal access token";

/** What the row says where the token could not be read, so what stands is unknown. */
const TOKEN_READ_FAILED = "The token could not be read.";

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
  } catch (cause) {
    showToast({
      words: SIGN_OUT_FAILED,
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: { surface: FAILURE_SURFACE.ACCOUNT_SIGN_OUT, cause },
    });
  }
}

/**
 * The member's own GitHub personal access token: its hint, login, and
 * expiry once one is saved, and Manage or Add, which
 * opens the token's dialog (`github-dialog.tsx`). The token is the one the
 * host holds for the account the row is drawn for (`LIVE_READ.GITHUB_TOKEN`),
 * where a save's and a removal's own answer lands too; a read that fails
 * says so under the row in a `FailureNote` whose Retry asks again, and draws
 * neither Add nor Manage, since what stands is unknown.
 */
function GitHubTokenRow({ accountId }: { accountId: string | undefined }): React.JSX.Element {
  const { rows, status, retry } = useHostRead(LIVE_READ.GITHUB_TOKEN, accountId);
  const token = rows?.token;
  const [managing, setManaging] = useState(false);
  // Note that the card is drawn for the token it opened over until its fade has run, so it does not change under its own exit.
  const { held: drawn, onExited } = useHeldThroughExit(
    managing && token !== undefined ? token : undefined,
  );

  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.GITHUB_ACCESS)} className={NO_CAPTURE}>
      <SettingsRow
        // Note that the row stands under the account's own, whose face is wider than a mark, so its words start where the account's do.
        lead={SETTINGS_ROW_LEAD.FACE}
        leading={
          <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} size={PROVIDER_MARK_SIZE.ROW} />
        }
        label={<OneLine hint={wholeWordsHint(TOKEN_LABEL)}>{TOKEN_LABEL}</OneLine>}
        description={token ? <TokenFacts token={token} /> : undefined}
        // Note that a row with nothing below draws no `below` at all, since its box keeps a margin.
        below={
          status === HOST_READ_STATUS.FAILED
            ? () => (
                <FailureNote
                  failure={unreadShown(FAILURE_SURFACE.ACCOUNT_TOKEN_READ)}
                  onRetry={retry}
                >
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
  const deletion = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    onDeleteAccount,
    confirmFailure(FAILURE_SURFACE.ACCOUNT_DELETE),
  );

  // Note that each row stands in a wrapper wearing its search anchor, because
  // a pressed result lands on and rings the whole row, as it did before the
  // row was shared, and the shared row takes no attribute of a caller's. The
  // section is untitled, as the Workspace page's first is, because the page
  // over it is already headed Account.
  return (
    <SettingsSection>
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.SIGN_OUT)}>
        <SettingsRow
          lead={SETTINGS_ROW_LEAD.FACE}
          // The account's face as the sidebar's foot and every list draw it: its picture, else its letter on its hue.
          leading={<ActorMark actor={accountActor(account)} size={ACTOR_SIZE.CARD} />}
          label={<OneLine hint={wholeWordsHint(account.email)}>{account.email}</OneLine>}
          description={
            <span className="inline-flex flex-wrap items-center gap-ui-4 whitespace-nowrap">
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
      <GitHubTokenRow key={account.id} accountId={signedInAccountId(account)} />
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
          body: IRREVERSIBLE_WORDS,
          verb: "Delete account",
          running: "Deleting account",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </SettingsSection>
  );
}
