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
  CheckIcon,
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
 * checked is off, so the Start payer picker, which reads it, follows the
 * radio. A radio is pressable only once its credential is saved; with
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
  CONTINUE: "Continue with ChatGPT",
  WAITING: "Waiting for ChatGPT…",
  CONNECTED: "Connected",
  UNVERIFIED: "Connected · Not yet checked",
  USAGE_LIMIT: "Usage limit reached",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_SIGNED_OUT: "ChatGPT ended this sign-in. Continue with ChatGPT to connect again.",
  CHATGPT_UNREADABLE: "This sign-in can no longer be read. Continue with ChatGPT to connect again.",
  CHATGPT_INELIGIBLE:
    "OpenAI says this ChatGPT account isn't eligible for Codex. Continue with ChatGPT to use another.",
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
      return WORDS.UNVERIFIED;
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

/** What an API key's status says, by the provider it names; nothing once verified, which its ✓ says. */
function keyStatusWords(
  provider: ProviderKeyProvider,
  status: ProviderKeyStatus,
): string | undefined {
  const name = HARNESS[provider].keyName;
  switch (status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
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
    case PROVIDER_KEY_STATUS.UNVERIFIED:
      return "Not checked yet";
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

/** One radio card: its radio and label on its head, what it says at the head's end, and its credential's controls under them. */
function CredentialCard({
  label,
  checked,
  selectable,
  saved,
  disabled = false,
  detail,
  aside,
  tabStop,
  onSelect,
  children,
}: {
  label: string;
  checked: boolean;
  /** Whether its credential is saved, so the radio may be pressed. */
  selectable: boolean;
  /** Whether its credential is connected, which its ✓ says. */
  saved: boolean;
  /** Whether the whole card is out of reach on this client. */
  disabled?: boolean;
  /** The one line under the label, why a disabled card is. */
  detail?: string | undefined;
  aside?: React.ReactNode;
  tabStop: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="agent-auth-card" data-checked={checked} data-disabled={disabled || undefined}>
      <div className="agent-auth-card-head">
        {/* biome-ignore lint/a11y/useSemanticElements: the radio is drawn as ChoiceList's rows are, a button holding the control's mark and the label, speaking as the radio it behaves as. */}
        <button
          type="button"
          role="radio"
          aria-checked={checked}
          className="agent-auth-radio"
          disabled={!selectable || disabled}
          tabIndex={tabStop ? 0 : -1}
          onClick={() => {
            if (!checked) onSelect();
          }}
        >
          <span className="luke-choice-control" data-shape="radio" aria-hidden="true" />
          <span className="agent-auth-label">{label}</span>
          {saved ? <Saved /> : null}
        </button>
        {aside === undefined ? null : <span className="agent-auth-aside">{aside}</span>}
      </div>
      {detail === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {detail}
        </Text>
      )}
      {children === undefined || children === null ? null : (
        <div className="agent-auth-card-body">{children}</div>
      )}
    </div>
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
                ? "Paste the token from claude setup-token"
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

/** The ChatGPT plan: Continue with ChatGPT where the loopback can be listened on, its status, and Disconnect. */
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
                busy={signingIn}
                busyLabel={WORDS.WAITING}
                onClick={signIn}
              >
                {WORDS.CONTINUE}
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
  const subtitleId = useId();
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
  const tabStop: Credential =
    chosen ?? (selectable[CREDENTIAL.SUBSCRIPTION] ? CREDENTIAL.SUBSCRIPTION : CREDENTIAL.API_KEY);
  // The arrows move the choice to the other card's radio where its credential is saved, as a radio group's do.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const other = chosen === CREDENTIAL.SUBSCRIPTION ? CREDENTIAL.API_KEY : CREDENTIAL.SUBSCRIPTION;
    event.preventDefault();
    if (!selectable[other]) return;
    choose(other);
    const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[other === CREDENTIAL.SUBSCRIPTION ? 0 : 1]?.focus();
  };

  return (
    <Dialog
      title={harness.name}
      describedBy={subtitleId}
      size={DIALOG_SIZE.WIDE}
      onDismiss={onClose}
      actions={
        <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onClose}>
          {WORDS.DONE}
        </Button>
      }
    >
      <div className={`agent-auth-dialog ${NO_CAPTURE}`}>
        <Text id={subtitleId} tone={TEXT_TONE.MUTED}>
          {`How ${harness.name} authenticates in cloud workspaces.`}
        </Text>
        <div
          role="radiogroup"
          aria-label={`${harness.name} credential`}
          className="agent-auth-cards"
          onKeyDown={onKeyDown}
        >
          <CredentialCard
            label={WORDS.SUBSCRIPTION}
            checked={chosen === CREDENTIAL.SUBSCRIPTION}
            selectable={selectable[CREDENTIAL.SUBSCRIPTION]}
            saved={plan !== undefined && standing(plan)}
            disabled={planOutOfReach}
            detail={planOutOfReach ? WORDS.DESKTOP_ONLY : undefined}
            tabStop={tabStop === CREDENTIAL.SUBSCRIPTION}
            onSelect={() => choose(CREDENTIAL.SUBSCRIPTION)}
          >
            {planOutOfReach ? null : claude ? (
              <ClaudeTokenPanel plan={plan} onAnswer={onAnswer} />
            ) : (
              <ChatGptPanel plan={plan} offered={chatGptOffered} onAnswer={onAnswer} />
            )}
          </CredentialCard>
          <CredentialCard
            label={WORDS.API_KEY}
            checked={chosen === CREDENTIAL.API_KEY}
            selectable={selectable[CREDENTIAL.API_KEY]}
            saved={key !== undefined}
            tabStop={tabStop === CREDENTIAL.API_KEY}
            onSelect={() => choose(CREDENTIAL.API_KEY)}
            aside={
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
            }
          >
            <ApiKeyPanel provider={provider} stored={key} onAnswer={onAnswer} />
          </CredentialCard>
        </div>
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
