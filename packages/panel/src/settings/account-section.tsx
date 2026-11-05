import type { AccountSnapshot } from "@repo/credentials/snapshot";
import {
  ACCOUNT_PROVIDER,
  type ACCOUNT_STATUS,
  signedInAccountId,
} from "@repo/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { andList, IRREVERSIBLE_WORDS, VERB } from "@repo/features/words";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
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
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { sendAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { githubTokenQuery, githubTokenRetryMutation } from "../live-reads.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
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
      replayUnmasked: true,
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
  const read = useQuery(githubTokenQuery(accountId));
  const retry = useMutation(githubTokenRetryMutation());
  const token = read.data?.token;
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
          read.isError
            ? () => (
                <FailureNote
                  failure={unreadShown(FAILURE_SURFACE.ACCOUNT_TOKEN_READ)}
                  onRetry={() => retry.mutate()}
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
 * The account's delete, as the question asking it holds its own mutation
 * over it. Note that the delete happens at the service before anything
 * local moves, so a failure answers why and the account still stands, and
 * that Better Auth deletes an account only within a day of its sign-in, so
 * the refusal says how to get past that, which a retry alone does not.
 */
const ACCOUNT_DELETE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.ACCOUNT_DELETE],
  mutationFn: (): Promise<ActionResult> =>
    sendAct(ACT_KIND.ACCOUNT_DELETE, undefined).then(
      () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      () => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "The account could not be deleted. Sign out and back in, then delete it again.",
      }),
    ),
});

/**
 * The workspaces deleting the account deletes with it, as the list it was
 * handed reads them: the ones the account owns and is the only member of,
 * as Better Auth deletes them (`auth-policy.ts`'s `accountDeletion`). Note
 * that a list from a service before member counts names none.
 */
function deletedWorkspaces(workspaces: readonly Workspace[]): readonly string[] {
  return workspaces
    .filter(({ role, memberCount }) => role === WORKSPACE_ROLE.OWNER && memberCount === 1)
    .map(({ name }) => name);
}

/** What the question adds after its warning, naming the workspaces that go with the account. */
function deletedWorkspacesWords(names: readonly string[]): string {
  return `Also deleted, with everything in them: ${andList(names)}.`;
}

/**
 * Who is signed in, the member's own GitHub personal access token, and the
 * two ways out of being signed in, at the head of the Account page Settings
 * opens on, and the one place either way out is offered. Sign out acts on
 * the press, since nothing is lost: the host asks first where a call or
 * unsaved words would go. Deleting asks first in the confirm dialog, since it
 * erases the account at the service for good, naming the workspaces that go
 * with it, and a refusal to delete is said in it.
 */
export function AccountSection({
  account,
  workspaces = [],
  onSignOut,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  /** The account's workspaces as the Workspace page lists them; none while the list is unread. */
  workspaces?: readonly Workspace[] | undefined;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const deleted = deletedWorkspaces(workspaces);
  const signOut = useBusyPress(() => signOutSayingFailure(onSignOut));
  // Note that the section is only drawn while its page is, so the page
  // leaving takes the question with it.
  const deleting = useMutation(ACCOUNT_DELETE_MUTATION);
  const deletionAct = useConfirmAct(deleting, {
    send: () => deleting.mutateAsync(),
    answered: sameAnswer,
  });
  const deletion = useConfirmDialog(
    { subject: true, surfaceOpen: true },
    deletionAct,
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
          leading={
            <ReplayMask>
              <ActorMark actor={accountActor(account)} size={ACTOR_SIZE.CARD} />
            </ReplayMask>
          }
          label={
            <OneLine hint={wholeWordsHint(account.email)}>
              <ReplayMask>{account.email}</ReplayMask>
            </OneLine>
          }
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
          body:
            deleted.length > 0
              ? `${IRREVERSIBLE_WORDS} ${deletedWorkspacesWords(deleted)}`
              : IRREVERSIBLE_WORDS,
          verb: "Delete account",
          running: "Deleting account",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
          titleReplayMasked: true,
          // Note that the workspaces' names are a person's words, so the body is masked once it names any.
          bodyReplayMasked: deleted.length > 0,
        }}
      />
    </SettingsSection>
  );
}
