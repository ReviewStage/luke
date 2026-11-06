import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  CHATGPT_DEVICE_FAILURE_MESSAGE,
  CHATGPT_DEVICE_LOGIN,
  type ChatGptDeviceStartAnswer,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  COPY_FIELD_WIDTH,
  COPY_LOOK,
  CopyButton,
  CopyField,
  DIALOG_SIZE,
  Dialog,
  ErrorLine,
  GAP,
  Inline,
  NumberedStep,
  NumberedSteps,
  SpinnerRegion,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WaitingLine,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { refusedShown } from "../failure-report.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";

/**
 * connect-codex-dialog.tsx -- Connect Codex: a ChatGPT plan connected through Codex's device-code login, which the service runs, on the desktop and the web alike.
 *
 * Opening the dialog asks the service for a code (`CHATGPT_DEVICE_START`)
 * and says the two steps that use it: turn device code authorization on
 * in ChatGPT, then sign in and enter the code, which it shows to copy, at
 * the verification page, which opens outside the window. Under them it waits on Codex
 * (`CHATGPT_DEVICE_WAIT`), one answer the host gives once the login
 * settles, asking after it on the interval the service named on a
 * `Schedule` of its own. Connected, it tells its
 * owner, who closes it; the keys the answer carries are laid where the host
 * holds them, so the row says the plan is connected as the dialog goes.
 * Expired, refused, or canceled, it says the service's fixed sentence and
 * offers Try again, which starts afresh, as an ask that went unanswered
 * does. Close, Escape, or the window
 * going away withdraw a login still waiting (`CHATGPT_DEVICE_CANCEL`), as
 * does a code that lands after the dialog closed or started over, so no
 * login stands that no dialog asks after.
 *
 * Every word is the app's own and shows in a screen recording, but the
 * code, which is masked.
 */

const WORDS = {
  TITLE: "Connect Codex",
  SUBTITLE: "Use your own subscription for this provider's models",
  CLOSE: "Close",
  TURN_ON: "In ChatGPT Settings → Security, turn on device code authorization for Codex",
  TURN_ON_HINT:
    "If you don't see this option, ask your workspace admin to enable device code authentication for Codex CLI",
  CODE: "Code",
  ENTER_CODE: "Sign in to ChatGPT, select your workspace if prompted, and enter the code:",
  VERIFICATION_PAGE: "Verification page",
  WAITING: "Waiting for Codex",
  GETTING_CODE: "Getting a code",
  START_FAILED: "Couldn't reach ChatGPT for a code. Try again.",
  WAIT_FAILED: "Couldn't reach ChatGPT to finish connecting. Try again.",
  TRY_AGAIN: "Try again",
} as const;

/** Where the dialog stands: getting a code, waiting on it, or ended in a failure Try again starts over from. */
const STANDING = {
  STARTING: "starting",
  WAITING: "waiting",
  FAILED: "failed",
} as const;

type Standing =
  | { readonly kind: typeof STANDING.STARTING }
  | { readonly kind: typeof STANDING.WAITING; readonly login: ChatGptDeviceStartAnswer }
  | { readonly kind: typeof STANDING.FAILED; readonly words: string };

const STARTING: Standing = { kind: STANDING.STARTING };

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/**
 * The login while the dialog is `open`: a code asked for as it opens and on
 * Try again, the login asked after while it waits, and withdrawn as the
 * dialog closes or goes away with it still waiting.
 */
function useDeviceLogin(
  open: boolean,
  onConnected: () => void,
): { standing: Standing; retry: () => void } {
  const { act, tell } = useAct();
  const [standing, setStanding] = useState<Standing>(STARTING);
  // Note that a ref counts the starts, because a start's answer reads it as it lands, which no render stands between.
  const starts = useRef(0);
  const connected = useRef(onConnected);
  connected.current = onConnected;

  const start = useCallback(() => {
    starts.current += 1;
    const mine = starts.current;
    setStanding(STARTING);
    void act(ACT_KIND.CHATGPT_DEVICE_START)
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (mine !== starts.current) {
          if (!("failure" in answer)) {
            tell(ACT_KIND.CHATGPT_DEVICE_CANCEL, { loginId: answer.loginId });
          }
          return;
        }
        setStanding(
          "failure" in answer
            ? { kind: STANDING.FAILED, words: WORDS.START_FAILED }
            : { kind: STANDING.WAITING, login: answer },
        );
      });
  }, [act, tell]);

  useEffect(() => {
    if (!open) return;
    start();
    return () => {
      // Note that closing counts as a start, so a code still on its way lands nowhere and is withdrawn.
      starts.current += 1;
      setStanding(STARTING);
    };
  }, [open, start]);

  const login = standing.kind === STANDING.WAITING ? standing.login : undefined;
  useEffect(() => {
    if (login === undefined) return;
    const { loginId, intervalSeconds } = login;
    let waiting = true;
    void act(ACT_KIND.CHATGPT_DEVICE_WAIT, { loginId, intervalSeconds })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (!waiting) return;
        waiting = false;
        if ("failure" in answer) {
          setStanding({ kind: STANDING.FAILED, words: WORDS.WAIT_FAILED });
          return;
        }
        const { outcome } = answer;
        if (outcome === CHATGPT_DEVICE_LOGIN.CONNECTED) {
          connected.current();
          return;
        }
        // Note that the host answers only once the login settles, so a pending answer is none it gives.
        if (outcome === CHATGPT_DEVICE_LOGIN.PENDING) return;
        setStanding({
          kind: STANDING.FAILED,
          words: answer.message ?? CHATGPT_DEVICE_FAILURE_MESSAGE[outcome],
        });
      });
    return () => {
      if (!waiting) return;
      waiting = false;
      tell(ACT_KIND.CHATGPT_DEVICE_CANCEL, { loginId });
    };
  }, [login, act, tell]);

  return { standing, retry: start };
}

/** The two steps over a code handed out, and the wait on Codex under them, at the card's own gap. */
function Steps({ login }: { login: ChatGptDeviceStartAnswer }): React.JSX.Element {
  const openLink = useOpenLink();
  const url = login.verificationUrl;
  return (
    <>
      <NumberedSteps>
        <NumberedStep number={1} title={WORDS.TURN_ON}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {WORDS.TURN_ON_HINT}
          </Text>
        </NumberedStep>
        <NumberedStep number={2} title={WORDS.ENTER_CODE}>
          <ReplayMask>
            <CopyField
              label={WORDS.CODE}
              value={login.userCode}
              what="code"
              copy={copyThroughShell}
              width={COPY_FIELD_WIDTH.HUG}
            />
          </ReplayMask>
          <Inline gap={GAP.CONTROL}>
            <ButtonLink
              href={url}
              variant={BUTTON_VARIANT.OUTLINE}
              external
              onClick={linkPressOf(openLink, url)}
            >
              {WORDS.VERIFICATION_PAGE}
            </ButtonLink>
            <CopyButton look={COPY_LOOK.BUTTON} text={url} what="link" copy={copyThroughShell} />
          </Inline>
        </NumberedStep>
      </NumberedSteps>
      <WaitingLine>{WORDS.WAITING}</WaitingLine>
    </>
  );
}

/**
 * Connect Codex over the window while `open`: its title, a line under it,
 * and close, which withdraws the login, then the code's steps, the wait, or why it
 * ended with Try again. `onConnected` hears the plan connected; its owner
 * closes the dialog then.
 */
export function ConnectCodexDialog({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}): React.JSX.Element {
  const { standing, retry } = useDeviceLogin(open, onConnected);
  return (
    <Dialog
      open={open}
      title={WORDS.TITLE}
      subtitle={WORDS.SUBTITLE}
      closeLabel={WORDS.CLOSE}
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      onDismiss={onClose}
    >
      {standing.kind === STANDING.STARTING ? (
        <SpinnerRegion label={WORDS.GETTING_CODE} />
      ) : standing.kind === STANDING.WAITING ? (
        <Steps login={standing.login} />
      ) : (
        <Stack gap={GAP.CONTROL}>
          <ErrorLine
            level={ANNOUNCE.ALERT}
            error={refusedShown(standing.words, FAILURE_SURFACE.AGENT_KEY_SAVE)}
          />
          <Inline>
            <Button variant={BUTTON_VARIANT.PRIMARY} onClick={retry}>
              {WORDS.TRY_AGAIN}
            </Button>
          </Inline>
        </Stack>
      )}
    </Dialog>
  );
}
