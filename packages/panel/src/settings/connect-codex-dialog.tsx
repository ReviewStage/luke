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
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { copyThroughShell } from "../copy-feedback.js";
import { refusedShown } from "../failure-report.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";

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

function useDeviceLogin(
  open: boolean,
  onConnected: () => void,
): { standing: Standing; retry: () => void } {
  const { mutateAsync: sendChatgptDeviceStart } = useMutation(
    actMutation(ACT_KIND.CHATGPT_DEVICE_START),
  );
  const { mutateAsync: sendChatgptDeviceWait } = useMutation(
    actMutation(ACT_KIND.CHATGPT_DEVICE_WAIT),
  );
  const { mutate: sendChatgptDeviceCancel } = useMutation(
    actMutation(ACT_KIND.CHATGPT_DEVICE_CANCEL),
  );
  const [standing, setStanding] = useState<Standing>(STARTING);
  const starts = useRef(0);
  const connected = useRef(onConnected);
  connected.current = onConnected;

  const start = useCallback(() => {
    starts.current += 1;
    const mine = starts.current;
    setStanding(STARTING);
    void sendChatgptDeviceStart()
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (mine !== starts.current) {
          if (!("failure" in answer)) {
            sendChatgptDeviceCancel({ loginId: answer.loginId });
          }
          return;
        }
        setStanding(
          "failure" in answer
            ? { kind: STANDING.FAILED, words: WORDS.START_FAILED }
            : { kind: STANDING.WAITING, login: answer },
        );
      });
  }, [sendChatgptDeviceStart, sendChatgptDeviceCancel]);

  useEffect(() => {
    if (!open) return;
    start();
    return () => {
      starts.current += 1;
      setStanding(STARTING);
    };
  }, [open, start]);

  const login = standing.kind === STANDING.WAITING ? standing.login : undefined;
  useEffect(() => {
    if (login === undefined) return;
    const { loginId, intervalSeconds } = login;
    let waiting = true;
    void sendChatgptDeviceWait({ loginId, intervalSeconds })
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
        if (outcome === CHATGPT_DEVICE_LOGIN.PENDING) return;
        setStanding({
          kind: STANDING.FAILED,
          words: answer.message ?? CHATGPT_DEVICE_FAILURE_MESSAGE[outcome],
        });
      });
    return () => {
      if (!waiting) return;
      waiting = false;
      sendChatgptDeviceCancel({ loginId });
    };
  }, [login, sendChatgptDeviceWait, sendChatgptDeviceCancel]);

  return { standing, retry: start };
}

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
          <Inline>
            <ButtonLink
              href={url}
              variant={BUTTON_VARIANT.OUTLINE}
              external
              onClick={linkPressOf(openLink, url)}
            >
              {WORDS.VERIFICATION_PAGE}
            </ButtonLink>
          </Inline>
        </NumberedStep>
      </NumberedSteps>
      <WaitingLine>{WORDS.WAITING}</WaitingLine>
    </>
  );
}

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
