import { signedInAccountId } from "@repo/credentials/snapshot";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeyStatus,
  type ProviderKeySummary,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dayAndTimeText } from "@repo/features/time-format";
import { readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActPayload } from "@repo/host/contract";
import { searchAnchorProps } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import {
  ANNOUNCE,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  DIALOG_SIZE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  type DialogQuestion,
  ErrorState,
  FootQuestion,
  GAP,
  Inline,
  JUSTIFY,
  LAYOUT_ELEMENT,
  MARK_PROVIDER,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_INDENT,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SecretField,
  SettingsLine,
  SettingsRow,
  type SettingsRowControl,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSection,
  STEP_STATE,
  Stack,
  Step,
  Steps,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TextLink,
  useConfirmDialog,
} from "@repo/ui";
import { InfoIcon } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
import { providerKeysQuery, providerKeysRetryMutation } from "../live-reads.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { ConnectCodexDialog } from "./connect-codex-dialog.js";

const NO_CAPTURE = "ph-no-capture";

const NOTICE_SEEN_KEY = "app.chatGptFirstSignInNoticeSeen";

const CREDENTIAL = {
  SUBSCRIPTION: "subscription",
  API_KEY: "api_key",
} as const;

type Credential = (typeof CREDENTIAL)[keyof typeof CREDENTIAL];

const ROW_ACT = {
  CONNECT: "connect",
  MANAGE: "manage",
  SIGN_IN_AGAIN: "sign_in_again",
  MANAGE_USAGE: "manage_usage",
} as const;

type RowAct = (typeof ROW_ACT)[keyof typeof ROW_ACT];

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

interface Connection {
  readonly words: string;
  readonly state: SettingsRowState;
  readonly act: RowAct;
}

interface Harness {
  readonly name: string;
  readonly planName: string;
  readonly plan: SubscriptionKeySummary["kind"];
  readonly keyName: string;
  readonly keyUrl: string;
  readonly keySite: string;
  readonly keyShape: string;
  readonly anchor: string;
  readonly takes: string;
}

const HARNESS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    name: "Claude",
    planName: "Claude plan",
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    keyName: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keySite: "Anthropic Console",
    keyShape: "sk-ant-api03-…",
    anchor: SETTINGS_SECTION.CLAUDE,
    takes: "Claude plan or Anthropic API key",
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    planName: "ChatGPT plan",
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    keyName: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keySite: "OpenAI Platform",
    keyShape: "sk-proj-…",
    anchor: SETTINGS_SECTION.CODEX,
    takes: "ChatGPT plan or OpenAI API key",
  },
} as const satisfies Record<ProviderKeyProvider, Harness>;

const KEY_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: true,
  mark: SETTINGS_ROW_MARK_WIDTH,
  controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
};

const HARNESSES: readonly ProviderKeyProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

const WORDS = {
  READ_FAILED: "Your keys could not be read.",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  CONNECT: "Connect",
  CONNECT_CHATGPT: "Connect ChatGPT plan",
  SETUP: "Connect an agent",
  MANAGE: "Manage",
  SIGN_IN_AGAIN: "Sign in again",
  MANAGE_USAGE: "Manage usage",
  NOT_CONNECTED: "Not connected",
  NEEDS_ATTENTION: "Needs attention",
  SIGNED_OUT_OF_PLAN: "Signed out",
  API_KEY: "API key",
  CANCEL: "Cancel",
  TOKEN_SHAPE: "sk-ant-oat01-…",
  SAVING_TOKEN: "Saving the token",
  CHECKING_KEY: "Checking the key",
  DISCONNECT: "Disconnect",
  DISCONNECTING: "Disconnecting",
  REMOVE: "Remove",
  REMOVE_KEY: "Remove key",
  REMOVING: "Removing",
  REPLACE: "Replace",
  REPLACE_TOKEN: "Replace token",
  SAVED: "Saved",
  RUN_SETUP_TOKEN: "Run this in a terminal",
  PASTE_TOKEN: "Paste the token it prints",
  CREATE_KEY: "Create an API key",
  PASTE_KEY: "Paste the key",
  SETUP_TOKEN_COMMAND: "claude setup-token",
  SETUP_TOKEN_COMMAND_LABEL: "Setup-token command",
  COMMAND: "command",
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  USAGE_LIMIT: "Usage limit reached",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_SIGNED_OUT: "Signed out of ChatGPT.",
  CHATGPT_UNREADABLE: "This sign-in can no longer be read.",
  CHATGPT_INELIGIBLE:
    "OpenAI says this ChatGPT plan isn't eligible for Codex. Connect to use another.",
  REVOCATION_UNCONFIRMED: `${PRODUCT_NAME} signed out of ChatGPT, but OpenAI didn't confirm it ended. To end it there too, remove ${PRODUCT_NAME} in your ChatGPT settings.`,
  NOTICE_TITLE: "You're using your ChatGPT plan",
  NOTICE_BODY: `Eligible usage in ${PRODUCT_NAME} uses your ChatGPT plan. Manage usage in your ChatGPT settings.`,
  GOT_IT: "Got it",
  SAVE_TOKEN_FAILED: "Couldn't save the token. Try again.",
  SAVE_KEY_FAILED: "Couldn't save the key. Try again.",
  REMOVE_KEY_FAILED: "Couldn't remove the key. Try again.",
  CLAUDE_DISCONNECT_FAILED: "Couldn't disconnect your Claude plan. Try again.",
  CHATGPT_DISCONNECT_FAILED: "Couldn't disconnect your ChatGPT plan. Try again.",
  DEFAULT_FAILED: "Couldn't change the default. Try again.",
} as const;

const ACCEPTED_KEY: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

const CLAUDE_DISCONNECT_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: WORDS.CLAUDE_DISCONNECT_FAILED,
};
const CHATGPT_DISCONNECT_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: WORDS.CHATGPT_DISCONNECT_FAILED,
};
const KEY_REMOVE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: WORDS.REMOVE_KEY_FAILED,
};

function planOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): SubscriptionKeySummary | undefined {
  return answer.subscriptions?.find((one) => one.kind === HARNESS[provider].plan);
}

function keyOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): ProviderKeySummary | undefined {
  return answer.keys.find((one) => one.provider === provider);
}

function standing(plan: SubscriptionKeySummary): boolean {
  return (
    plan.status === PROVIDER_KEY_STATUS.UNVERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.VERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
  );
}

function keyStanding(status: ProviderKeyStatus): boolean {
  return status === PROVIDER_KEY_STATUS.VERIFIED || status === PROVIDER_KEY_STATUS.UNVERIFIED;
}

function defaultOf(
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
): Credential | undefined {
  if (plan !== undefined && plan.forAgents !== false) return CREDENTIAL.SUBSCRIPTION;
  if (key !== undefined) return CREDENTIAL.API_KEY;
  return undefined;
}

function connectionOf(
  provider: ProviderKeyProvider,
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
): Connection {
  const harness = HARNESS[provider];
  const chosen = defaultOf(plan, key);
  if (chosen === CREDENTIAL.API_KEY && key !== undefined) {
    const keyName = `${harness.keyName} ${WORDS.API_KEY}`;
    return keyStanding(key.status)
      ? {
          words: key.hint === "" ? keyName : `${keyName} ${key.hint}`,
          state: SETTINGS_ROW_STATE.CONNECTED,
          act: ROW_ACT.MANAGE,
        }
      : {
          words: `${keyName} · ${WORDS.NEEDS_ATTENTION}`,
          state: SETTINGS_ROW_STATE.ATTENTION,
          act: ROW_ACT.MANAGE,
        };
  }
  if (plan === undefined) {
    return { words: WORDS.NOT_CONNECTED, state: SETTINGS_ROW_STATE.PLAIN, act: ROW_ACT.CONNECT };
  }
  const chatGpt = plan.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH;
  if (plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) {
    return {
      words: `${harness.planName} · ${limitWords(plan)}`,
      state: SETTINGS_ROW_STATE.ATTENTION,
      act: chatGpt ? ROW_ACT.MANAGE_USAGE : ROW_ACT.MANAGE,
    };
  }
  if (standing(plan)) {
    return { words: harness.planName, state: SETTINGS_ROW_STATE.CONNECTED, act: ROW_ACT.MANAGE };
  }
  if (chatGpt && plan.status === PROVIDER_KEY_STATUS.INVALID) {
    return {
      words: `${harness.planName} · ${WORDS.SIGNED_OUT_OF_PLAN}`,
      state: SETTINGS_ROW_STATE.ATTENTION,
      act: ROW_ACT.SIGN_IN_AGAIN,
    };
  }
  return {
    words: `${harness.planName} · ${WORDS.NEEDS_ATTENTION}`,
    state: SETTINGS_ROW_STATE.ATTENTION,
    act: ROW_ACT.MANAGE,
  };
}

function rowActWords(act: RowAct, harness: string): { words: string; label: string } {
  switch (act) {
    case ROW_ACT.CONNECT:
      return { words: WORDS.CONNECT, label: `${WORDS.CONNECT} ${harness}` };
    case ROW_ACT.MANAGE:
      return { words: WORDS.MANAGE, label: `${WORDS.MANAGE} ${harness}` };
    case ROW_ACT.SIGN_IN_AGAIN:
      return { words: WORDS.SIGN_IN_AGAIN, label: `Sign in to ${harness} again` };
    case ROW_ACT.MANAGE_USAGE:
      return { words: WORDS.MANAGE_USAGE, label: `Manage ${harness} usage` };
  }
}

function limitWords(plan: SubscriptionKeySummary): string {
  return plan.limitResetsAt === undefined
    ? WORDS.USAGE_LIMIT
    : `${WORDS.USAGE_LIMIT} · Resets ${dayAndTimeText(plan.limitResetsAt)}`;
}

function tokenWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNVERIFIED:
    case PROVIDER_KEY_STATUS.VERIFIED:
      return WORDS.CONNECTED;
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return limitWords(plan);
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return WORDS.TOKEN_QUOTA;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.TOKEN_UNREADABLE;
    default:
      return WORDS.TOKEN_INVALID;
  }
}

function signInWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNVERIFIED:
    case PROVIDER_KEY_STATUS.VERIFIED:
      return WORDS.CONNECTED;
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return limitWords(plan);
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.CHATGPT_UNREADABLE;
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return WORDS.CHATGPT_INELIGIBLE;
    default:
      return WORDS.CHATGPT_SIGNED_OUT;
  }
}

function keyStatusWords(
  provider: ProviderKeyProvider,
  status: ProviderKeyStatus,
): string | undefined {
  const name = HARNESS[provider].keyName;
  switch (status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
    case PROVIDER_KEY_STATUS.UNVERIFIED:
      return undefined;
    case PROVIDER_KEY_STATUS.INVALID:
      return `${name} rejected this key.`;
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return `Out of credit at ${name}.`;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return "This key can no longer be read.";
  }
}

function keyRejectionWords(provider: ProviderKeyProvider, rejection: ProviderKeyRejection): string {
  const name = HARNESS[provider].keyName;
  switch (rejection) {
    case PROVIDER_KEY_REJECTION.INVALID:
      return `${name} didn't accept this key. Check it and try again.`;
    case PROVIDER_KEY_REJECTION.WRONG_PROVIDER: {
      const other =
        provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
          ? PROVIDER_KEY_PROVIDER.OPENAI
          : PROVIDER_KEY_PROVIDER.ANTHROPIC;
      return `This looks like an ${HARNESS[other].keyName} key. Paste it under ${HARNESS[other].name}.`;
    }
    case PROVIDER_KEY_REJECTION.UNREACHABLE:
      return `Couldn't reach ${name} to check this key. Try again.`;
    case PROVIDER_KEY_REJECTION.TOO_MANY_TRIES:
      return "Too many tries in the last hour. Try again later.";
  }
}

function tokenRejectionWords(rejection: ProviderKeyRejection): string {
  return rejection === PROVIDER_KEY_REJECTION.TOO_MANY_TRIES
    ? "Too many tries in the last hour. Try again later."
    : "That isn't a Claude setup-token. Run claude setup-token and paste what it prints.";
}

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
  } catch {}
}

function State({
  ok,
  block = false,
  children,
}: {
  ok: boolean;
  block?: boolean;
  children: string;
}): React.JSX.Element {
  useAnnounceShown(ANNOUNCE.ALERT, ok ? "" : children);
  return (
    <SettingsRowStateLine
      state={ok ? SETTINGS_ROW_STATE.CONNECTED : SETTINGS_ROW_STATE.ATTENTION}
      block={block}
    >
      {children}
    </SettingsRowStateLine>
  );
}

function CredentialQuestion({
  inDialog,
  confirm,
  question,
}: {
  inDialog: boolean;
  confirm: DialogConfirm;
  question: DialogQuestion;
}): React.JSX.Element {
  const shown = { ...question, replayUnmasked: true };
  return inDialog ? (
    <FootQuestion confirm={confirm} question={shown} />
  ) : (
    <ConfirmDialog open confirm={confirm} question={shown} />
  );
}

function GetKeyLink({
  provider,
  onOpened,
}: {
  provider: ProviderKeyProvider;
  onOpened: () => void;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const { keyUrl, keySite } = HARNESS[provider];
  return (
    <TextLink
      look={TEXT_LINK_LOOK.UNDERLINED}
      href={keyUrl}
      external
      onClick={(event) => {
        event.preventDefault();
        openLink(keyUrl);
        onOpened();
      }}
    >
      {`Open ${keySite}`}
    </TextLink>
  );
}

interface PastedSecret {
  readonly open: boolean;
  readonly editing: boolean;
  readonly pasted: string;
  readonly saving: boolean;
  readonly rejection: string | undefined;
  readonly edit: () => void;
  readonly cancel: () => void;
  readonly change: (value: string) => void;
  readonly save: () => void;
  readonly paste: (value: string) => void;
}

function usePastedSecret({
  held,
  field,
  payload,
  failed,
  refused,
}: {
  held: boolean;
  field: React.RefObject<HTMLInputElement | null>;
  payload: (key: string) => PortActPayload<typeof ACT_KIND.PROVIDER_KEYS_SAVE>;
  failed: string;
  refused: (rejection: ProviderKeyRejection) => string;
}): PastedSecret {
  const { mutateAsync: sendProviderKeysSave } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_SAVE),
  );
  const [editing, setEditing] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const cancel = useCallback(() => {
    setPasted("");
    setRejection(undefined);
    setEditing(false);
  }, []);
  const save = (value = pasted) => {
    const key = value.trim();
    if (key === "" || saving) return;
    setSaving(true);
    setRejection(undefined);
    void sendProviderKeysSave(payload(key))
      .catch(() => undefined)
      .then((answer) => {
        setSaving(false);
        if (answer === undefined || "failure" in answer) {
          setRejection(failed);
          return;
        }
        if (answer.rejected !== undefined) {
          setRejection(refused(answer.rejected));
          return;
        }
        cancel();
      });
  };
  return {
    open: !held || editing,
    editing,
    pasted,
    saving,
    rejection,
    edit: () => setEditing(true),
    cancel,
    change: (value) => {
      setPasted(value);
      setRejection(undefined);
    },
    save: () => save(),
    paste: (value) => save(value),
  };
}

interface FirstStep {
  readonly title: string;
  readonly body: (done: () => void) => React.ReactNode;
}

function PasteSteps({
  field,
  secret,
  first,
  label,
  held,
  placeholder,
  running,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  secret: PastedSecret;
  first: FirstStep;
  label: string;
  held: boolean;
  placeholder: string;
  running: string;
}): React.JSX.Element {
  const [firstDone, setFirstDone] = useState(false);
  return (
    <Stack
      as={LAYOUT_ELEMENT.FORM}
      onSubmit={(event) => {
        event.preventDefault();
        secret.save();
      }}
    >
      <Steps>
        <Step
          number={1}
          title={first.title}
          state={firstDone ? STEP_STATE.DONE : STEP_STATE.CURRENT}
        >
          {first.body(() => setFirstDone(true))}
        </Step>
        <Step number={2} state={firstDone ? STEP_STATE.CURRENT : STEP_STATE.TO_DO}>
          <SecretField
            ref={field}
            label={label}
            description={secret.saving ? running : undefined}
            error={refusedShown(secret.rejection, FAILURE_SURFACE.AGENT_KEY_SAVE)}
            saved={held}
            placeholder={placeholder}
            disabled={secret.saving}
            value={secret.pasted}
            onEscape={held ? secret.cancel : undefined}
            onChange={secret.change}
            onPasted={secret.paste}
          />
        </Step>
      </Steps>
    </Stack>
  );
}

function HeldLine({
  children,
  presses,
}: {
  children: React.ReactNode;
  presses: React.ReactNode;
}): React.JSX.Element {
  return (
    <Inline justify={JUSTIFY.BETWEEN}>
      {children}
      <Inline wrap={false}>{presses}</Inline>
    </Inline>
  );
}

const SETUP_TOKEN_FIRST: FirstStep = {
  title: WORDS.RUN_SETUP_TOKEN,
  body: (done) => (
    <CopyField
      label={WORDS.SETUP_TOKEN_COMMAND_LABEL}
      value={WORDS.SETUP_TOKEN_COMMAND}
      what={WORDS.COMMAND}
      copy={(text) => copyThroughShell(text).then(done)}
      width={COPY_FIELD_WIDTH.FULL}
      prompt={COPY_FIELD_PROMPT.SHELL}
    />
  ),
};

function keyFirst(provider: ProviderKeyProvider): FirstStep {
  return {
    title: WORDS.CREATE_KEY,
    body: (done) => <GetKeyLink provider={provider} onOpened={done} />,
  };
}

const CLAUDE_DISCONNECT: DialogQuestion = {
  title: "Disconnect your Claude plan?",
  body: `Claude agents stop running on your Claude plan, and ${PRODUCT_NAME} deletes its token.`,
  verb: "Disconnect Claude plan",
  running: WORDS.DISCONNECTING,
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

const CHATGPT_DISCONNECT: DialogQuestion = {
  title: "Disconnect your ChatGPT plan?",
  body: `Codex agents stop running on your ChatGPT plan, and ${PRODUCT_NAME} signs out of ChatGPT.`,
  verb: "Disconnect ChatGPT plan",
  running: WORDS.DISCONNECTING,
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

function useClaudePlan(
  plan: SubscriptionKeySummary | undefined,
  field: React.RefObject<HTMLInputElement | null>,
): { secret: PastedSecret; removal: DialogConfirm } {
  const { mutateAsync: sendProviderKeysRemove, ...keyRemoving } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_REMOVE),
  );
  const secret = usePastedSecret({
    held: plan !== undefined,
    field,
    payload: (key) => ({
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key,
    }),
    failed: WORDS.SAVE_TOKEN_FAILED,
    refused: tokenRejectionWords,
  });
  const { cancel } = secret;
  const disconnect = useCallback(
    (): Promise<ActionResult> =>
      sendProviderKeysRemove({
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      })
        .catch(() => undefined)
        .then((removed): ActionResult => {
          if (removed === undefined || "failure" in removed) {
            return {
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: WORDS.CLAUDE_DISCONNECT_FAILED,
            };
          }
          cancel();
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [sendProviderKeysRemove, cancel],
  );
  const removalAct = useConfirmAct(keyRemoving, {
    send: disconnect,
    answered: (removed): ActionResult =>
      "failure" in removed ? CLAUDE_DISCONNECT_REFUSED : ACCEPTED_KEY,
    failed: () => CLAUDE_DISCONNECT_REFUSED,
  });
  const removal = useConfirmDialog(
    { subject: plan !== undefined, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
  return { secret, removal };
}

function ClaudePlanRow({
  plan,
  field,
}: {
  plan: SubscriptionKeySummary | undefined;
  field: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { secret, removal } = useClaudePlan(plan, field);
  const ok = plan !== undefined && standing(plan);
  const held = plan !== undefined;
  const wasHeld = useRef(held);
  useEffect(() => {
    if (wasHeld.current && !held) field.current?.focus();
    wasHeld.current = held;
  }, [held, field]);
  return (
    <>
      <SettingsRow
        label={HARNESS[PROVIDER_KEY_PROVIDER.ANTHROPIC].planName}
        indent={SETTINGS_ROW_INDENT.MARK}
        description={
          plan === undefined ? undefined : (
            <State ok={ok && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
              {tokenWords(plan)}
            </State>
          )
        }
        below={
          secret.open
            ? () => (
                <PasteSteps
                  field={field}
                  secret={secret}
                  first={SETUP_TOKEN_FIRST}
                  label={WORDS.PASTE_TOKEN}
                  held={plan !== undefined}
                  placeholder={WORDS.TOKEN_SHAPE}
                  running={WORDS.SAVING_TOKEN}
                />
              )
            : undefined
        }
      >
        {() =>
          plan === undefined ? null : secret.open ? (
            <TextButton onClick={secret.cancel}>{WORDS.CANCEL}</TextButton>
          ) : (
            <Inline wrap={false}>
              {ok ? null : <TextButton onClick={secret.edit}>{WORDS.REPLACE_TOKEN}</TextButton>}
              <TextButton onClick={removal.ask}>{WORDS.DISCONNECT}</TextButton>
            </Inline>
          )
        }
      </SettingsRow>
      <CredentialQuestion inDialog confirm={removal} question={CLAUDE_DISCONNECT} />
    </>
  );
}

function ClaudePlanInPlace({
  plan,
  field,
}: {
  plan: SubscriptionKeySummary | undefined;
  field: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { secret, removal } = useClaudePlan(plan, field);
  const ok = plan !== undefined && standing(plan);
  return (
    <>
      {plan === undefined || secret.open ? (
        <PasteSteps
          field={field}
          secret={secret}
          first={SETUP_TOKEN_FIRST}
          label={WORDS.PASTE_TOKEN}
          held={plan !== undefined}
          placeholder={WORDS.TOKEN_SHAPE}
          running={WORDS.SAVING_TOKEN}
        />
      ) : (
        <HeldLine
          presses={
            <>
              {ok ? null : <TextButton onClick={secret.edit}>{WORDS.REPLACE_TOKEN}</TextButton>}
              <TextButton onClick={removal.ask}>{WORDS.DISCONNECT}</TextButton>
            </>
          }
        >
          <State ok={ok && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
            {tokenWords(plan)}
          </State>
        </HeldLine>
      )}
      <CredentialQuestion inDialog={false} confirm={removal} question={CLAUDE_DISCONNECT} />
    </>
  );
}

function FirstSignInNotice({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  const gotIt = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    gotIt.current?.focus({ preventScroll: true });
  }, []);
  return (
    <Banner
      look={BANNER_LOOK.ROW}
      glyph={<InfoIcon />}
      actions={
        <Button ref={gotIt} variant={BUTTON_VARIANT.PRIMARY} onClick={onDismiss}>
          {WORDS.GOT_IT}
        </Button>
      }
    >
      <Text variant={TEXT_VARIANT.LABEL}>{WORDS.NOTICE_TITLE}</Text>
      <Text tone={TEXT_TONE.MUTED}>{WORDS.NOTICE_BODY}</Text>
    </Banner>
  );
}

interface ChatGptPlan {
  readonly plan: SubscriptionKeySummary | undefined;
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly unconfirmed: boolean;
  readonly notice: boolean;
  readonly connect: () => void;
  readonly closeConnect: () => void;
  readonly connectedNow: () => void;
  readonly dismissNotice: () => void;
  readonly removal: DialogConfirm;
}

function useChatGptPlan(plan: SubscriptionKeySummary | undefined): ChatGptPlan {
  const { mutateAsync: sendProviderKeysRemove, ...keyRemoving } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_REMOVE),
  );
  const [connecting, setConnecting] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState(false);

  const connect = useCallback(() => {
    setUnconfirmed(false);
    setConnecting(true);
  }, []);
  const closeConnect = useCallback(() => setConnecting(false), []);
  const connectedNow = useCallback(() => {
    setConnecting(false);
    if (!noticeSeen()) setNotice(true);
  }, []);

  const disconnect = useCallback(
    (): Promise<ActionResult> =>
      sendProviderKeysRemove({
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      })
        .catch(() => undefined)
        .then((removed): ActionResult => {
          if (removed === undefined || "failure" in removed) {
            return {
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: WORDS.CHATGPT_DISCONNECT_FAILED,
            };
          }
          setUnconfirmed(removed.revocationUnconfirmed === true);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [sendProviderKeysRemove],
  );
  const removalAct = useConfirmAct(keyRemoving, {
    send: disconnect,
    answered: (removed): ActionResult =>
      "failure" in removed ? CHATGPT_DISCONNECT_REFUSED : ACCEPTED_KEY,
    failed: () => CHATGPT_DISCONNECT_REFUSED,
  });
  const removal = useConfirmDialog(
    { subject: plan !== undefined, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
  const dismissNotice = useCallback(() => {
    markNoticeSeen();
    setNotice(false);
  }, []);
  return {
    plan,
    connected: plan !== undefined && standing(plan),
    connecting,
    unconfirmed,
    notice,
    connect,
    closeConnect,
    connectedNow,
    dismissNotice,
    removal,
  };
}

function ChatGptState({
  plan,
  connected,
}: {
  plan: SubscriptionKeySummary;
  connected: boolean;
}): React.JSX.Element {
  return (
    <State ok={connected && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
      {signInWords(plan)}
    </State>
  );
}

function ChatGptAfterward({ chatGpt }: { chatGpt: ChatGptPlan }): React.JSX.Element {
  return (
    <>
      {chatGpt.unconfirmed ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.REVOCATION_UNCONFIRMED}
        </Text>
      ) : null}
      {chatGpt.notice ? <FirstSignInNotice onDismiss={chatGpt.dismissNotice} /> : null}
    </>
  );
}

function ConnectButton({
  chatGpt,
  connectButton,
}: {
  chatGpt: ChatGptPlan;
  connectButton: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  return (
    <Button
      ref={connectButton}
      variant={BUTTON_VARIANT.OUTLINE}
      label={WORDS.CONNECT_CHATGPT}
      aria-haspopup="dialog"
      onClick={chatGpt.connect}
    >
      {WORDS.CONNECT}
    </Button>
  );
}

function ChatGptConnect({ chatGpt }: { chatGpt: ChatGptPlan }): React.JSX.Element {
  return (
    <ConnectCodexDialog
      open={chatGpt.connecting}
      onClose={chatGpt.closeConnect}
      onConnected={chatGpt.connectedNow}
    />
  );
}

function ChatGptPlanRow({
  plan,
  connectButton,
}: {
  plan: SubscriptionKeySummary | undefined;
  connectButton: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const chatGpt = useChatGptPlan(plan);
  const { connected } = chatGpt;
  return (
    <>
      <SettingsRow
        leading={
          <SettingsRowMark>
            <ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ROW} />
          </SettingsRowMark>
        }
        label={HARNESS[PROVIDER_KEY_PROVIDER.OPENAI].planName}
        description={
          plan === undefined ? undefined : <ChatGptState plan={plan} connected={connected} />
        }
        below={
          chatGpt.notice || chatGpt.unconfirmed
            ? () => <ChatGptAfterward chatGpt={chatGpt} />
            : undefined
        }
      >
        {() =>
          connected ? (
            <TextButton onClick={chatGpt.removal.ask}>{WORDS.DISCONNECT}</TextButton>
          ) : (
            <ConnectButton chatGpt={chatGpt} connectButton={connectButton} />
          )
        }
      </SettingsRow>
      <CredentialQuestion inDialog confirm={chatGpt.removal} question={CHATGPT_DISCONNECT} />
      <ChatGptConnect chatGpt={chatGpt} />
    </>
  );
}

function ChatGptPlanInPlace({
  chatGpt,
  connectButton,
}: {
  chatGpt: ChatGptPlan;
  connectButton: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const { plan, connected } = chatGpt;
  return (
    <Stack gap={GAP.TIGHT}>
      {plan === undefined ? null : connected ? (
        <HeldLine
          presses={<TextButton onClick={chatGpt.removal.ask}>{WORDS.DISCONNECT}</TextButton>}
        >
          <ChatGptState plan={plan} connected={connected} />
        </HeldLine>
      ) : (
        <ChatGptState plan={plan} connected={connected} />
      )}
      {connected ? null : (
        <Inline>
          <ConnectButton chatGpt={chatGpt} connectButton={connectButton} />
        </Inline>
      )}
      {chatGpt.unconfirmed ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.REVOCATION_UNCONFIRMED}
        </Text>
      ) : null}
    </Stack>
  );
}

function keyRemoval(provider: ProviderKeyProvider): DialogQuestion {
  const harness = HARNESS[provider];
  const name = harness.keyName;
  return {
    title: `Remove your ${name} ${WORDS.API_KEY}?`,
    body:
      provider === PROVIDER_KEY_PROVIDER.OPENAI
        ? `Agents on ${name} models won't start without a ${harness.planName}. Calls and dictation will be off.`
        : `Agents on ${name} models won't start without a ${harness.planName}.`,
    verb: WORDS.REMOVE_KEY,
    running: WORDS.REMOVING,
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  };
}

function useApiKey(
  provider: ProviderKeyProvider,
  stored: ProviderKeySummary | undefined,
  field: React.RefObject<HTMLInputElement | null>,
): { secret: PastedSecret; removal: DialogConfirm } {
  const { mutateAsync: sendProviderKeysRemove, ...keyRemoving } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_REMOVE),
  );
  const secret = usePastedSecret({
    held: stored !== undefined,
    field,
    payload: (key) => ({ provider, key }),
    failed: WORDS.SAVE_KEY_FAILED,
    refused: (rejection) => keyRejectionWords(provider, rejection),
  });
  const remove = useCallback(
    (): Promise<ActionResult> =>
      sendProviderKeysRemove({ provider })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.REMOVE_KEY_FAILED };
          }
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [sendProviderKeysRemove, provider],
  );
  const removalAct = useConfirmAct(keyRemoving, {
    send: remove,
    answered: (answer): ActionResult => ("failure" in answer ? KEY_REMOVE_REFUSED : ACCEPTED_KEY),
    failed: () => KEY_REMOVE_REFUSED,
  });
  const removal = useConfirmDialog(
    { subject: stored !== undefined, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
  return { secret, removal };
}

function KeyState({
  provider,
  stored,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary;
}): React.JSX.Element {
  const fault = keyStatusWords(provider, stored.status);
  return fault === undefined ? (
    <State ok>{stored.hint === "" ? WORDS.SAVED : `${WORDS.SAVED} ${stored.hint}`}</State>
  ) : (
    <State ok={false}>{fault}</State>
  );
}

function KeyPresses({
  keyName,
  secret,
  removal,
}: {
  keyName: string;
  secret: PastedSecret;
  removal: DialogConfirm;
}): React.JSX.Element {
  return (
    <Inline wrap={false}>
      <TextButton aria-label={`Replace ${keyName}`} onClick={secret.edit}>
        {WORDS.REPLACE}
      </TextButton>
      <TextButton aria-label={`Remove ${keyName}`} onClick={removal.ask}>
        {WORDS.REMOVE}
      </TextButton>
    </Inline>
  );
}

function ApiKeyRow({
  provider,
  stored,
  field,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary | undefined;
  field: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { secret, removal } = useApiKey(provider, stored, field);
  const keyName = `${HARNESS[provider].keyName} ${WORDS.API_KEY}`;
  return (
    <>
      <SettingsRow
        label={keyName}
        indent={SETTINGS_ROW_INDENT.MARK}
        description={
          stored === undefined ? undefined : <KeyState provider={provider} stored={stored} />
        }
        below={
          secret.open
            ? () => (
                <PasteSteps
                  field={field}
                  secret={secret}
                  first={keyFirst(provider)}
                  label={WORDS.PASTE_KEY}
                  held={stored !== undefined}
                  placeholder={HARNESS[provider].keyShape}
                  running={WORDS.CHECKING_KEY}
                />
              )
            : undefined
        }
      >
        {() =>
          stored === undefined ? null : secret.editing ? (
            <TextButton onClick={secret.cancel}>{WORDS.CANCEL}</TextButton>
          ) : (
            <KeyPresses keyName={keyName} secret={secret} removal={removal} />
          )
        }
      </SettingsRow>
      <CredentialQuestion inDialog confirm={removal} question={keyRemoval(provider)} />
    </>
  );
}

function ApiKeyInPlace({
  provider,
  stored,
  field,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary | undefined;
  field: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { secret, removal } = useApiKey(provider, stored, field);
  const keyName = `${HARNESS[provider].keyName} ${WORDS.API_KEY}`;
  return (
    <>
      {stored === undefined || secret.open ? (
        <PasteSteps
          field={field}
          secret={secret}
          first={keyFirst(provider)}
          label={WORDS.PASTE_KEY}
          held={stored !== undefined}
          placeholder={HARNESS[provider].keyShape}
          running={WORDS.CHECKING_KEY}
        />
      ) : (
        <HeldLine presses={<KeyPresses keyName={keyName} secret={secret} removal={removal} />}>
          <KeyState provider={provider} stored={stored} />
        </HeldLine>
      )}
      <CredentialQuestion inDialog={false} confirm={removal} question={keyRemoval(provider)} />
    </>
  );
}

function DefaultRow({
  provider,
  chosen,
}: {
  provider: ProviderKeyProvider;
  chosen: Credential;
}): React.JSX.Element {
  const { mutateAsync: sendProviderKeysForAgents } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_FOR_AGENTS),
  );
  const harness = HARNESS[provider];
  const label = `New ${harness.name} agents use`;
  const [turning, setTurning] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);

  const choose = (next: Credential) => {
    if (next === chosen || turning) return;
    setTurning(true);
    setRefused(undefined);
    void sendProviderKeysForAgents({
      provider,
      kind: harness.plan,
      forAgents: next === CREDENTIAL.SUBSCRIPTION,
    })
      .catch(() => undefined)
      .then((turned) => {
        setTurning(false);
        if (turned === undefined || "failure" in turned) {
          setRefused(WORDS.DEFAULT_FAILED);
          return;
        }
      });
  };

  return (
    <SettingsRow
      label={label}
      description={refused === undefined ? undefined : <State ok={false}>{refused}</State>}
    >
      {() => (
        <ChoiceBar
          label={label}
          items={[
            { value: CREDENTIAL.SUBSCRIPTION, label: harness.planName },
            { value: CREDENTIAL.API_KEY, label: WORDS.API_KEY },
          ]}
          value={chosen}
          look={CHOICE_BAR_LOOK.SEGMENTED}
          size={CHOICE_BAR_SIZE.COMPACT}
          disabled={turning}
          onChange={choose}
        />
      )}
    </SettingsRow>
  );
}

interface CredentialFields {
  readonly token: React.RefObject<HTMLInputElement | null>;
  readonly key: React.RefObject<HTMLInputElement | null>;
  readonly signIn: React.RefObject<HTMLButtonElement | null>;
}

function AgentCredentialRows({
  provider,
  answer,
  fields,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  fields: CredentialFields;
}): React.JSX.Element {
  const plan = planOf(answer, provider);
  const key = keyOf(answer, provider);
  const chosen = defaultOf(plan, key);
  return (
    <div className={NO_CAPTURE}>
      <Stack gap={GAP.SECTION}>
        {plan === undefined || key === undefined || chosen === undefined ? null : (
          <SettingsSection>
            <DefaultRow provider={provider} chosen={chosen} />
          </SettingsSection>
        )}
        <SettingsSection>
          {provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? (
            <ClaudePlanRow plan={plan} field={fields.token} />
          ) : (
            <ChatGptPlanRow plan={plan} connectButton={fields.signIn} />
          )}
          <ApiKeyRow provider={provider} stored={key} field={fields.key} />
        </SettingsSection>
      </Stack>
    </div>
  );
}

function AgentAuthDialog({
  open,
  provider,
  answer,
  onClose,
  onExited,
}: {
  open: boolean;
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const token = useRef<HTMLInputElement | null>(null);
  const key = useRef<HTMLInputElement | null>(null);
  const signIn = useRef<HTMLButtonElement | null>(null);
  const fields = useMemo(() => ({ token, key, signIn }), []);
  const signInFirst =
    connectionOf(provider, planOf(answer, provider), keyOf(answer, provider)).act ===
    ROW_ACT.SIGN_IN_AGAIN;
  const firstField = useMemo(
    () => ({
      get current() {
        return (signInFirst ? signIn.current : null) ?? token.current ?? key.current;
      },
    }),
    [signInFirst],
  );

  return (
    <Dialog
      open={open}
      title={HARNESS[provider].name}
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      initialFocus={firstField}
      onDismiss={onClose}
      onExited={onExited}
      actions={<DialogActions onDone={onClose} />}
    >
      <AgentCredentialRows provider={provider} answer={answer} fields={fields} />
    </Dialog>
  );
}

interface Credentials {
  readonly answer: ProviderKeysAnswer | undefined;
  readonly readFailed: boolean;
  readonly retry: () => void;
}

function useCredentials({
  signedIn,
  onKeys,
  onConnected,
}: {
  signedIn: boolean;
  onKeys?: ((keys: readonly ProviderKeySummary[]) => void) | undefined;
  onConnected?: ((connected: boolean) => void) | undefined;
}): Credentials {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const keys = useQuery(providerKeysQuery(signedIn ? accountId : undefined));
  const retryKeys = useMutation(providerKeysRetryMutation());
  const answer = keys.data;
  const readFailed = keys.isError;

  useEffect(() => {
    if (onKeys !== undefined && (answer !== undefined || readFailed)) onKeys(answer?.keys ?? []);
  }, [answer, readFailed, onKeys]);

  useEffect(() => {
    if (answer === undefined || onConnected === undefined) return;
    onConnected(
      HARNESSES.some(
        (provider) =>
          connectionOf(provider, planOf(answer, provider), keyOf(answer, provider)).state ===
          SETTINGS_ROW_STATE.CONNECTED,
      ),
    );
  }, [answer, onConnected]);

  return { answer, readFailed, retry: () => retryKeys.mutate() };
}

function HarnessList({
  signedIn,
  credentials,
  children,
}: {
  signedIn: boolean;
  credentials: Credentials;
  children: (answer: ProviderKeysAnswer) => React.ReactNode;
}): React.JSX.Element {
  const { answer, readFailed, retry } = credentials;
  return (
    <SettingsSection>
      {!signedIn ? (
        <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
      ) : answer !== undefined ? (
        children(answer)
      ) : readFailed ? (
        <SettingsLine>
          <ErrorState failure={unreadShown(FAILURE_SURFACE.AGENT_KEYS_READ)} onRetry={retry}>
            {WORDS.READ_FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton
          label={readingWords("your keys")}
          rows={HARNESSES.map(() => KEY_ROW_SKELETON)}
        />
      )}
    </SettingsSection>
  );
}

function HarnessRow({
  provider,
  description,
  below,
  children,
}: {
  provider: ProviderKeyProvider;
  description: React.ReactNode;
  below?: ((control: SettingsRowControl) => React.ReactNode) | undefined;
  children: (control: SettingsRowControl) => React.ReactNode;
}): React.JSX.Element {
  return (
    <div {...searchAnchorProps(HARNESS[provider].anchor)}>
      <SettingsRow
        leading={
          <SettingsRowMark>
            <HarnessMark provider={provider} />
          </SettingsRowMark>
        }
        label={HARNESS[provider].name}
        description={description}
        below={below}
      >
        {children}
      </SettingsRow>
    </div>
  );
}

function RowPress({
  provider,
  connection,
  control,
  popup,
  press,
  onOpen,
}: {
  provider: ProviderKeyProvider;
  connection: Connection;
  control: SettingsRowControl;
  popup: boolean;
  press?: React.RefObject<HTMLButtonElement | null> | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const words = rowActWords(connection.act, HARNESS[provider].name);
  return connection.act === ROW_ACT.MANAGE_USAGE ? (
    <ButtonLink
      href={CHATGPT_USAGE_URL}
      variant={BUTTON_VARIANT.OUTLINE}
      label={words.label}
      aria-describedby={control["aria-describedby"]}
      onClick={linkPressOf(openLink, CHATGPT_USAGE_URL)}
    >
      {words.words}
    </ButtonLink>
  ) : (
    <Button
      ref={press}
      variant={BUTTON_VARIANT.OUTLINE}
      label={words.label}
      aria-haspopup={popup ? "dialog" : undefined}
      aria-describedby={control["aria-describedby"]}
      onClick={onOpen}
    >
      {words.words}
    </Button>
  );
}

function ConnectionLine({ connection }: { connection: Connection }): React.JSX.Element {
  return <SettingsRowStateLine state={connection.state}>{connection.words}</SettingsRowStateLine>;
}

export function AgentAuthSection({
  signedIn,
  onKeys,
}: {
  signedIn: boolean;
  onKeys: (keys: readonly ProviderKeySummary[]) => void;
}): React.JSX.Element {
  const credentials = useCredentials({ signedIn, onKeys });
  const { answer } = credentials;
  const [open, setOpen] = useState<ProviderKeyProvider | undefined>(undefined);
  const { held: drawn, onExited } = useHeldThroughExit(open);

  return (
    <div className={NO_CAPTURE}>
      <HarnessList signedIn={signedIn} credentials={credentials}>
        {(read) =>
          HARNESSES.map((provider) => {
            const connection = connectionOf(
              provider,
              planOf(read, provider),
              keyOf(read, provider),
            );
            return (
              <HarnessRow
                key={provider}
                provider={provider}
                description={<ConnectionLine connection={connection} />}
              >
                {(control) => (
                  <RowPress
                    provider={provider}
                    connection={connection}
                    control={control}
                    popup
                    onOpen={() => setOpen(provider)}
                  />
                )}
              </HarnessRow>
            );
          })
        }
      </HarnessList>
      {drawn === undefined || answer === undefined ? null : (
        <AgentAuthDialog
          open={open !== undefined}
          provider={drawn}
          answer={answer}
          onClose={() => setOpen(undefined)}
          onExited={onExited}
        />
      )}
    </div>
  );
}

function connectedAnew(
  provider: ProviderKeyProvider,
  before: ProviderKeysAnswer,
  after: ProviderKeysAnswer,
): boolean {
  const was = connectionOf(provider, planOf(before, provider), keyOf(before, provider));
  const now = connectionOf(provider, planOf(after, provider), keyOf(after, provider));
  return (
    now.state === SETTINGS_ROW_STATE.CONNECTED &&
    (was.state !== SETTINGS_ROW_STATE.CONNECTED || was.words !== now.words)
  );
}

function ConnectInPlaceRow({
  provider,
  answer,
  open,
  chatGpt,
  onOpen,
  onClose,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  open: boolean;
  chatGpt: ChatGptPlan | undefined;
  onOpen: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const plan = planOf(answer, provider);
  const key = keyOf(answer, provider);
  const connection = connectionOf(provider, plan, key);
  const [shown, setShown] = useState<Credential>(CREDENTIAL.SUBSCRIPTION);
  const token = useRef<HTMLInputElement | null>(null);
  const keyField = useRef<HTMLInputElement | null>(null);
  const signIn = useRef<HTMLButtonElement | null>(null);
  const press = useRef<HTMLButtonElement | null>(null);
  const handBack = useRef(false);

  useEffect(() => {
    if (open) {
      (token.current ?? signIn.current ?? keyField.current)?.focus();
    } else if (handBack.current) {
      handBack.current = false;
      press.current?.focus();
    }
  }, [open]);

  const cancel = () => {
    handBack.current = true;
    onClose();
  };
  const afterward =
    chatGpt !== undefined && (chatGpt.notice || chatGpt.unconfirmed) ? chatGpt : undefined;
  return (
    <HarnessRow
      provider={provider}
      description={
        connection.act === ROW_ACT.CONNECT ? (
          harness.takes
        ) : (
          <ConnectionLine connection={connection} />
        )
      }
      below={
        open
          ? () => (
              <Stack>
                <Inline>
                  <ChoiceBar
                    label={`Connect ${harness.name} with`}
                    items={[
                      { value: CREDENTIAL.SUBSCRIPTION, label: harness.planName },
                      { value: CREDENTIAL.API_KEY, label: WORDS.API_KEY },
                    ]}
                    value={shown}
                    look={CHOICE_BAR_LOOK.SEGMENTED}
                    size={CHOICE_BAR_SIZE.COMPACT}
                    onChange={setShown}
                  />
                </Inline>
                {shown === CREDENTIAL.API_KEY ? (
                  <ApiKeyInPlace provider={provider} stored={key} field={keyField} />
                ) : provider === PROVIDER_KEY_PROVIDER.ANTHROPIC || chatGpt === undefined ? (
                  <ClaudePlanInPlace plan={plan} field={token} />
                ) : (
                  <ChatGptPlanInPlace chatGpt={chatGpt} connectButton={signIn} />
                )}
              </Stack>
            )
          : afterward === undefined
            ? undefined
            : () => <ChatGptAfterward chatGpt={afterward} />
      }
    >
      {(control) =>
        open ? (
          <Button variant={BUTTON_VARIANT.QUIET} onClick={cancel}>
            {WORDS.CANCEL}
          </Button>
        ) : (
          <RowPress
            provider={provider}
            connection={connection}
            control={control}
            popup={false}
            press={press}
            onOpen={() => {
              setShown(defaultOf(plan, key) ?? CREDENTIAL.SUBSCRIPTION);
              onOpen();
            }}
          />
        )
      }
    </HarnessRow>
  );
}

export function AgentConnectSection({
  onConnected,
}: {
  onConnected: (connected: boolean) => void;
}): React.JSX.Element {
  const credentials = useCredentials({ signedIn: true, onConnected });
  const { answer } = credentials;
  const [open, setOpen] = useState<ProviderKeyProvider | undefined>(undefined);
  const before = useRef(answer);
  useEffect(() => {
    const was = before.current;
    before.current = answer;
    if (
      open !== undefined &&
      was !== undefined &&
      answer !== undefined &&
      connectedAnew(open, was, answer)
    ) {
      setOpen(undefined);
    }
  }, [answer, open]);
  const chatGpt = useChatGptPlan(
    answer === undefined ? undefined : planOf(answer, PROVIDER_KEY_PROVIDER.OPENAI),
  );
  return (
    <div className={NO_CAPTURE}>
      <HarnessList signedIn credentials={credentials}>
        {(read) =>
          HARNESSES.map((provider) => (
            <ConnectInPlaceRow
              key={provider}
              provider={provider}
              answer={read}
              open={open === provider}
              chatGpt={provider === PROVIDER_KEY_PROVIDER.OPENAI ? chatGpt : undefined}
              onOpen={() => setOpen(provider)}
              onClose={() => setOpen(undefined)}
            />
          ))
        }
      </HarnessList>
      <ChatGptConnect chatGpt={chatGpt} />
    </div>
  );
}
