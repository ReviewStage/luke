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
import { dayAndTimeText } from "@luke/features/time-format";
import { readingWords, SIGNED_OUT_WORDS } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import {
  ANNOUNCE,
  BANNER_LOOK,
  Banner,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CHOICE_LOOK,
  ChoiceList,
  type ChoiceOption,
  CONFIRM_LOSS,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorState,
  FootQuestion,
  GAP,
  IconButton,
  Inline,
  JUSTIFY,
  LAYOUT_ELEMENT,
  MARK_PROVIDER,
  MoreButton,
  moreLabel,
  PencilIcon,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SecretField,
  SettingsFacts,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  type SettingsRowSkeletonShape,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsRowsSkeleton,
  SettingsSavedMark,
  SettingsSection,
  Stack,
  TEXT_ELEMENT,
  TEXT_FIELD_FONT,
  TEXT_FONT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
  TextLink,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { InfoIcon } from "@luke/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { HarnessMark } from "../harness-marks.js";
import { useSettleOpenAiKey } from "../openai-key.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { useCapability } from "../use-app-state.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";

/**
 * agent-auth-section.tsx -- Settings › Agents' harnesses: one row each for Claude and Codex, saying how it is connected, and the dialog that connects it.
 *
 * The account holds up to two credentials per harness: a plan (Claude's
 * `claude setup-token`, or the ChatGPT sign-in) and the provider's API key.
 * A row's line says which of them that harness's new agents use, or that
 * the one in use needs a hand, and its button is the act: Connect while
 * neither is set, Manage once one is. The
 * button opens the harness's dialog: a radio card per credential, each
 * holding its own controls, the checked radio being the default. The
 * default is the plan's `forAgents`: Subscription checked is on, API key
 * checked is off, and every agent Start makes on that provider's models
 * runs on the credential checked; there is no choice at Start. A radio is pressable only once its credential is saved; with
 * neither saved, no agent starts on that provider's models, since Luke's key
 * pays for no coding agent. Calls and dictation run on the OpenAI API key
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
 * on; elsewhere its card says so and stands unpressable until a sign-in
 * made on the desktop is there to pick or disconnect. The first sign-in on
 * this Mac is met with OpenAI's notice that Luke uses the ChatGPT plan
 * (developers.openai.com/siwc/ui-ux-guidelines), drawn in its card under the
 * sign-in, dismissed with Got it and never shown again here, kept in the
 * renderer's own storage.
 *
 * What the dialog asks about a credential it holds, disconnecting a plan or
 * removing a key, it asks at its own foot (`FootQuestion`), never in a
 * second card over itself.
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

/** What a harness's row and dialog are drawn from. */
interface Harness {
  readonly name: string;
  readonly plan: SubscriptionKeySummary["kind"];
  readonly keyName: string;
  readonly keyUrl: string;
  readonly anchor: string;
  readonly detail: string | undefined;
}

/**
 * Each harness by the provider whose models it runs: its name, its plan's
 * kind, the provider's name on its key, where a key is made, the row a search
 * or a remedy lands on, and the line under its name, where one says more.
 */
const HARNESS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    name: "Claude",
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    keyName: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    anchor: SETTINGS_SECTION.CLAUDE,
    detail: undefined,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    keyName: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    anchor: SETTINGS_SECTION.CODEX,
    // Note that the Voice page sends here for the key a call runs on, so the row says it holds it.
    detail: "Its OpenAI key also runs calls and dictation.",
  },
} as const satisfies Record<ProviderKeyProvider, Harness>;

/** A harness's row while the keys are read: its mark, its name and any line under it, and the press that connects it. */
function keyRowSkeleton(provider: ProviderKeyProvider): SettingsRowSkeletonShape {
  return {
    described: HARNESS[provider].detail !== undefined,
    mark: SETTINGS_ROW_MARK_WIDTH,
    controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
  };
}

const HARNESSES: readonly ProviderKeyProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

const WORDS = {
  READ_FAILED: "Your keys could not be read.",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  CONNECT: "Connect",
  MANAGE: "Manage",
  VIA_SUBSCRIPTION: "Connected with a subscription",
  VIA_API_KEY: "Connected with an API key",
  SIGN_IN_EXPIRED: "Sign-in expired",
  PLAN_ATTENTION: "Subscription needs attention",
  KEY_ATTENTION: "API key needs attention",
  SUBSCRIPTION: "Subscription",
  API_KEY: "API key",
  GET_KEY: "Get key",
  DESKTOP_ONLY: "Desktop app only",
  CANCEL: "Cancel",
  SAVE: "Save",
  SAVING_TOKEN: "Saving the token",
  DISCONNECT: "Disconnect",
  DISCONNECTING: "Disconnecting",
  REMOVE: "Remove",
  REMOVING: "Removing",
  ADD_TOKEN: "Add token",
  REPLACE_TOKEN: "Replace token",
  SIGN_IN: "Sign in with ChatGPT",
  WAITING: "Waiting for ChatGPT",
  CONNECTED: "Connected",
  USAGE_LIMIT: "Usage limit reached",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_SIGNED_OUT: "Sign-in expired. Sign in with ChatGPT to reconnect.",
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

/** What a harness's row says under its name, connected or needing a hand, or nothing while neither credential is set. */
function connectionOf(
  plan: SubscriptionKeySummary | undefined,
  key: ProviderKeySummary | undefined,
): { words: string; state: SettingsRowState } | undefined {
  const chosen = defaultOf(plan, key);
  if (chosen === CREDENTIAL.API_KEY && key !== undefined) {
    return keyStanding(key.status)
      ? { words: WORDS.VIA_API_KEY, state: SETTINGS_ROW_STATE.CONNECTED }
      : { words: WORDS.KEY_ATTENTION, state: SETTINGS_ROW_STATE.ATTENTION };
  }
  if (plan === undefined) return undefined;
  if (plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) {
    return { words: WORDS.USAGE_LIMIT, state: SETTINGS_ROW_STATE.ATTENTION };
  }
  if (standing(plan)) return { words: WORDS.VIA_SUBSCRIPTION, state: SETTINGS_ROW_STATE.CONNECTED };
  return { words: lapsedPlanWords(plan), state: SETTINGS_ROW_STATE.ATTENTION };
}

/**
 * What a harness's row says of a plan that no longer stands: a sign-in
 * expired only for a ChatGPT sign-in OpenAI ended, since a Claude token has
 * no sign-in, and that it needs attention otherwise, its card saying why.
 */
function lapsedPlanWords(plan: SubscriptionKeySummary): string {
  return plan.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
    plan.status === PROVIDER_KEY_STATUS.INVALID
    ? WORDS.SIGN_IN_EXPIRED
    : WORDS.PLAN_ATTENTION;
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
  useAnnounceShown(ANNOUNCE.ALERT, ok ? "" : children);
  return (
    <SettingsRowStateLine state={ok ? SETTINGS_ROW_STATE.CONNECTED : SETTINGS_ROW_STATE.ATTENTION}>
      {children}
    </SettingsRowStateLine>
  );
}

/** The green check beside a saved credential's label and a connected row's words. */
function Saved(): React.JSX.Element {
  return <SettingsSavedMark />;
}

/**
 * The foot of a pasted secret's form: Save alone while nothing is held to
 * go back to, else Cancel and Save as a dialog's foot draws them. Note that
 * Save stays the form's submit where it stands alone, because Enter in the
 * field presses it there; with Cancel beside it Enter still submits the
 * form's one field.
 */
function SecretFoot({
  cancel,
  saving,
  empty,
  running,
  onSave,
}: {
  /** Goes back to the held secret; undefined where none is held. */
  cancel: (() => void) | undefined;
  saving: boolean;
  empty: boolean;
  running: string;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <Inline justify={JUSTIFY.END}>
      {cancel === undefined ? (
        <Button
          type={BUTTON_TYPE.SUBMIT}
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={empty}
          busy={saving}
          busyLabel={running}
        >
          {WORDS.SAVE}
        </Button>
      ) : (
        <DialogActions
          onCancel={cancel}
          act={{
            verb: WORDS.SAVE,
            tone: DIALOG_TONE.PRIMARY,
            onPress: onSave,
            running,
            busy: saving,
            disabled: empty,
          }}
        />
      )}
    </Inline>
  );
}

/* ----- The subscription cards ----- */

/** Claude's plan: a pasted setup-token, its status, Replace token, and Disconnect. */
function ClaudeTokenPanel({
  plan,
  field,
  onAnswer,
}: {
  plan: SubscriptionKeySummary | undefined;
  /** The dialog's way to the field while it stands. */
  field: React.RefObject<HTMLInputElement | null>;
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
        <Inline justify={JUSTIFY.BETWEEN}>
          <SettingsFacts>
            <State ok={ok && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
              {tokenWords(plan)}
            </State>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
              {plan.hint}
            </Text>
          </SettingsFacts>
          {editing ? null : (
            <Inline wrap={false}>
              {ok ? null : (
                <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setEditing(true)}>
                  {WORDS.REPLACE_TOKEN}
                </Button>
              )}
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={removal.busy}
                busyLabel={WORDS.DISCONNECTING}
                onClick={removal.ask}
              >
                {WORDS.DISCONNECT}
              </Button>
            </Inline>
          )}
        </Inline>
      )}
      {editing ? (
        <Stack
          as={LAYOUT_ELEMENT.FORM}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <SecretField
            ref={field}
            label="Claude setup-token"
            error={rejection}
            saved={plan !== undefined}
            placeholder='Paste the token from "claude setup-token"'
            disabled={saving}
            value={pasted}
            onEscape={plan === undefined ? undefined : cancel}
            onChange={(value) => {
              setPasted(value);
              setRejection(undefined);
            }}
          />
          <SecretFoot
            cancel={plan === undefined ? undefined : cancel}
            saving={saving}
            empty={pasted.trim() === ""}
            running={WORDS.SAVING_TOKEN}
            onSave={save}
          />
        </Stack>
      ) : null}
      <FootQuestion
        confirm={removal}
        question={{
          title: "Disconnect your Claude plan?",
          body: "Claude agents will stop running on your Claude plan, and he deletes the token he holds.",
          verb: WORDS.DISCONNECT,
          running: WORDS.DISCONNECTING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}

/**
 * OpenAI's first-sign-in notice, in the ChatGPT card under the sign-in it
 * meets: what using the plan means, and Got it, which takes focus as the
 * notice lands, as the sign-in's own button has just gone.
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
      <Inline justify={JUSTIFY.BETWEEN}>
        <SettingsFacts>
          {plan === undefined ? null : (
            <State ok={connected && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED}>
              {signInWords(plan)}
            </State>
          )}
        </SettingsFacts>
        <Inline wrap={false}>
          {connected ? (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={removal.busy}
              busyLabel={WORDS.DISCONNECTING}
              onClick={removal.ask}
            >
              {WORDS.DISCONNECT}
            </Button>
          ) : continueOffered ? (
            <>
              {signingIn ? (
                <Button variant={BUTTON_VARIANT.QUIET} onClick={cancel}>
                  {WORDS.CANCEL}
                </Button>
              ) : null}
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                icon={
                  <ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ICON} />
                }
                busy={signingIn}
                busyLabel={WORDS.WAITING}
                onClick={signIn}
              >
                {WORDS.SIGN_IN}
              </Button>
            </>
          ) : null}
        </Inline>
      </Inline>
      {error === undefined ? null : <State ok={false}>{error}</State>}
      {unconfirmed ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {WORDS.REVOCATION_UNCONFIRMED}
        </Text>
      ) : null}
      {notice ? <FirstSignInNotice onDismiss={dismissNotice} /> : null}
      <FootQuestion
        confirm={removal}
        question={{
          title: "Disconnect your ChatGPT plan?",
          body: "Codex agents will stop running on your ChatGPT plan, and he ends his sign-in with OpenAI.",
          verb: WORDS.DISCONNECT,
          running: WORDS.DISCONNECTING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}

/* ----- The API key card ----- */

/** The provider's API key: a secret field while one is pasted, else its hint with the pencil and a ⋯ holding Remove. */
function ApiKeyPanel({
  provider,
  stored,
  field,
  onAnswer,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary | undefined;
  /** The dialog's way to the field while it stands. */
  field: React.RefObject<HTMLInputElement | null>;
  onAnswer: (answer: ProviderKeysAnswer) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const name = HARNESS[provider].keyName;
  const door = useRef<HTMLButtonElement | null>(null);
  const [editing, setEditing] = useState(false);
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
        setEditing(false);
      });
  };

  const status = stored === undefined ? undefined : keyStatusWords(provider, stored.status);
  return (
    <>
      {open ? (
        <Stack
          as={LAYOUT_ELEMENT.FORM}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <SecretField
            ref={field}
            label={`${name} API key`}
            error={rejection}
            saved={stored !== undefined}
            placeholder={`Paste your ${name} API key`}
            disabled={saving}
            value={pasted}
            onEscape={stored === undefined ? undefined : cancel}
            onChange={(value: string) => {
              setPasted(value);
              setRejection(undefined);
            }}
          />
          <SecretFoot
            cancel={stored === undefined ? undefined : cancel}
            saving={saving}
            empty={pasted.trim() === ""}
            running="Checking the key"
            onSave={save}
          />
        </Stack>
      ) : (
        <Inline justify={JUSTIFY.BETWEEN}>
          <Inline grow wrap={false} gap={GAP.TIGHT} growFirst>
            <TextField
              label={`${name} API key`}
              readOnly
              font={TEXT_FIELD_FONT.MONO}
              value={stored?.hint ?? ""}
              onChange={() => undefined}
            />
            <Tooltip label="Edit key">
              <IconButton
                icon={<PencilIcon />}
                label="Edit key"
                disabled={removal.busy}
                onClick={() => setEditing(true)}
              />
            </Tooltip>
            <MoreButton ref={door} thing={`${name} key`} {...menu.trigger()} />
          </Inline>
        </Inline>
      )}
      {status === undefined || stored === undefined ? null : (
        <State ok={keyStanding(stored.status)}>{status}</State>
      )}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(`${name} key`)}
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
      <FootQuestion
        confirm={removal}
        question={{
          title: `Remove your ${name} API key?`,
          body:
            provider === PROVIDER_KEY_PROVIDER.OPENAI
              ? `Agents on ${name} models won't start without a subscription. Calls and dictation will be off.`
              : `Agents on ${name} models won't start without a subscription.`,
          verb: "Remove key",
          running: WORDS.REMOVING,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}

/* ----- The dialog ----- */

/** A harness's dialog: a radio card per credential, the checked one its new agents' default. */
function AgentAuthDialog({
  open,
  provider,
  answer,
  onAnswer,
  onClose,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  onAnswer: (answer: ProviderKeysAnswer) => void;
  onClose: () => void;
  onExited: () => void;
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
  const tokenField = useRef<HTMLInputElement | null>(null);
  const keyField = useRef<HTMLInputElement | null>(null);
  // Note that the card opens on the first field it draws, the setup-token's above the API key's, and none where both are kept.
  const firstField = useMemo(
    () => ({
      get current() {
        return tokenField.current ?? keyField.current;
      },
    }),
    [],
  );
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
        <ClaudeTokenPanel plan={plan} field={tokenField} onAnswer={onAnswer} />
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
      below: <ApiKeyPanel provider={provider} stored={key} field={keyField} onAnswer={onAnswer} />,
    },
  ];

  return (
    <Dialog
      open={open}
      title={harness.name}
      size={DIALOG_SIZE.WIDE}
      initialFocus={firstField}
      onDismiss={onClose}
      onExited={onExited}
      actions={<DialogActions onDone={onClose} />}
    >
      <div className={NO_CAPTURE}>
        <Stack gap={GAP.CONTROL}>
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
        </Stack>
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
  // Note that the card is drawn for the provider it opened on until its fade has run, so it does not change under its own exit.
  const { held: drawn, onExited } = useHeldThroughExit(open);

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

  // The window hears every answer too, so Call and Dictate turn as an OpenAI key is saved or removed.
  const settleOpenAiKey = useSettleOpenAiKey();
  useEffect(() => {
    if (answer !== undefined) settleOpenAiKey(answer.keys);
  }, [answer, settleOpenAiKey]);

  return (
    <div className={NO_CAPTURE}>
      <SettingsSection>
        {!signedIn ? (
          <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
        ) : answer !== undefined ? (
          HARNESSES.map((provider) => {
            const harness = HARNESS[provider];
            const connection = connectionOf(planOf(answer, provider), keyOf(answer, provider));
            const verb = connection === undefined ? WORDS.CONNECT : WORDS.MANAGE;
            return (
              <div key={provider} {...searchAnchorProps(HARNESS[provider].anchor)}>
                <SettingsRow
                  leading={
                    <SettingsRowMark>
                      <HarnessMark provider={provider} />
                    </SettingsRowMark>
                  }
                  label={harness.name}
                  description={
                    connection === undefined ? (
                      harness.detail
                    ) : (
                      <>
                        {harness.detail}
                        <SettingsRowStateLine
                          state={connection.state}
                          block={harness.detail !== undefined}
                        >
                          {connection.words}
                        </SettingsRowStateLine>
                      </>
                    )
                  }
                >
                  {(control) => (
                    // Note that the act is described by its row's name, since both rows may say Manage.
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      aria-haspopup="dialog"
                      aria-describedby={control.labelId}
                      onClick={() => setOpen(provider)}
                    >
                      {verb}
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
          <SettingsRowsSkeleton
            label={readingWords("your keys")}
            rows={HARNESSES.map(keyRowSkeleton)}
          />
        )}
      </SettingsSection>
      {drawn === undefined || answer === undefined ? null : (
        <AgentAuthDialog
          open={open !== undefined}
          provider={drawn}
          answer={answer}
          onAnswer={setAnswer}
          onClose={() => setOpen(undefined)}
          onExited={onExited}
        />
      )}
    </div>
  );
}
