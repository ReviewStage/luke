import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAct } from "../act.js";
import { HarnessMark } from "../harness-marks.js";
import { dayAndTimeText, dayText } from "../tasks/task-time.js";
import { SwitchRow } from "./switch-row.js";

/**
 * chatgpt-plan-section.tsx -- Settings › Coding agents › Codex: the account's ChatGPT plan, connected with Continue with ChatGPT and disconnected.
 *
 * A group of the Coding agents page, drawn only on a client that can take a
 * sign-in's loopback (the desktop); the page decides that. One row: the plan, what
 * connecting it does, and Continue with ChatGPT, which the host runs through
 * the developer's browser (`compose-chatgpt-sign-in.ts`) while the row waits
 * with a Cancel beside it. Connected, the row says so and offers Disconnect,
 * asked first; a sign-in OpenAI has since refused says so and offers
 * Continue with ChatGPT again. Connected, a switch beneath the row says
 * whether the plan pays for the account's coding agents on GPT models by
 * default, on as it is connected; Start may pick another payer for one
 * agent whatever it says. Nothing here ever holds a token: a press
 * crosses to the host and the keys come back as hints and statuses alone.
 *
 * The first sign-in on this Mac is met with OpenAI's notice that Luke uses
 * the ChatGPT plan (developers.openai.com/siwc/ui-ux-guidelines), dismissed
 * with Got it and never shown again here, which is kept in the renderer's
 * own storage as the sidebar's folds are.
 */

/** What the row says, and the notice OpenAI's guidelines word. */
const WORDS = {
  TITLE: "Codex",
  LABEL: "ChatGPT plan",
  OFFER: "Run Codex agents on your ChatGPT plan or credits balance instead of Luke's usage.",
  CONNECTED: "Connected",
  SIGNED_OUT: "ChatGPT ended this sign-in. Continue with ChatGPT to connect again.",
  UNREADABLE: "This sign-in can no longer be read. Continue with ChatGPT to connect again.",
  INELIGIBLE:
    "OpenAI says this ChatGPT account isn't eligible for Codex. Continue with ChatGPT to use another.",
  LIMIT_REACHED: "Usage limit reached",
  CONTINUE: "Continue with ChatGPT",
  WAITING: "Waiting for ChatGPT…",
  CANCEL: "Cancel",
  DISCONNECT: "Disconnect",
  SIGNED_OUT_PAGE: "Sign in to use your ChatGPT plan.",
  READ_FAILED: "Your ChatGPT plan could not be read.",
  SIGN_IN_FAILED: "Luke couldn't reach ChatGPT. Try again.",
  DISCONNECT_FAILED: "ChatGPT could not be disconnected. Try again.",
  REVOCATION_UNCONFIRMED:
    "Luke no longer holds your ChatGPT sign-in, but OpenAI didn't confirm it ended. To end it there too, remove Luke in your ChatGPT settings.",
  NOTICE_TITLE: "You're using your ChatGPT plan",
  NOTICE_BODY:
    "Eligible usage in Luke uses your ChatGPT plan. Manage usage in your ChatGPT settings.",
  GOT_IT: "Got it",
  FOR_AGENTS: "Use my ChatGPT plan for coding agents",
  FOR_AGENTS_DETAIL:
    "New agents on a GPT model run on Codex with your plan. You can pick another payer when you start one.",
  FOR_AGENTS_FAILED: "The default could not be changed. Try again.",
} as const;

/** Where this Mac keeps that the notice was seen, in the renderer's own storage. */
const NOTICE_SEEN_KEY = "luke.chatGptFirstSignInNoticeSeen";

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** Whether the first sign-in's notice was seen on this Mac; a storage that refuses reads as seen, so it never nags. */
function noticeSeen(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

function markNoticeSeen(): void {
  try {
    window.localStorage.setItem(NOTICE_SEEN_KEY, "1");
  } catch {
    // A storage that refuses the write shows the notice again on a later first sign-in, which is no harm.
  }
}

/** The account's ChatGPT sign-in among its subscriptions, or none. */
function chatGptOf(answer: ProviderKeysAnswer): SubscriptionKeySummary | undefined {
  return answer.subscriptions?.find((one) => one.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH);
}

/** Whether a stored sign-in still stands for the plan: kept, answered by OpenAI, or only out of usage until its limit resets. */
function standing(stored: SubscriptionKeySummary): boolean {
  return (
    stored.status === PROVIDER_KEY_STATUS.UNVERIFIED ||
    stored.status === PROVIDER_KEY_STATUS.VERIFIED ||
    stored.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
  );
}

/** What a sign-in that no longer stands says on its row. */
function endedWords(stored: SubscriptionKeySummary): string {
  switch (stored.status) {
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.UNREADABLE;
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return WORDS.INELIGIBLE;
    default:
      return WORDS.SIGNED_OUT;
  }
}

/** What the row says under its label, by where the sign-in stands. */
function rowDescription(stored: SubscriptionKeySummary | undefined): React.ReactNode {
  if (stored === undefined) return WORDS.OFFER;
  if (stored.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) {
    return (
      <span className="settings-state" data-state="attention" role="status">
        {stored.limitResetsAt === undefined
          ? WORDS.LIMIT_REACHED
          : `${WORDS.LIMIT_REACHED} · Resets ${dayAndTimeText(stored.limitResetsAt)}`}
      </span>
    );
  }
  if (standing(stored)) {
    return (
      <>
        <span className="settings-state" data-state="connected">
          {WORDS.CONNECTED}
        </span>
        {` · Added ${dayText(stored.addedAt)}`}
      </>
    );
  }
  return (
    <span className="settings-state" data-state="attention" role="alert">
      {endedWords(stored)}
    </span>
  );
}

/** OpenAI's first-sign-in notice: what using the plan means, and Got it. */
function FirstSignInNotice({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  const gotIt = useRef<HTMLButtonElement | null>(null);
  const bodyId = useId();
  return (
    <Dialog
      title={WORDS.NOTICE_TITLE}
      describedBy={bodyId}
      initialFocus={gotIt}
      onDismiss={onDismiss}
      actions={
        <Button ref={gotIt} variant={BUTTON_VARIANT.PRIMARY} onClick={onDismiss}>
          {WORDS.GOT_IT}
        </Button>
      }
    >
      <Text id={bodyId} tone={TEXT_TONE.MUTED}>
        {WORDS.NOTICE_BODY}
      </Text>
    </Dialog>
  );
}

/** The Codex group: the ChatGPT plan's row, or why it cannot be drawn. */
export function ChatGptPlanSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const [answer, setAnswer] = useState<ProviderKeysAnswer | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState(false);
  const stored = answer === undefined ? undefined : chatGptOf(answer);

  // The page opening reads the sign-in as the service holds it now, which a renewal may just have marked.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setAnswer(undefined);
    setReadFailed(false);
    act(ACT_KIND.PROVIDER_KEYS_READ).then(
      (read) => {
        if (!live) return;
        if ("failure" in read) setReadFailed(true);
        else setAnswer(read);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt]);

  const signIn = useCallback(() => {
    setSigningIn(true);
    setError(undefined);
    setUnconfirmed(false);
    void act(ACT_KIND.CHATGPT_SIGN_IN)
      .catch(() => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }) as const)
      .then((outcome) => {
        setSigningIn(false);
        if ("cancelled" in outcome) return;
        if ("refused" in outcome) {
          setError(outcome.refused);
          return;
        }
        if ("failure" in outcome) {
          setError(WORDS.SIGN_IN_FAILED);
          return;
        }
        setAnswer(outcome);
        if (!noticeSeen()) setNotice(true);
      });
  }, [act]);

  const cancel = useCallback(() => {
    void act(ACT_KIND.CHATGPT_SIGN_IN_CANCEL).catch(() => undefined);
  }, [act]);

  const disconnect = useCallback(
    (): Promise<ActionResult> =>
      act(ACT_KIND.PROVIDER_KEYS_REMOVE, {
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      })
        .catch(() => undefined)
        .then((removed): ActionResult => {
          if (removed === undefined || "failure" in removed) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.DISCONNECT_FAILED };
          }
          setAnswer(removed);
          setUnconfirmed(removed.revocationUnconfirmed === true);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act],
  );
  const turnForAgents = useCallback(
    (forAgents: boolean): Promise<ActionResult> =>
      act(ACT_KIND.PROVIDER_KEYS_FOR_AGENTS, {
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        forAgents,
      })
        .catch(() => undefined)
        .then((turned): ActionResult => {
          if (turned === undefined || "failure" in turned) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.FOR_AGENTS_FAILED };
          }
          setAnswer(turned);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act],
  );
  const removal = useConfirmDialog(
    { subject: stored !== undefined, surfaceOpen: true },
    disconnect,
  );

  const dismissNotice = useCallback(() => {
    markNoticeSeen();
    setNotice(false);
  }, []);

  const connected = stored !== undefined && standing(stored);
  return (
    <div className={NO_CAPTURE}>
      <SettingsSection title={WORDS.TITLE}>
        {!signedIn ? (
          <SettingsLine>{WORDS.SIGNED_OUT_PAGE}</SettingsLine>
        ) : answer !== undefined ? (
          <div className="api-key">
            <SettingsRow
              leading={
                <span className="settings-row-mark">
                  <HarnessMark provider={MODEL_PROVIDER.OPENAI} />
                </span>
              }
              label={WORDS.LABEL}
              description={rowDescription(stored)}
              error={error}
              below={
                unconfirmed
                  ? () => (
                      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                        {WORDS.REVOCATION_UNCONFIRMED}
                      </Text>
                    )
                  : undefined
              }
            >
              {() =>
                connected ? (
                  <Button
                    variant={BUTTON_VARIANT.OUTLINE}
                    disabled={removal.busy}
                    onClick={removal.ask}
                  >
                    {WORDS.DISCONNECT}
                  </Button>
                ) : (
                  <>
                    {signingIn ? (
                      <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={cancel}>
                        {WORDS.CANCEL}
                      </TextButton>
                    ) : null}
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      busy={signingIn}
                      busyLabel={WORDS.WAITING}
                      onClick={signIn}
                    >
                      {WORDS.CONTINUE}
                    </Button>
                  </>
                )
              }
            </SettingsRow>
            {connected ? (
              <SwitchRow
                label={WORDS.FOR_AGENTS}
                detail={WORDS.FOR_AGENTS_DETAIL}
                checked={stored.forAgents !== false}
                onChange={turnForAgents}
              />
            ) : null}
          </div>
        ) : readFailed ? (
          <SettingsLine>
            <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
              {WORDS.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label="Loading your ChatGPT plan" rows={1} marked />
        )}
      </SettingsSection>
      <ConfirmDialog
        confirm={removal}
        question={{
          title: "Disconnect your ChatGPT plan?",
          body: "Codex agents will stop running on your ChatGPT plan, and Luke ends its sign-in with OpenAI.",
          verb: WORDS.DISCONNECT,
          running: "Disconnecting…",
        }}
      />
      {notice ? <FirstSignInNotice onDismiss={dismissNotice} /> : null}
    </div>
  );
}
