import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
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
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  CheckIcon,
  ChoiceList,
  type ChoiceOption,
  ConfirmDialog,
  DIALOG_SIZE,
  Dialog,
  EllipsisIcon,
  ErrorState,
  IconButton,
  PencilIcon,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_BUTTON_TONE,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_FONT,
  TEXT_FIELD_TYPE,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TextField,
  TextLink,
  TrashIcon,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { HarnessMark } from "../harness-marks.js";
import { dayAndTimeText } from "../tasks/task-time.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useCapability } from "../use-app-state.js";

/**
 * agent-auth-section.tsx -- Settings › Agents' harnesses: one row each for Claude Code and Codex, saying how it is connected, and the dialog that connects it.
 *
 * The account holds up to two credentials per harness: a plan (Claude's
 * `claude setup-token`, or the ChatGPT sign-in) and the provider's API key.
 * A row's button says which of them that harness's new agents use, or that
 * neither is set (Connect), or that the plan in use needs a hand. The
 * button opens the harness's dialog: a radio card per credential, each
 * holding its own controls, the checked radio being the default. The
 * default is the plan's `forAgents`: Subscription checked is on, API key
 * checked is off, and every agent Start makes on that provider's models
 * runs on the credential checked; there is no choice at Start. A radio is pressable only once its credential is saved; with
 * neither saved, agents run on Luke's key as before.
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
 * on; elsewhere its card says so and stands unpressable until a sign-in
 * made on the desktop is there to pick or disconnect. The first sign-in on
 * this Mac is met with OpenAI's notice that Luke uses the ChatGPT plan
 * (developers.openai.com/siwc/ui-ux-guidelines), dismissed with Got it and
 * never shown again here, kept in the renderer's own storage.
 */

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** Where this Mac keeps that the ChatGPT notice was seen, in the renderer's own storage. */
const NOTICE_SEEN_KEY = "luke.chatGptFirstSignInNoticeSeen";

/** Which of a harness's credentials its new agents use. */
const CREDENTIAL = {
  SUBSCRIPTION: "subscription",
  API_KEY: "api_key",
} as const;

type Credential = (typeof CREDENTIAL)[keyof typeof CREDENTIAL];

/** Each harness by the provider whose models it runs: its name, its plan's kind, the provider's name on its key, where a key is made, and the row a search lands on. */
const HARNESS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    name: "Claude Code",
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    keyName: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    anchor: SETTINGS_SEARCH_ROW.API_KEY_ANTHROPIC,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    keyName: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    anchor: SETTINGS_SEARCH_ROW.API_KEY_OPENAI,
  },
} as const satisfies Record<ProviderKeyProvider, unknown>;

const HARNESSES: readonly ProviderKeyProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

const WORDS = {
  READ_FAILED: "Your keys could not be read.",
  SIGNED_OUT: "Sign in to connect your agents.",
  CONNECT: "Connect",
  VIA_SUBSCRIPTION: "Connected via subscription",
  VIA_API_KEY: "Connected via API key",
  RECONNECT: "Subscription needs reconnecting",
  LIMIT: "Limit reached",
  KEY_ATTENTION: "API key needs attention",
  SUBSCRIPTION: "Subscription",
  API_KEY: "API key",
  GET_KEY: "Get key",
  DESKTOP_ONLY: "Desktop app only",
  DONE: "Done",
  CANCEL: "Cancel",
  SAVE: "Save",
  DISCONNECT: "Disconnect",
  REMOVE: "Remove",
  ADD_TOKEN: "Add token",
  REPLACE_TOKEN: "Replace token",
  SIGN_IN: "Sign in with ChatGPT",
  WAITING: "Waiting for ChatGPT…",
  CONNECTED: "Connected",
  USAGE_LIMIT: "Usage limit reached",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_SIGNED_OUT: "ChatGPT ended this sign-in. Sign in with ChatGPT to connect again.",
  CHATGPT_UNREADABLE: "This sign-in can no longer be read. Sign in with ChatGPT to connect again.",
  CHATGPT_INELIGIBLE:
    "OpenAI says this ChatGPT account isn't eligible for Codex. Sign in with ChatGPT to use another.",
  REVOCATION_UNCONFIRMED:
    "Luke no longer holds your ChatGPT sign-in, but OpenAI didn't confirm it ended. To end it there too, remove Luke in your ChatGPT settings.",
  NOTICE_TITLE: "You're using your ChatGPT plan",
  NOTICE_BODY:
    "Eligible usage in Luke uses your ChatGPT plan. Manage usage in your ChatGPT settings.",
  GOT_IT: "Got it",
  SAVE_TOKEN_FAILED: "The token could not be saved. Try again.",
  SAVE_KEY_FAILED: "The key could not be saved. Try again.",
  REMOVE_KEY_FAILED: "The key could not be removed. Try again.",
  CLAUDE_DISCONNECT_FAILED: "Your Claude plan could not be disconnected. Try again.",
  CHATGPT_DISCONNECT_FAILED: "ChatGPT could not be disconnected. Try again.",
  SIGN_IN_FAILED: "Luke couldn't reach ChatGPT. Try again.",
  DEFAULT_FAILED: "The default could not be changed. Try again.",
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

/** The credential the harness's new agents use: the plan where it is on for them, else the key, else neither (Luke's). */
function defaultOf(
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
): Credential | undefined {
  if (plan !== undefined && plan.forAgents !== false) return CREDENTIAL.SUBSCRIPTION;
  if (key !== undefined) return CREDENTIAL.API_KEY;
  return undefined;
}

/** What a harness's row button says, and whether it asks for a hand or reports a connection. */
function connectionOf(
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
): { words: string; connected: boolean; attention: boolean } {
  const chosen = defaultOf(plan, key);
  if (chosen === CREDENTIAL.API_KEY && key !== undefined) {
    return keyStanding(key.status)
      ? { words: WORDS.VIA_API_KEY, connected: true, attention: false }
      : { words: WORDS.KEY_ATTENTION, connected: false, attention: true };
  }
  if (plan !== undefined) {
    if (plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) {
      return { words: WORDS.LIMIT, connected: false, attention: true };
    }
    return standing(plan)
      ? { words: WORDS.VIA_SUBSCRIPTION, connected: true, attention: false }
      : { words: WORDS.RECONNECT, connected: false, attention: true };
  }
  return { words: WORDS.CONNECT, connected: false, attention: false };
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

/** What a ChatGPT sign-in's status says. */
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
      return `Out of quota or credit at ${name}.`;
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
      return "Too many keys tried in the last hour. Try again later.";
    case PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN:
      return `${name} couldn't confirm this sign-in. Sign in again.`;
  }
}

/** Why a Claude token's save kept nothing. */
function tokenRejectionWords(rejection: ProviderKeyRejection): string {
  return rejection === PROVIDER_KEY_REJECTION.TOO_MANY_TRIES
    ? "Too many keys tried in the last hour. Try again later."
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

/** A status in the connected or the attention tint, announced where it needs a hand. */
function State({ ok, children }: { ok: boolean; children: string }): React.JSX.Element {
  return (
    <span
      className="settings-state"
      data-state={ok ? "connected" : "attention"}
      role={ok ? undefined : "alert"}
    >
      {children}
    </span>
  );
}

/** The green check beside a saved credential's label and a connected row's words. */
function Saved(): React.JSX.Element {
  return (
    <span className="agent-auth-check">
      <CheckIcon />
    </span>
  );
}

/**
 * OpenAI's mark as Sign in with ChatGPT's own button wears it, verbatim from
 * `/assets/siwc/chatgpt-logo-white.svg`, the asset OpenAI's UI guidelines
 * draw their button with (developers.openai.com/siwc/ui-ux-guidelines), its
 * white fill drawn in `currentColor` so it takes the button's ink on either
 * ground; the button sizes it as any glyph it leads with.
 */
function ChatGptMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 21 21" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M11.8102 19.1625C11.2327 19.1625 10.6841 19.0528 10.1643 18.8334C9.64459 18.6139 9.18259 18.3078 8.77834 17.9151C8.33944 18.0653 7.88322 18.1404 7.40967 18.1404C6.63582 18.1404 5.91972 17.9498 5.26137 17.5686C4.60302 17.1875 4.07172 16.6677 3.66747 16.0094C3.27477 15.351 3.07842 14.6176 3.07842 13.8091C3.07842 13.4742 3.12462 13.1103 3.21702 12.7176C2.75502 12.2903 2.39697 11.7994 2.14287 11.245C1.88877 10.679 1.76172 10.09 1.76172 9.47785C1.76172 8.85415 1.89454 8.25355 2.16019 7.67605C2.42584 7.09855 2.79544 6.6019 3.26899 6.1861C3.75409 5.75875 4.31427 5.46422 4.94952 5.30252C5.07657 4.64417 5.34222 4.05512 5.74647 3.53537C6.16227 3.00407 6.67047 2.58827 7.27107 2.28797C7.87167 1.98767 8.51269 1.83752 9.19414 1.83752C9.77164 1.83752 10.3203 1.94725 10.84 2.1667C11.3598 2.38615 11.8218 2.69222 12.226 3.08492C12.6649 2.93477 13.1211 2.8597 13.5947 2.8597C14.3685 2.8597 15.0846 3.05027 15.743 3.43142C16.4013 3.81257 16.9269 4.33232 17.3196 4.99067C17.7238 5.64902 17.9259 6.38245 17.9259 7.19095C17.9259 7.5259 17.8797 7.88973 17.7873 8.28242C18.2493 8.70977 18.6074 9.20643 18.8615 9.77238C19.1156 10.3268 19.2426 10.91 19.2426 11.5222C19.2426 12.1459 19.1098 12.7465 18.8442 13.324C18.5785 13.9015 18.2031 14.4039 17.718 14.8313C17.2445 15.2471 16.6901 15.5358 16.0548 15.6975C15.9278 16.3559 15.6564 16.9449 15.2406 17.4647C14.8363 17.996 14.3339 18.4118 13.7333 18.7121C13.1327 19.0124 12.4917 19.1625 11.8102 19.1625ZM7.53094 16.9969C8.10844 16.9969 8.61087 16.8756 9.03822 16.6331L12.2953 14.762C12.4108 14.6811 12.4686 14.5714 12.4686 14.4328V12.9429L8.27592 15.351C8.02182 15.5012 7.76772 15.5012 7.51362 15.351L4.23919 13.4626C4.23919 13.4973 4.23342 13.5377 4.22187 13.5839C4.22187 13.6301 4.22187 13.6994 4.22187 13.7918C4.22187 14.3808 4.36047 14.9237 4.63767 15.4203C4.92642 15.9054 5.32489 16.2866 5.83309 16.5638C6.34129 16.8525 6.90724 16.9969 7.53094 16.9969ZM7.70419 14.1729C7.77349 14.2076 7.83702 14.2249 7.89477 14.2249C7.95252 14.2249 8.01027 14.2076 8.06802 14.1729L9.36739 13.4279L5.19207 11.0024C4.93797 10.8523 4.81092 10.6271 4.81092 10.3268V6.56725C4.23342 6.82135 3.77142 7.21405 3.42492 7.74535C3.07842 8.2651 2.90517 8.8426 2.90517 9.47785C2.90517 10.0438 3.04954 10.5866 3.33829 11.1064C3.62704 11.6261 4.00242 12.0189 4.46442 12.2845L7.70419 14.1729ZM11.8102 18.0191C12.4224 18.0191 12.9768 17.8805 13.4734 17.6033C13.9701 17.3261 14.3628 16.9449 14.6515 16.4598C14.9403 15.9747 15.0846 15.4319 15.0846 14.8313V11.0891C15.0846 10.9505 15.0269 10.8465 14.9114 10.7772L13.5947 10.0149V14.8486C13.5947 15.1489 13.4676 15.3741 13.2135 15.5243L9.93912 17.4127C10.5051 17.817 11.1288 18.0191 11.8102 18.0191ZM12.4686 11.6781V9.32192L10.5108 8.21312L8.53579 9.32192V11.6781L10.5108 12.7869L12.4686 11.6781ZM7.40967 6.15145C7.40967 5.85115 7.53672 5.62592 7.79082 5.47577L11.0652 3.58735C10.4993 3.1831 9.87559 2.98097 9.19414 2.98097C8.58199 2.98097 8.02759 3.11957 7.53094 3.39677C7.03429 3.67397 6.64159 4.05512 6.35284 4.54022C6.07564 5.02532 5.93704 5.56817 5.93704 6.16878V9.89365C5.93704 10.0323 5.99479 10.142 6.11029 10.2228L7.40967 10.9851V6.15145ZM16.2108 14.4328C16.7883 14.1787 17.2445 13.786 17.5794 13.2547C17.9259 12.7234 18.0992 12.1459 18.0992 11.5222C18.0992 10.9562 17.9548 10.4134 17.6661 9.89365C17.3773 9.3739 17.0019 8.9812 16.5399 8.71555L13.3002 6.84445C13.2309 6.79825 13.1673 6.78092 13.1096 6.79248C13.0518 6.79248 12.9941 6.8098 12.9363 6.84445L11.637 7.5721L15.8296 10.0149C15.9567 10.0842 16.0491 10.1766 16.1068 10.2921C16.1761 10.3961 16.2108 10.5231 16.2108 10.6733V14.4328ZM12.7284 5.6317C12.9825 5.47 13.2366 5.47 13.4907 5.6317L16.7825 7.55477C16.7825 7.47393 16.7825 7.36997 16.7825 7.24292C16.7825 6.68852 16.6439 6.163 16.3667 5.66635C16.101 5.15815 15.7141 4.7539 15.2059 4.4536C14.7093 4.1533 14.1318 4.00315 13.4734 4.00315C12.8959 4.00315 12.3935 4.12442 11.9661 4.36697L8.70904 6.23808C8.59354 6.31892 8.53579 6.42865 8.53579 6.56725V8.0572L12.7284 5.6317Z" />
    </svg>
  );
}

/* ----- The subscription cards ----- */

/** Claude's plan: a pasted setup-token, its status, Replace token, and Disconnect. */
function ClaudeTokenPanel({
  plan,
  onAnswer,
}: {
  plan: SubscriptionKeySummary | undefined;
  onAnswer: (answer: ProviderKeysAnswer) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [editing, setEditing] = useState(plan === undefined);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

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
          onAnswer(removed);
          setEditing(true);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act, onAnswer],
  );
  const removal = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: true }, disconnect);

  const cancel = () => {
    setPasted("");
    setRejection(undefined);
    setEditing(false);
  };
  const save = () => {
    const key = pasted.trim();
    if (key === "" || saving) return;
    setSaving(true);
    setRejection(undefined);
    void act(ACT_KIND.PROVIDER_KEYS_SAVE, {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key,
    })
      .catch(() => undefined)
      .then((saved) => {
        setSaving(false);
        if (saved === undefined || "failure" in saved) {
          setRejection(WORDS.SAVE_TOKEN_FAILED);
          return;
        }
        onAnswer(saved);
        if (saved.rejected !== undefined) {
          setRejection(tokenRejectionWords(saved.rejected));
          return;
        }
        // Kept: the token leaves the field, and the card draws the service's word for it.
        setPasted("");
        setEditing(false);
      });
  };

  const ok = plan !== undefined && standing(plan);
  return (
    <>
      {plan === undefined ? null : (
        <div className="agent-auth-line">
          <span className="agent-auth-facts">
            <State ok={ok && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
              {tokenWords(plan)}
            </State>
            <code className="api-key-hint">{plan.hint}</code>
          </span>
          {editing ? null : (
            <span className="agent-auth-presses">
              {ok ? null : (
                <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setEditing(true)}>
                  {WORDS.REPLACE_TOKEN}
                </Button>
              )}
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                disabled={removal.busy}
                onClick={removal.ask}
              >
                {WORDS.DISCONNECT}
              </Button>
            </span>
          )}
        </div>
      )}
      {editing ? (
        <form
          className="api-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TextField
            type={TEXT_FIELD_TYPE.PASSWORD}
            autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
            label="Claude setup-token"
            placeholder={
              plan === undefined
                ? 'Paste the token from "claude setup-token"'
                : "Paste your Claude setup-token"
            }
            spellCheck={false}
            disabled={saving}
            value={pasted}
            invalid={rejection !== undefined}
            onEscape={plan === undefined ? undefined : cancel}
            onChange={(value) => {
              setPasted(value);
              setRejection(undefined);
            }}
          />
          {plan === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} disabled={saving} onClick={cancel}>
              {WORDS.CANCEL}
            </Button>
          )}
          <Button
            type={BUTTON_TYPE.SUBMIT}
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={pasted.trim() === ""}
            busy={saving}
            busyLabel="Saving the token"
          >
            {WORDS.SAVE}
          </Button>
        </form>
      ) : null}
      {rejection === undefined ? null : <State ok={false}>{rejection}</State>}
      <ConfirmDialog
        confirm={removal}
        question={{
          title: "Disconnect your Claude plan?",
          body: "Claude Code agents will stop running on your Claude plan, and Luke deletes the token it holds.",
          verb: WORDS.DISCONNECT,
          running: "Disconnecting…",
        }}
      />
    </>
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

/** The ChatGPT plan: Sign in with ChatGPT where the loopback can be listened on, its status, and Disconnect. */
function ChatGptPanel({
  plan,
  offered,
  onAnswer,
}: {
  plan: SubscriptionKeySummary | undefined;
  /** Whether this client can take the sign-in's loopback (the desktop). */
  offered: boolean;
  onAnswer: (answer: ProviderKeysAnswer) => void;
}): React.JSX.Element | null {
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
        onAnswer(outcome);
        if (!noticeSeen()) setNotice(true);
      });
  }, [act, onAnswer]);

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
          onAnswer(removed);
          setUnconfirmed(removed.revocationUnconfirmed === true);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act, onAnswer],
  );
  const removal = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: true }, disconnect);
  const dismissNotice = useCallback(() => {
    markNoticeSeen();
    setNotice(false);
  }, []);

  const connected = plan !== undefined && standing(plan);
  const continueOffered = offered && !connected;
  if (plan === undefined && !continueOffered && !unconfirmed && error === undefined) return null;
  return (
    <>
      <div className="agent-auth-line">
        <span className="agent-auth-facts">
          {plan === undefined ? null : (
            <State ok={connected && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
              {signInWords(plan)}
            </State>
          )}
        </span>
        <span className="agent-auth-presses">
          {connected ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} disabled={removal.busy} onClick={removal.ask}>
              {WORDS.DISCONNECT}
            </Button>
          ) : continueOffered ? (
            <>
              {signingIn ? (
                <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={cancel}>
                  {WORDS.CANCEL}
                </TextButton>
              ) : null}
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                icon={<ChatGptMark />}
                busy={signingIn}
                busyLabel={WORDS.WAITING}
                onClick={signIn}
              >
                {WORDS.SIGN_IN}
              </Button>
            </>
          ) : null}
        </span>
      </div>
      {error === undefined ? null : <State ok={false}>{error}</State>}
      {unconfirmed ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.REVOCATION_UNCONFIRMED}
        </Text>
      ) : null}
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
    </>
  );
}

/* ----- The API key card ----- */

/** The provider's API key: a masked field with its eye while one is pasted, else its hint with the pencil and a ⋯ holding Remove. */
function ApiKeyPanel({
  provider,
  stored,
  onAnswer,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary | undefined;
  onAnswer: (answer: ProviderKeysAnswer) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const name = HARNESS[provider].keyName;
  const field = useRef<HTMLInputElement | null>(null);
  const door = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const menu = useMenu(true);
  const open = stored === undefined || editing;

  // The pencil opens the field with the focus in it, ready for the paste.
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const remove = useCallback(
    (): Promise<ActionResult> =>
      act(ACT_KIND.PROVIDER_KEYS_REMOVE, { provider })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.REMOVE_KEY_FAILED };
          }
          onAnswer(answer);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act, onAnswer, provider],
  );
  const removal = useConfirmDialog({ subject: stored !== undefined, surfaceOpen: true }, remove);

  const cancel = () => {
    setPasted("");
    setShown(false);
    setRejection(undefined);
    setEditing(false);
  };
  const save = () => {
    const key = pasted.trim();
    if (key === "" || saving) return;
    setSaving(true);
    setRejection(undefined);
    void act(ACT_KIND.PROVIDER_KEYS_SAVE, { provider, key })
      .catch(() => undefined)
      .then((answer) => {
        setSaving(false);
        if (answer === undefined || "failure" in answer) {
          setRejection(WORDS.SAVE_KEY_FAILED);
          return;
        }
        onAnswer(answer);
        if (answer.rejected !== undefined) {
          setRejection(keyRejectionWords(provider, answer.rejected));
          return;
        }
        // Kept: the key leaves the field, and the card draws the service's hint of it.
        setPasted("");
        setShown(false);
        setEditing(false);
      });
  };

  const status = stored === undefined ? undefined : keyStatusWords(provider, stored.status);
  return (
    <>
      {open ? (
        <form
          className="api-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <span className="agent-auth-field">
            <TextField
              ref={field}
              type={shown ? TEXT_FIELD_TYPE.TEXT : TEXT_FIELD_TYPE.PASSWORD}
              autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
              label={`${name} API key`}
              placeholder={`Paste your ${name} API key`}
              spellCheck={false}
              disabled={saving}
              value={pasted}
              invalid={rejection !== undefined}
              onEscape={stored === undefined ? undefined : cancel}
              onChange={(value: string) => {
                setPasted(value);
                setRejection(undefined);
              }}
            />
            <IconButton
              icon={shown ? <EyeOffIcon /> : <EyeIcon />}
              label={shown ? "Hide key" : "Show key"}
              pressed={shown}
              onClick={() => setShown((now) => !now)}
            />
          </span>
          {stored === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} disabled={saving} onClick={cancel}>
              {WORDS.CANCEL}
            </Button>
          )}
          <Button
            type={BUTTON_TYPE.SUBMIT}
            variant={BUTTON_VARIANT.PRIMARY}
            disabled={pasted.trim() === ""}
            busy={saving}
            busyLabel="Checking the key"
          >
            {WORDS.SAVE}
          </Button>
        </form>
      ) : (
        <div className="agent-auth-line">
          <span className="agent-auth-field">
            <TextField
              label={`${name} API key`}
              readOnly
              font={TEXT_FIELD_FONT.MONO}
              value={stored?.hint ?? ""}
              onChange={() => undefined}
            />
            <IconButton
              icon={<PencilIcon />}
              label="Edit key"
              disabled={removal.busy}
              onClick={() => setEditing(true)}
            />
            <IconButton
              ref={door}
              icon={<EllipsisIcon />}
              label={`${name} key actions`}
              {...menu.trigger()}
            />
          </span>
        </div>
      )}
      {status === undefined || stored === undefined ? null : (
        <State ok={keyStanding(stored.status)}>{status}</State>
      )}
      {rejection === undefined ? null : <State ok={false}>{rejection}</State>}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${name} key actions`}
          menu={menu.drawn}
          groups={[
            [
              {
                label: WORDS.REMOVE,
                icon: <TrashIcon />,
                danger: true,
                disabled: removal.busy,
                onSelect: removal.ask,
              },
            ],
          ]}
          onClose={menu.close}
        />
      )}
      <ConfirmDialog
        confirm={removal}
        question={{
          title: `Remove your ${name} API key?`,
          body: `Agents on ${name} models will run on Luke's key.`,
          verb: "Remove key",
          running: "Removing…",
        }}
      />
    </>
  );
}

/* ----- The dialog ----- */

/** A harness's dialog: a radio card per credential, the checked one its new agents' default. */
function AgentAuthDialog({
  provider,
  answer,
  onAnswer,
  onClose,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  onAnswer: (answer: ProviderKeysAnswer) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const openLink = useOpenLink();
  const chatGptOffered = useCapability(HOST_CAPABILITY.CHATGPT_SIGN_IN);
  const harness = HARNESS[provider];
  const plan = planOf(answer, provider);
  const key = keyOf(answer, provider);
  const chosen = defaultOf(plan, key);
  const [turning, setTurning] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const claude = provider === PROVIDER_KEY_PROVIDER.ANTHROPIC;
  // The ChatGPT sign-in is the desktop's alone, so elsewhere its card stands out of reach until one made there is held.
  const planOutOfReach = !claude && !chatGptOffered && plan === undefined;

  const choose = (next: Credential) => {
    // Note that with no plan held the key is already the default, so there is nothing to write.
    if (plan === undefined || turning) return;
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
        onAnswer(turned);
      });
  };

  const selectable = {
    [CREDENTIAL.SUBSCRIPTION]: plan !== undefined && !turning,
    [CREDENTIAL.API_KEY]: key !== undefined && !turning,
  };
  const cards: readonly ChoiceOption<Credential>[] = [
    {
      value: CREDENTIAL.SUBSCRIPTION,
      label: WORDS.SUBSCRIPTION,
      after: plan !== undefined && standing(plan) ? <Saved /> : undefined,
      disabled: !selectable[CREDENTIAL.SUBSCRIPTION] || planOutOfReach,
      detail: planOutOfReach ? WORDS.DESKTOP_ONLY : undefined,
      below: planOutOfReach ? null : claude ? (
        <ClaudeTokenPanel plan={plan} onAnswer={onAnswer} />
      ) : (
        <ChatGptPanel plan={plan} offered={chatGptOffered} onAnswer={onAnswer} />
      ),
    },
    {
      value: CREDENTIAL.API_KEY,
      label: WORDS.API_KEY,
      after: key !== undefined ? <Saved /> : undefined,
      disabled: !selectable[CREDENTIAL.API_KEY],
      aside: (
        <TextLink
          look={TEXT_LINK_LOOK.UNDERLINED}
          href={harness.keyUrl}
          external
          onClick={(event) => {
            event.preventDefault();
            openLink(harness.keyUrl);
          }}
        >
          {WORDS.GET_KEY}
        </TextLink>
      ),
      below: <ApiKeyPanel provider={provider} stored={key} onAnswer={onAnswer} />,
    },
  ];

  return (
    <Dialog
      title={harness.name}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onClose}>
          {WORDS.DONE}
        </Button>
      }
    >
      <div className={`agent-auth-dialog ${NO_CAPTURE}`}>
        <ChoiceList
          legend={`${harness.name} credential`}
          options={cards}
          value={chosen === undefined ? [] : [chosen]}
          look={CHOICE_LOOK.CARD}
          onChange={([next]) => {
            if (next !== undefined) choose(next);
          }}
        />
        {refused === undefined ? null : <State ok={false}>{refused}</State>}
      </div>
    </Dialog>
  );
}

/* ----- The list ----- */

/** The harness rows, each opening its dialog, over the account's credentials read once and changed in place. */
export function AgentAuthSection({
  signedIn,
  onKeys,
}: {
  signedIn: boolean;
  /** The API keys as last read or changed, none where they could not be read; not called while the read is out. */
  onKeys: (keys: readonly ProviderKeySummary[]) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [answer, setAnswer] = useState<ProviderKeysAnswer | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<ProviderKeyProvider | undefined>(undefined);

  // The page opening reads the credentials as the service holds them now, which a step may just have marked.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Nothing of an earlier read, or an earlier account, stands while this one is out.
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

  // The Default model row hears every answer, so nothing there says what a key used to be.
  useEffect(() => {
    if (answer !== undefined || readFailed) onKeys(answer?.keys ?? []);
  }, [answer, readFailed, onKeys]);

  return (
    <div className={NO_CAPTURE}>
      <SettingsSection>
        {!signedIn ? (
          <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
        ) : answer !== undefined ? (
          HARNESSES.map((provider) => {
            const connection = connectionOf(planOf(answer, provider), keyOf(answer, provider));
            return (
              <div key={provider} {...searchAnchorProps(HARNESS[provider].anchor)}>
                <SettingsRow
                  leading={
                    <span className="settings-row-mark">
                      <HarnessMark provider={provider} />
                    </span>
                  }
                  label={HARNESS[provider].name}
                >
                  {() => (
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      aria-haspopup="dialog"
                      onClick={() => setOpen(provider)}
                    >
                      {connection.attention ? (
                        <span className="settings-state" data-state="attention">
                          {connection.words}
                        </span>
                      ) : (
                        connection.words
                      )}
                      {connection.connected ? <Saved /> : null}
                    </Button>
                  )}
                </SettingsRow>
              </div>
            );
          })
        ) : readFailed ? (
          <SettingsLine>
            <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
              {WORDS.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label="Loading your keys" rows={HARNESSES.length} marked />
        )}
      </SettingsSection>
      {open === undefined || answer === undefined ? null : (
        <AgentAuthDialog
          provider={open}
          answer={answer}
          onAnswer={setAnswer}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  );
}
