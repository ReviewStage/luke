import type { AccountSnapshot } from "@repo/credentials/snapshot";
import {
  ACCOUNT_PROVIDER,
  type ACCOUNT_STATUS,
  signedInAccountId,
} from "@repo/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS, VERB } from "@repo/features/words";
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

const NO_CAPTURE = "ph-no-capture";

const TOKEN_LABEL = "GitHub personal access token";

const TOKEN_READ_FAILED = "The token could not be read.";

const SIGN_OUT_FAILED = "The account could not be signed out. Try again.";

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

function GitHubTokenRow({ accountId }: { accountId: string | undefined }): React.JSX.Element {
  const read = useQuery(githubTokenQuery(accountId));
  const retry = useMutation(githubTokenRetryMutation());
  const token = read.data?.token;
  const [managing, setManaging] = useState(false);
  const { held: drawn, onExited } = useHeldThroughExit(
    managing && token !== undefined ? token : undefined,
  );

  return (
    <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.GITHUB_ACCESS)} className={NO_CAPTURE}>
      <SettingsRow
        lead={SETTINGS_ROW_LEAD.FACE}
        leading={
          <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} size={PROVIDER_MARK_SIZE.ROW} />
        }
        label={<OneLine hint={wholeWordsHint(TOKEN_LABEL)}>{TOKEN_LABEL}</OneLine>}
        description={token ? <TokenFacts token={token} /> : undefined}
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

const ACCOUNT_DELETE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.ACCOUNT_DELETE],
  mutationFn: (): Promise<ActionResult> =>
    sendAct(ACT_KIND.ACCOUNT_DELETE, undefined).then(
      () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      () => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "The account could not be deleted. Try again.",
      }),
    ),
});

export function AccountSection({
  account,
  onSignOut,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  const signOut = useBusyPress(() => signOutSayingFailure(onSignOut));
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

  return (
    <SettingsSection>
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.SIGN_OUT)}>
        <SettingsRow
          lead={SETTINGS_ROW_LEAD.FACE}
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
          body: IRREVERSIBLE_WORDS,
          verb: "Delete account",
          running: "Deleting account",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
    </SettingsSection>
  );
}
