import { signedInAccountId } from "@repo/credentials/snapshot";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
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
import { HOST_CAPABILITY } from "@repo/settings";
import { searchAnchorProps } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import {
  ANNOUNCE,
  BANNER_LOOK,
  Banner,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  CONFIRM_LOSS,
  ConfirmDialog,
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
  Stack,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { APP_SLICE, useAppSlice, useCapability } from "../use-app-state.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";

/**
 * agent-auth-section.tsx -- Settings › Agents' harnesses: one row each for Claude and Codex, saying how it is connected, and the dialog that connects it; setup's same rows, connecting in place.
 *
 * The account holds up to two credentials per harness: a plan (Claude's
 * `claude setup-token`, or the ChatGPT sign-in) and the provider's API key.
 * A row's line names the credential that harness's new agents use, then
 * what is wrong with it, or says it is not connected, and its button is
 * the fix: Connect while neither is set, Manage once one is, Sign in again
 * for a ChatGPT plan OpenAI signed out, and Manage usage, which opens
 * ChatGPT's usage settings, for one at its limit. Every other press
 * opens the harness's dialog: a settings row per credential, the plan's led
 * by its mark where it has one and the key's lined up with its words, each
 * with its state under its name, its presses at its end, and its field or
 * notice opening under it. Which one new agents use is a control of its
 * own, in a section above the rows, standing only while both are saved:
 * it writes the plan's `forAgents`, on for the plan and off for the key,
 * and every agent Start makes on that provider's models runs on it; there
 * is no choice at Start. With one saved, that one is used; with neither, no
 * agent starts on that provider's models, since our key pays for no coding
 * agent. Calls and dictation run on the OpenAI API key
 * alone, so every answer here is handed to the window too
 * (`../openai-key.tsx`), and removing that key says they stop.
 *
 * The service never answers a key or a token, so nothing here holds one but
 * what is being pasted: it stands in the open field alone, is sent once on
 * Save, and is cleared as soon as the service keeps it. Every answer is the
 * account's credentials whole, which the page holds once and hands to the
 * Default model row (`onKeys`) so its note follows a save at once. The list
 * and the dialog are kept out of the screen recording, which masks a
 * field's characters but not their count.
 *
 * The ChatGPT sign-in runs through a loopback only the desktop can listen
 * on; elsewhere its row says so and offers nothing until a sign-in made
 * on the desktop is there to disconnect. The first sign-in on this Mac is
 * met with OpenAI's notice that the app uses the ChatGPT plan
 * (developers.openai.com/siwc/ui-ux-guidelines), drawn under the plan row's
 * name, dismissed with Got it and never shown again here, kept in the
 * renderer's own storage.
 *
 * What the dialog asks about a credential it holds, disconnecting a plan or
 * removing a key, it asks at its own foot (`FootQuestion`), never in a
 * second card over itself.
 *
 * Setup's Connect an agent stands the same two rows with no dialog
 * (`AgentConnectSection`): each says what it takes until it is connected,
 * and its button opens the row in place, one at a time, on a choice of the
 * plan or the key over that one credential's control, and the open row's
 * end is Cancel, which closes it. Connecting closes it to its state line,
 * OpenAI's notice standing under it. The credential's logic is the
 * dialog's own (`usePastedSecret`, `useClaudePlan`, `useChatGptPlan`,
 * `useApiKey`); only its drawing differs, and with no dialog to stand at
 * the foot of, a question asks over the window (`ConfirmDialog`).
 */

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** Where this Mac keeps that the ChatGPT notice was seen, in the renderer's own storage. */
const NOTICE_SEEN_KEY = "app.chatGptFirstSignInNoticeSeen";

/** Which of a harness's credentials its new agents use. */
const CREDENTIAL = {
  SUBSCRIPTION: "subscription",
  API_KEY: "api_key",
} as const;

type Credential = (typeof CREDENTIAL)[keyof typeof CREDENTIAL];

/** What a harness's row button does: connect, manage, or the fix its state asks for. */
const ROW_ACT = {
  CONNECT: "connect",
  MANAGE: "manage",
  /** Opens the dialog on Continue with ChatGPT, for a ChatGPT plan OpenAI signed out. */
  SIGN_IN_AGAIN: "sign_in_again",
  /** Opens ChatGPT's usage settings, for a ChatGPT plan at its limit. */
  MANAGE_USAGE: "manage_usage",
} as const;

type RowAct = (typeof ROW_ACT)[keyof typeof ROW_ACT];

/** Where OpenAI's guidelines send Manage usage: ChatGPT's own usage settings. */
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** What a harness's row says under its name, in which tint, and what its button does. */
interface Connection {
  readonly words: string;
  readonly state: SettingsRowState;
  readonly act: RowAct;
}

/** What a harness's row and dialog are drawn from. */
interface Harness {
  readonly name: string;
  /** What its plan is called wherever a surface names the credential: its row's label, a disconnect's title. */
  readonly planName: string;
  readonly plan: SubscriptionKeySummary["kind"];
  readonly keyName: string;
  readonly keyUrl: string;
  readonly anchor: string;
  /** What its setup row says it takes while nothing is connected. */
  readonly takes: string;
}

/**
 * Each harness by the provider whose models it runs: its name, its plan's
 * name and kind, the provider's name on its key, where a key is made, and the row a
 * search or a remedy lands on.
 */
const HARNESS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    name: "Claude",
    planName: "Claude plan",
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    keyName: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    anchor: SETTINGS_SECTION.CLAUDE,
    takes: "Claude plan or Anthropic API key",
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    planName: "ChatGPT plan",
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    keyName: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    anchor: SETTINGS_SECTION.CODEX,
    takes: "ChatGPT plan or OpenAI API key",
  },
} as const satisfies Record<ProviderKeyProvider, Harness>;

/** A harness's row while the keys are read: its mark, its name, its state line, and its button. */
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
  MANAGE: "Manage",
  SIGN_IN_AGAIN: "Sign in again",
  MANAGE_USAGE: "Manage usage",
  NOT_CONNECTED: "Not connected",
  NEEDS_ATTENTION: "Needs attention",
  SIGNED_OUT_OF_PLAN: "Signed out",
  API_KEY: "API key",
  GET_KEY: "Get key",
  DESKTOP_ONLY: "Desktop app only",
  CANCEL: "Cancel",
  SAVE: "Save",
  TOKEN_PLACEHOLDER: 'Paste the token from "claude setup-token"',
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
  NEW_KEY: "New key",
  PLAN_LIMITS: "Counts against your plan's limits",
  FINISH_SIGNING_IN: "Finish signing in in your browser.",
  RUN_SETUP_TOKEN: "Run claude setup-token in a terminal, then paste what it prints.",
  REPLACES_TOKEN: `Saving replaces the token ${PRODUCT_NAME} holds.`,
  REPLACES_KEY: `Saving replaces the key ${PRODUCT_NAME} holds.`,
  SIGN_IN: "Continue with ChatGPT",
  WAITING: "Waiting for ChatGPT",
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  USAGE_LIMIT: "Usage limit reached",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_SIGNED_OUT: "Signed out of ChatGPT.",
  CHATGPT_UNREADABLE: "This sign-in can no longer be read.",
  CHATGPT_SIGNED_OUT_ALONE: "Signed out of ChatGPT. Continue with ChatGPT to sign in again.",
  CHATGPT_UNREADABLE_ALONE:
    "This sign-in can no longer be read. Continue with ChatGPT to connect again.",
  CHATGPT_INELIGIBLE:
    "OpenAI says this ChatGPT plan isn't eligible for Codex. Continue with ChatGPT to use another.",
  REVOCATION_UNCONFIRMED: `${PRODUCT_NAME} signed out of ChatGPT, but OpenAI didn't confirm it ended. To end it there too, remove ${PRODUCT_NAME} in your ChatGPT settings.`,
  NOTICE_TITLE: "You're using your ChatGPT plan",
  NOTICE_BODY: `Eligible usage in ${PRODUCT_NAME} uses your ChatGPT plan. Manage usage in your ChatGPT settings.`,
  GOT_IT: "Got it",
  SAVE_TOKEN_FAILED: "Couldn't save the token. Try again.",
  SAVE_KEY_FAILED: "Couldn't save the key. Try again.",
  REMOVE_KEY_FAILED: "Couldn't remove the key. Try again.",
  CLAUDE_DISCONNECT_FAILED: "Couldn't disconnect your Claude plan. Try again.",
  CHATGPT_DISCONNECT_FAILED: "Couldn't disconnect your ChatGPT plan. Try again.",
  SIGN_IN_FAILED: "Couldn't reach ChatGPT. Try again.",
  DEFAULT_FAILED: "Couldn't change the default. Try again.",
} as const;

/* ----- Reading the credentials ----- */

/** The harness's plan among the account's subscriptions, or none. */
function planOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): SubscriptionKeySummary | undefined {
  return answer.subscriptions?.find((one) => one.kind === HARNESS[provider].plan);
}

/** The provider's API key among the account's keys, or none. */
function keyOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): ProviderKeySummary | undefined {
  return answer.keys.find((one) => one.provider === provider);
}

/** Whether a stored plan still stands: kept, answered, or only waiting on its limit to reset. */
function standing(plan: SubscriptionKeySummary): boolean {
  return (
    plan.status === PROVIDER_KEY_STATUS.UNVERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.VERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
  );
}

/** Whether a stored key is one its provider has not refused. */
function keyStanding(status: ProviderKeyStatus): boolean {
  return status === PROVIDER_KEY_STATUS.VERIFIED || status === PROVIDER_KEY_STATUS.UNVERIFIED;
}

/** The credential the harness's new agents use: the plan where it is on for them, else the key, else neither (ours). */
function defaultOf(
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
): Credential | undefined {
  if (plan !== undefined && plan.forAgents !== false) return CREDENTIAL.SUBSCRIPTION;
  if (key !== undefined) return CREDENTIAL.API_KEY;
  return undefined;
}

/**
 * What a harness's row says under its name: the credential its new agents
 * use, by name, then what is wrong with it, and its button the fix. A key
 * is named with its hint, a plan at its limit with its reset where the
 * provider named one. A ChatGPT plan OpenAI signed out offers Sign in again
 * where this client can take the sign-in (`signInOffered`), and one at its
 * limit Manage usage, as OpenAI's guidelines ask; a Claude plan at its limit
 * keeps Manage, and every other lapse says it needs attention, its dialog
 * saying why.
 */
function connectionOf(
  provider: ProviderKeyProvider,
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
  signInOffered: boolean,
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
      act: signInOffered ? ROW_ACT.SIGN_IN_AGAIN : ROW_ACT.MANAGE,
    };
  }
  return {
    words: `${harness.planName} · ${WORDS.NEEDS_ATTENTION}`,
    state: SETTINGS_ROW_STATE.ATTENTION,
    act: ROW_ACT.MANAGE,
  };
}

/** A row's button's words and its accessible name, which says which harness it acts on. */
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

/** A reached limit's words, with its reset where the provider named one. */
function limitWords(plan: SubscriptionKeySummary): string {
  return plan.limitResetsAt === undefined
    ? WORDS.USAGE_LIMIT
    : `${WORDS.USAGE_LIMIT} · Resets ${dayAndTimeText(plan.limitResetsAt)}`;
}

/** What a Claude token's status says. */
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

/** What a ChatGPT sign-in's status says, naming Continue with ChatGPT only where its button does not stand beside it (`offered`). */
function signInWords(plan: SubscriptionKeySummary, offered: boolean): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNVERIFIED:
    case PROVIDER_KEY_STATUS.VERIFIED:
      return WORDS.CONNECTED;
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return limitWords(plan);
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return offered ? WORDS.CHATGPT_UNREADABLE : WORDS.CHATGPT_UNREADABLE_ALONE;
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return WORDS.CHATGPT_INELIGIBLE;
    default:
      return offered ? WORDS.CHATGPT_SIGNED_OUT : WORDS.CHATGPT_SIGNED_OUT_ALONE;
  }
}

/** What an API key's status says, by the provider it names; nothing while it stands, which its ✓ says. */
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
    // Note that a plan's limit and eligibility are a subscription's words, which no API key is answered with.
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return `Out of credit at ${name}.`;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return "This key can no longer be read.";
  }
}

/** Why an API key's save kept nothing, in words the developer can act on. */
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
    case PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN:
      return `${name} couldn't confirm this sign-in. Continue with ChatGPT to try again.`;
  }
}

/** Why a Claude token's save kept nothing. */
function tokenRejectionWords(rejection: ProviderKeyRejection): string {
  return rejection === PROVIDER_KEY_REJECTION.TOO_MANY_TRIES
    ? "Too many tries in the last hour. Try again later."
    : "That isn't a Claude setup-token. Run claude setup-token and paste what it prints.";
}

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

/* ----- Small parts ----- */

/** A status in the connected or the attention tint, announced where it needs a hand; `block` stands it on a line of its own. */
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

/**
 * A question about a credential the surface holds: at the dialog's foot
 * where a dialog holds it, which `FootQuestion` must stand in, and over the
 * window where none does.
 */
function CredentialQuestion({
  inDialog,
  confirm,
  question,
}: {
  inDialog: boolean;
  confirm: DialogConfirm;
  question: DialogQuestion;
}): React.JSX.Element {
  return inDialog ? (
    <FootQuestion confirm={confirm} question={question} />
  ) : (
    <ConfirmDialog open confirm={confirm} question={question} />
  );
}

/** Where a provider's keys are made, opened through the window's own link door. */
function GetKeyLink({ url }: { url: string }): React.JSX.Element {
  const openLink = useOpenLink();
  return (
    <TextLink
      look={TEXT_LINK_LOOK.UNDERLINED}
      href={url}
      external
      onClick={(event) => {
        event.preventDefault();
        openLink(url);
      }}
    >
      {WORDS.GET_KEY}
    </TextLink>
  );
}

/** What an unheld API key costs, and where one is made. */
function KeyCost({ provider }: { provider: ProviderKeyProvider }): React.JSX.Element {
  const harness = HARNESS[provider];
  return (
    <>
      {`Billed by ${harness.keyName} per token. `}
      <GetKeyLink url={harness.keyUrl} />
    </>
  );
}

/* ----- A pasted secret ----- */

/** A pasted secret's form as its owner holds it: whether it stands, the words in it, the save under way, and why the last one kept nothing. */
interface PastedSecret {
  /** Whether the field stands: nothing is held yet, or Replace was pressed. */
  readonly open: boolean;
  readonly editing: boolean;
  readonly pasted: string;
  readonly saving: boolean;
  readonly rejection: string | undefined;
  readonly edit: () => void;
  /** Closes a Replace, dropping what was pasted and why it was refused. */
  readonly cancel: () => void;
  readonly change: (value: string) => void;
  readonly save: () => void;
}

/**
 * A pasted secret's save, a Claude token's and an API key's alike: the
 * field stands until one is held, or on Replace with the focus in it; Save
 * sends the paste once, trimmed, and clears it as soon as the service keeps
 * it, and a refusal stands under the field saying why, the paste kept.
 */
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
  /** What a save the service never answered says. */
  failed: string;
  refused: (rejection: ProviderKeyRejection) => string;
}): PastedSecret {
  const { act } = useAct();
  const [editing, setEditing] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  // Replace opens the field with the focus in it, ready for the paste.
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const cancel = useCallback(() => {
    setPasted("");
    setRejection(undefined);
    setEditing(false);
  }, []);
  const save = () => {
    const key = pasted.trim();
    if (key === "" || saving) return;
    setSaving(true);
    setRejection(undefined);
    void act(ACT_KIND.PROVIDER_KEYS_SAVE, payload(key))
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
        // Kept: the secret leaves the field, and the row draws the service's word for it.
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
    save,
  };
}

/**
 * A pasted secret's form: the field, then Save, the form's submit, so Enter
 * in the field presses it. Note that going back to a held secret is Escape
 * or the row's Cancel at its end, never a second button here.
 */
function SecretForm({
  field,
  secret,
  label,
  description,
  held,
  placeholder,
  running,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  secret: PastedSecret;
  label: string;
  description: React.ReactNode;
  /** Whether a secret is already held, which the empty field says in its place and Escape goes back to. */
  held: boolean;
  placeholder: string;
  running: string;
}): React.JSX.Element {
  return (
    <Stack
      as={LAYOUT_ELEMENT.FORM}
      onSubmit={(event) => {
        event.preventDefault();
        secret.save();
      }}
    >
      <SecretField
        ref={field}
        label={label}
        description={description}
        error={refusedShown(secret.rejection, FAILURE_SURFACE.AGENT_KEY_SAVE)}
        saved={held}
        placeholder={placeholder}
        disabled={secret.saving}
        value={secret.pasted}
        onEscape={held ? secret.cancel : undefined}
        onChange={secret.change}
      />
      <Inline justify={JUSTIFY.END}>
        <Button
          type={BUTTON_TYPE.SUBMIT}
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={secret.pasted.trim() === ""}
          busy={secret.saving}
          busyLabel={running}
        >
          {WORDS.SAVE}
        </Button>
      </Inline>
    </Stack>
  );
}

/** A held credential in place: what its provider says of it, and its presses beside it. */
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

/* ----- The plan's row ----- */

const CLAUDE_DISCONNECT: DialogQuestion = {
  title: "Disconnect your Claude plan?",
  body: `Claude agents stop running on your Claude plan, and ${PRODUCT_NAME} deletes its token.`,
  verb: WORDS.DISCONNECT,
  running: WORDS.DISCONNECTING,
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

const CHATGPT_DISCONNECT: DialogQuestion = {
  title: "Disconnect your ChatGPT plan?",
  body: `Codex agents stop running on your ChatGPT plan, and ${PRODUCT_NAME} signs out of ChatGPT.`,
  verb: WORDS.DISCONNECT,
  running: WORDS.DISCONNECTING,
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

/** Claude's plan as either surface holds it: its setup-token's form, and Disconnect's question. */
function useClaudePlan(
  plan: SubscriptionKeySummary | undefined,
  field: React.RefObject<HTMLInputElement | null>,
): { secret: PastedSecret; removal: DialogConfirm } {
  const { act } = useAct();
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
      act(ACT_KIND.PROVIDER_KEYS_REMOVE, {
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
    [act, cancel],
  );
  const removal = useConfirmDialog(
    { subject: plan !== undefined, surfaceOpen: true },
    disconnect,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
  return { secret, removal };
}

/** Claude's plan: a pasted setup-token opening under the row until one is held, then its status, Replace token, and Disconnect. */
function ClaudePlanRow({
  plan,
  field,
}: {
  plan: SubscriptionKeySummary | undefined;
  /** The dialog's way to the field while it stands. */
  field: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  const { secret, removal } = useClaudePlan(plan, field);
  const ok = plan !== undefined && standing(plan);
  return (
    <>
      <SettingsRow
        label={HARNESS[PROVIDER_KEY_PROVIDER.ANTHROPIC].planName}
        indent={SETTINGS_ROW_INDENT.MARK}
        description={
          plan === undefined ? (
            WORDS.PLAN_LIMITS
          ) : (
            <State ok={ok && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
              {tokenWords(plan)}
            </State>
          )
        }
        below={
          secret.open
            ? () => (
                <SecretForm
                  field={field}
                  secret={secret}
                  label="Claude setup-token"
                  description={plan === undefined ? undefined : WORDS.REPLACES_TOKEN}
                  held={plan !== undefined}
                  placeholder={WORDS.TOKEN_PLACEHOLDER}
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

/** Claude's plan in place: the setup-token's field and how to get one until one is held, then its status, Replace token, and Disconnect. */
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
        <SecretForm
          field={field}
          secret={secret}
          label="Claude setup-token"
          description={plan === undefined ? WORDS.RUN_SETUP_TOKEN : WORDS.REPLACES_TOKEN}
          held={plan !== undefined}
          placeholder={WORDS.TOKEN_PLACEHOLDER}
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

/**
 * OpenAI's first-sign-in notice, under the ChatGPT plan's row: what using
 * the plan means, and Got it, which takes focus as the notice lands, as the
 * sign-in's own button has just gone.
 */
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

/** The ChatGPT plan as either surface holds it: its sign-in, OpenAI's notice and an unconfirmed sign-out after it, and Disconnect's question. */
interface ChatGptPlan {
  readonly plan: SubscriptionKeySummary | undefined;
  /** Whether the plan stands, kept, answered, or waiting on its limit. */
  readonly connected: boolean;
  readonly signingIn: boolean;
  readonly error: string | undefined;
  readonly unconfirmed: boolean;
  readonly notice: boolean;
  readonly signIn: () => void;
  /** Ends a sign-in waiting on the browser. */
  readonly cancel: () => void;
  readonly dismissNotice: () => void;
  readonly removal: DialogConfirm;
}

/**
 * The ChatGPT plan's sign-in and disconnect. The first sign-in on this Mac
 * raises OpenAI's notice, once; a disconnect OpenAI did not confirm says so.
 */
function useChatGptPlan(plan: SubscriptionKeySummary | undefined): ChatGptPlan {
  const { act } = useAct();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState(false);

  const signIn = useCallback(() => {
    setSigningIn(true);
    setError(undefined);
    setUnconfirmed(false);
    void act(ACT_KIND.CHATGPT_SIGN_IN)
      .catch(() => ({ failure: AGENT_CALL_FAILURE.UNANSWERED }) as const)
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
            return {
              status: ACTION_RESULT_STATUS.REJECTED,
              reason: WORDS.CHATGPT_DISCONNECT_FAILED,
            };
          }
          setUnconfirmed(removed.revocationUnconfirmed === true);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act],
  );
  const removal = useConfirmDialog(
    { subject: plan !== undefined, surfaceOpen: true },
    disconnect,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
  const dismissNotice = useCallback(() => {
    markNoticeSeen();
    setNotice(false);
  }, []);
  return {
    plan,
    connected: plan !== undefined && standing(plan),
    signingIn,
    error,
    unconfirmed,
    notice,
    signIn,
    cancel,
    dismissNotice,
    removal,
  };
}

/** What a ChatGPT plan's status says, in the tint of how it stands, once one is stored. */
function ChatGptState({
  plan,
  connected,
  offered,
}: {
  plan: SubscriptionKeySummary;
  connected: boolean;
  offered: boolean;
}): React.JSX.Element {
  return (
    <State ok={connected && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
      {signInWords(plan, offered)}
    </State>
  );
}

/** What stands under the ChatGPT plan once its sign-in is done: that a sign-out went unconfirmed, and OpenAI's notice. */
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

/** Continue with ChatGPT, busy while the sign-in waits on the browser. */
function SignInButton({
  chatGpt,
  signInButton,
}: {
  chatGpt: ChatGptPlan;
  signInButton: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  return (
    <Button
      ref={signInButton}
      variant={BUTTON_VARIANT.OUTLINE}
      icon={<ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ICON} />}
      busy={chatGpt.signingIn}
      busyLabel={WORDS.WAITING}
      onClick={chatGpt.signIn}
    >
      {WORDS.SIGN_IN}
    </Button>
  );
}

/**
 * The ChatGPT plan: Continue with ChatGPT where the loopback can be listened
 * on, else that it is the desktop's alone, its status once held, and
 * Disconnect; OpenAI's notice and an unconfirmed sign-out open under it.
 */
function ChatGptPlanRow({
  plan,
  offered,
  signInButton,
}: {
  plan: SubscriptionKeySummary | undefined;
  /** Whether this client can take the sign-in's loopback (the desktop). */
  offered: boolean;
  /** The dialog's way to Continue with ChatGPT while it stands. */
  signInButton: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const chatGpt = useChatGptPlan(plan);
  const { connected, signingIn, error } = chatGpt;
  const continueOffered = offered && !connected;
  const status =
    plan !== undefined ? (
      <ChatGptState plan={plan} connected={connected} offered={offered} />
    ) : !offered ? (
      WORDS.DESKTOP_ONLY
    ) : signingIn ? (
      WORDS.FINISH_SIGNING_IN
    ) : (
      WORDS.PLAN_LIMITS
    );
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
          error === undefined ? (
            status
          ) : (
            <>
              {status}
              <State ok={false} block>
                {error}
              </State>
            </>
          )
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
          ) : continueOffered ? (
            <Inline wrap={false}>
              {signingIn ? (
                <Button variant={BUTTON_VARIANT.QUIET} onClick={chatGpt.cancel}>
                  {WORDS.CANCEL}
                </Button>
              ) : null}
              <SignInButton chatGpt={chatGpt} signInButton={signInButton} />
            </Inline>
          ) : null
        }
      </SettingsRow>
      <CredentialQuestion inDialog confirm={chatGpt.removal} question={CHATGPT_DISCONNECT} />
    </>
  );
}

/**
 * The ChatGPT plan in place, its sign-in held by the harness's row so
 * OpenAI's notice outlives the row closing: Continue with ChatGPT, and while
 * it waits, where to finish; that it is the desktop's alone where the
 * loopback cannot be listened on; once held, its status and Disconnect.
 */
function ChatGptPlanInPlace({
  chatGpt,
  offered,
  signInButton,
}: {
  chatGpt: ChatGptPlan;
  offered: boolean;
  signInButton: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const { plan, connected, signingIn, error } = chatGpt;
  return (
    <Stack gap={GAP.TIGHT}>
      {plan === undefined ? null : connected ? (
        <HeldLine
          presses={<TextButton onClick={chatGpt.removal.ask}>{WORDS.DISCONNECT}</TextButton>}
        >
          <ChatGptState plan={plan} connected={connected} offered={offered} />
        </HeldLine>
      ) : (
        <ChatGptState plan={plan} connected={connected} offered={offered} />
      )}
      {connected ? null : offered ? (
        <Inline>
          <SignInButton chatGpt={chatGpt} signInButton={signInButton} />
        </Inline>
      ) : plan === undefined ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.DESKTOP_ONLY}
        </Text>
      ) : null}
      {signingIn ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.FINISH_SIGNING_IN}
        </Text>
      ) : null}
      {error === undefined ? null : <State ok={false}>{error}</State>}
      {chatGpt.unconfirmed ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.REVOCATION_UNCONFIRMED}
        </Text>
      ) : null}
    </Stack>
  );
}

/* ----- The key's row ----- */

/** What removing a provider's key asks. */
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

/** The provider's API key as either surface holds it: its form, and Remove's question. */
function useApiKey(
  provider: ProviderKeyProvider,
  stored: ProviderKeySummary | undefined,
  field: React.RefObject<HTMLInputElement | null>,
): { secret: PastedSecret; removal: DialogConfirm } {
  const { act } = useAct();
  const secret = usePastedSecret({
    held: stored !== undefined,
    field,
    payload: (key) => ({ provider, key }),
    failed: WORDS.SAVE_KEY_FAILED,
    refused: (rejection) => keyRejectionWords(provider, rejection),
  });
  const remove = useCallback(
    (): Promise<ActionResult> =>
      act(ACT_KIND.PROVIDER_KEYS_REMOVE, { provider })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.REMOVE_KEY_FAILED };
          }
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act, provider],
  );
  const removal = useConfirmDialog(
    { subject: stored !== undefined, surfaceOpen: true },
    remove,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
  return { secret, removal };
}

/** A held key's state: Saved and its hint while it stands, else what its provider said of it. */
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

/** A held key's Replace and Remove, each naming the key it acts on. */
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

/**
 * The provider's API key, its words lined up with the plan's: what it costs
 * and Get key, with the field opening under them, until one is held; then
 * Saved and its hint, with Replace, which opens a New key field and turns
 * the row's end into Cancel, and Remove.
 */
function ApiKeyRow({
  provider,
  stored,
  field,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary | undefined;
  /** The dialog's way to the field while it stands. */
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
          stored === undefined ? (
            <KeyCost provider={provider} />
          ) : (
            <KeyState provider={provider} stored={stored} />
          )
        }
        below={
          secret.open
            ? () => (
                <SecretForm
                  field={field}
                  secret={secret}
                  label={stored === undefined ? WORDS.API_KEY : WORDS.NEW_KEY}
                  description={stored === undefined ? undefined : WORDS.REPLACES_KEY}
                  held={stored !== undefined}
                  placeholder={`Paste your ${keyName}`}
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

/** The provider's API key in place: its field with what it costs and Get key until one is held, then Saved and its hint, Replace, and Remove. */
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
        <SecretForm
          field={field}
          secret={secret}
          label={stored === undefined ? keyName : WORDS.NEW_KEY}
          description={stored === undefined ? <KeyCost provider={provider} /> : WORDS.REPLACES_KEY}
          held={stored !== undefined}
          placeholder={`Paste your ${keyName}`}
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

/* ----- The default ----- */

/**
 * Which credential the harness's new agents use, while both are saved: the
 * plan or the key, written as the plan's `forAgents`, every agent Start makes
 * on that provider's models running on it; there is no choice at Start.
 */
function DefaultRow({
  provider,
  chosen,
}: {
  provider: ProviderKeyProvider;
  chosen: Credential;
}): React.JSX.Element {
  const { act } = useAct();
  const harness = HARNESS[provider];
  const label = `New ${harness.name} agents use`;
  const [turning, setTurning] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);

  const choose = (next: Credential) => {
    if (next === chosen || turning) return;
    setTurning(true);
    setRefused(undefined);
    void act(ACT_KIND.PROVIDER_KEYS_FOR_AGENTS, {
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

/* ----- The dialog ----- */

/** Where the dialog finds each control it may open on. */
interface CredentialFields {
  readonly token: React.RefObject<HTMLInputElement | null>;
  readonly key: React.RefObject<HTMLInputElement | null>;
  readonly signIn: React.RefObject<HTMLButtonElement | null>;
}

/**
 * A harness's credentials as settings rows, kept apart from the dialog so a
 * surface without one can stand them too: the default's own section while
 * both are saved, over the plan's row and the key's.
 */
function AgentCredentialRows({
  provider,
  answer,
  fields,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  fields: CredentialFields;
}): React.JSX.Element {
  const chatGptOffered = useCapability(HOST_CAPABILITY.CHATGPT_SIGN_IN);
  const plan = planOf(answer, provider);
  const key = keyOf(answer, provider);
  const chosen = defaultOf(plan, key);
  return (
    <div className={NO_CAPTURE}>
      <Stack gap={GAP.SECTION}>
        {/* With one credential saved, that one is used, so there is nothing to choose. */}
        {plan === undefined || key === undefined || chosen === undefined ? null : (
          <SettingsSection>
            <DefaultRow provider={provider} chosen={chosen} />
          </SettingsSection>
        )}
        <SettingsSection>
          {provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? (
            <ClaudePlanRow plan={plan} field={fields.token} />
          ) : (
            <ChatGptPlanRow plan={plan} offered={chatGptOffered} signInButton={fields.signIn} />
          )}
          <ApiKeyRow provider={provider} stored={key} field={fields.key} />
        </SettingsSection>
      </Stack>
    </div>
  );
}

/** A harness's dialog: its credentials' rows under the harness's name, and Done. */
function AgentAuthDialog({
  open,
  provider,
  answer,
  onClose,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  onClose: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const chatGptOffered = useCapability(HOST_CAPABILITY.CHATGPT_SIGN_IN);
  const token = useRef<HTMLInputElement | null>(null);
  const key = useRef<HTMLInputElement | null>(null);
  const signIn = useRef<HTMLButtonElement | null>(null);
  const fields = useMemo(() => ({ token, key, signIn }), []);
  // Note that a ChatGPT plan OpenAI signed out opens on Continue with ChatGPT, the fix its row's Sign in again named.
  const signInFirst =
    connectionOf(provider, planOf(answer, provider), keyOf(answer, provider), chatGptOffered)
      .act === ROW_ACT.SIGN_IN_AGAIN;
  // Note that the dialog otherwise opens on the first field it draws, the setup-token's above the API key's, and none where both are kept.
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
      initialFocus={firstField}
      onDismiss={onClose}
      onExited={onExited}
      actions={<DialogActions onDone={onClose} />}
    >
      <AgentCredentialRows provider={provider} answer={answer} fields={fields} />
    </Dialog>
  );
}

/* ----- The list ----- */

/** The account's credentials as a list holds them: the answer once read, whether the read failed, and a way to try again. */
interface Credentials {
  readonly answer: ProviderKeysAnswer | undefined;
  readonly readFailed: boolean;
  readonly retry: () => void;
}

/**
 * The account's credentials as the host holds them (`LIVE_READ.PROVIDER_KEYS`),
 * each write's own answer laid there, which the Default model row
 * (`onKeys`) and setup (`onConnected`) hear.
 */
function useCredentials({
  signedIn,
  onKeys,
  onConnected,
}: {
  signedIn: boolean;
  onKeys?: ((keys: readonly ProviderKeySummary[]) => void) | undefined;
  onConnected?: ((connected: boolean) => void) | undefined;
}): Credentials {
  const chatGptOffered = useCapability(HOST_CAPABILITY.CHATGPT_SIGN_IN);
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const keys = useHostRead(LIVE_READ.PROVIDER_KEYS, signedIn ? accountId : undefined);
  const answer = keys.rows;
  const readFailed = keys.status === HOST_READ_STATUS.FAILED;

  // The Default model row hears every answer, so nothing there says what a key used to be.
  useEffect(() => {
    if (onKeys !== undefined && (answer !== undefined || readFailed)) onKeys(answer?.keys ?? []);
  }, [answer, readFailed, onKeys]);

  // Setup hears whether either harness now pays for an agent.
  useEffect(() => {
    if (answer === undefined || onConnected === undefined) return;
    onConnected(
      HARNESSES.some(
        (provider) =>
          connectionOf(provider, planOf(answer, provider), keyOf(answer, provider), chatGptOffered)
            .state === SETTINGS_ROW_STATE.CONNECTED,
      ),
    );
  }, [answer, onConnected, chatGptOffered]);

  return { answer, readFailed, retry: keys.retry };
}

/** The harnesses' section: signed out, a row each over the answer, a read that failed, or the rows' skeleton while it is out. */
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

/** A harness's row: its mark and name, what it says under them, its press at its end, and what opens under it, where a link to its section lands. */
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

/**
 * A harness row's press, named for its harness, since both rows may say
 * Manage, and described by the row's state: Manage usage's link to ChatGPT's
 * usage settings, else a button opening the harness's credentials, in a
 * dialog (`popup`) or in place.
 */
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

/** What a harness's row says under its name: the credential in use and how it stands. */
function ConnectionLine({ connection }: { connection: Connection }): React.JSX.Element {
  return <SettingsRowStateLine state={connection.state}>{connection.words}</SettingsRowStateLine>;
}

/** The harness rows, each opening its dialog, over the account's credentials read once and changed in place. */
export function AgentAuthSection({
  signedIn,
  onKeys,
}: {
  signedIn: boolean;
  /** The API keys as last read or changed, none where they could not be read; not called while the read is out. */
  onKeys: (keys: readonly ProviderKeySummary[]) => void;
}): React.JSX.Element {
  const chatGptOffered = useCapability(HOST_CAPABILITY.CHATGPT_SIGN_IN);
  const credentials = useCredentials({ signedIn, onKeys });
  const { answer } = credentials;
  const [open, setOpen] = useState<ProviderKeyProvider | undefined>(undefined);
  // Note that the card is drawn for the provider it opened on until its fade has run, so it does not change under its own exit.
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
              chatGptOffered,
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

/* ----- Connecting in place ----- */

/** Whether an answer leaves the harness connected anew: connected where it was not, or by another credential than before. */
function connectedAnew(
  provider: ProviderKeyProvider,
  before: ProviderKeysAnswer,
  after: ProviderKeysAnswer,
  signInOffered: boolean,
): boolean {
  const was = connectionOf(
    provider,
    planOf(before, provider),
    keyOf(before, provider),
    signInOffered,
  );
  const now = connectionOf(
    provider,
    planOf(after, provider),
    keyOf(after, provider),
    signInOffered,
  );
  return (
    now.state === SETTINGS_ROW_STATE.CONNECTED &&
    (was.state !== SETTINGS_ROW_STATE.CONNECTED || was.words !== now.words)
  );
}

/**
 * A harness's row in setup: what it takes until it is connected, then its
 * state line, and its button opening the row in place on a choice of the
 * plan or the key, the one in use where one is, over that credential's
 * control, with Cancel at its end. Opening puts the focus on the control,
 * as the press that opened it gives way to Cancel, and Cancel hands it back.
 */
function ConnectInPlaceRow({
  provider,
  answer,
  open,
  chatGpt,
  signInOffered,
  onOpen,
  onClose,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  open: boolean;
  /** The ChatGPT plan's sign-in, held by the list so OpenAI's notice outlives the row closing; Codex's alone. */
  chatGpt: ChatGptPlan | undefined;
  signInOffered: boolean;
  onOpen: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const plan = planOf(answer, provider);
  const key = keyOf(answer, provider);
  const connection = connectionOf(provider, plan, key, signInOffered);
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
    // Note that a sign-in still waiting on the browser ends with the row, so no answer lands on a row that has closed.
    if (chatGpt?.signingIn === true) chatGpt.cancel();
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
                    disabled={chatGpt?.signingIn === true}
                    onChange={setShown}
                  />
                </Inline>
                {shown === CREDENTIAL.API_KEY ? (
                  <ApiKeyInPlace provider={provider} stored={key} field={keyField} />
                ) : provider === PROVIDER_KEY_PROVIDER.ANTHROPIC || chatGpt === undefined ? (
                  <ClaudePlanInPlace plan={plan} field={token} />
                ) : (
                  <ChatGptPlanInPlace
                    chatGpt={chatGpt}
                    offered={signInOffered}
                    signInButton={signIn}
                  />
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

/**
 * Setup's Connect an agent: the harness rows, each connecting in place, one
 * open at a time, closing once it connects; `onConnected` hears whether
 * either harness stands connected, as each answer leaves them.
 */
export function AgentConnectSection({
  onConnected,
}: {
  onConnected: (connected: boolean) => void;
}): React.JSX.Element {
  const chatGptOffered = useCapability(HOST_CAPABILITY.CHATGPT_SIGN_IN);
  const credentials = useCredentials({ signedIn: true, onConnected });
  const { answer } = credentials;
  const [open, setOpen] = useState<ProviderKeyProvider | undefined>(undefined);
  // Note that a row open closes once the keys the host holds say its harness connected anew, as a write's own answer lays them.
  const before = useRef(answer);
  useEffect(() => {
    const was = before.current;
    before.current = answer;
    if (
      open !== undefined &&
      was !== undefined &&
      answer !== undefined &&
      connectedAnew(open, was, answer, chatGptOffered)
    ) {
      setOpen(undefined);
    }
  }, [answer, open, chatGptOffered]);
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
              signInOffered={chatGptOffered}
              onOpen={() => setOpen(provider)}
              onClose={() => setOpen(undefined)}
            />
          ))
        }
      </HarnessList>
    </div>
  );
}
