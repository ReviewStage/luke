import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyRejection,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  ErrorState,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_TYPE,
  TextField,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { HarnessMark } from "../harness-marks.js";
import { dayText } from "../tasks/task-time.js";

/**
 * claude-plan-section.tsx -- Settings › Coding agents › Claude Code: the account's Claude plan, connected by pasting a `claude setup-token` and disconnected.
 *
 * A group of the Coding agents page, drawn only for an account in the
 * native-agents cohort; the page decides that. One row: the plan,
 * how to get its token, and Add token, which grows the row a password field,
 * Cancel, and Save, as an API key's row does. Save sends the token once,
 * with its kind, and clears the field as soon as the service keeps it; a
 * refusal says why under the field and leaves it as pasted. Connected, the
 * row draws the service's status and hint of the token and offers
 * Disconnect, asked first. The service never answers a token, so nothing
 * here holds one but the one being pasted. The whole group is kept out of
 * the screen recording, which masks a field's characters but not their
 * count.
 */

const WORDS = {
  TITLE: "Claude Code",
  LABEL: "Claude plan",
  CONNECTED: "Connected",
  INVALID: "Anthropic rejected this token. Paste a new one.",
  QUOTA_EXCEEDED: "Out of usage on your Claude plan.",
  UNREADABLE: "This token can no longer be read. Paste a new one.",
  ADD: "Add token",
  REPLACE: "Replace token",
  FIELD: "Claude setup-token",
  PLACEHOLDER: "Paste your Claude setup-token",
  CANCEL: "Cancel",
  SAVE: "Save",
  SAVING: "Saving the token",
  DISCONNECT: "Disconnect",
  SIGNED_OUT: "Sign in to use your Claude plan.",
  READ_FAILED: "Your Claude plan could not be read.",
  SAVE_FAILED: "The token could not be saved. Try again.",
  DISCONNECT_FAILED: "Your Claude plan could not be disconnected. Try again.",
} as const;

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** The account's setup-token among its subscriptions, or none. */
function setupTokenOf(answer: ProviderKeysAnswer): SubscriptionKeySummary | undefined {
  return answer.subscriptions?.find((one) => one.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
}

/** Whether a stored token still stands for the plan: kept, or answered by Anthropic. */
function standing(stored: SubscriptionKeySummary): boolean {
  return (
    stored.status === PROVIDER_KEY_STATUS.UNVERIFIED ||
    stored.status === PROVIDER_KEY_STATUS.VERIFIED
  );
}

/** What a token Anthropic no longer takes says on its row. */
function attentionWords(stored: SubscriptionKeySummary): string {
  switch (stored.status) {
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return WORDS.QUOTA_EXCEEDED;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.UNREADABLE;
    default:
      return WORDS.INVALID;
  }
}

/** What the row says under its label, by where the token stands. */
function rowDescription(stored: SubscriptionKeySummary | undefined): React.ReactNode {
  if (stored === undefined) {
    return (
      <>
        {"Run "}
        <code className="api-key-hint">claude setup-token</code>
        {" in a terminal, then paste the token it prints."}
      </>
    );
  }
  const ok = standing(stored);
  return (
    <>
      <span
        className="settings-state"
        data-state={ok ? "connected" : "attention"}
        role={ok ? undefined : "alert"}
      >
        {ok ? WORDS.CONNECTED : attentionWords(stored)}
      </span>
      {" · "}
      <code className="api-key-hint">{stored.hint}</code>
      {` · Added ${dayText(stored.addedAt)}`}
    </>
  );
}

/** Why a save kept nothing, in words the developer can act on. */
function rejectionWords(rejection: ProviderKeyRejection): string {
  return rejection === PROVIDER_KEY_REJECTION.TOO_MANY_TRIES
    ? "Too many keys tried in the last hour. Try again later."
    : "That isn't a Claude setup-token. Run claude setup-token and paste what it prints.";
}

/** The Claude Code group: the subscription's row, or why it cannot be drawn. */
export function ClaudePlanSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const field = useRef<HTMLInputElement | null>(null);
  const [answer, setAnswer] = useState<ProviderKeysAnswer | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const stored = answer === undefined ? undefined : setupTokenOf(answer);

  // The page opening reads the token as the service holds it now, which a step may just have marked.
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

  // Add token opens the field with the focus in it, ready for the paste.
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
    void act(ACT_KIND.PROVIDER_KEYS_SAVE, {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key,
    })
      .catch(() => undefined)
      .then((saved) => {
        setSaving(false);
        if (saved === undefined || "failure" in saved) {
          setRejection(WORDS.SAVE_FAILED);
          return;
        }
        setAnswer(saved);
        if (saved.rejected !== undefined) {
          setRejection(rejectionWords(saved.rejected));
          return;
        }
        // Kept: the token leaves the field, and the row draws the service's word for it.
        setPasted("");
        setEditing(false);
      });
  };

  const disconnect = useCallback(
    (): Promise<ActionResult> =>
      act(ACT_KIND.PROVIDER_KEYS_REMOVE, {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      })
        .catch(() => undefined)
        .then((removed): ActionResult => {
          if (removed === undefined || "failure" in removed) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: WORDS.DISCONNECT_FAILED };
          }
          setAnswer(removed);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        }),
    [act],
  );
  const removal = useConfirmDialog(
    { subject: stored !== undefined, surfaceOpen: true },
    disconnect,
  );

  const pasteOffered = !editing && (stored === undefined || !standing(stored));
  return (
    <div className={NO_CAPTURE}>
      <SettingsSection title={WORDS.TITLE}>
        {!signedIn ? (
          <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
        ) : answer !== undefined ? (
          <div className="api-key">
            <SettingsRow
              leading={
                <span className="settings-row-mark">
                  <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />
                </span>
              }
              label={WORDS.LABEL}
              description={rowDescription(stored)}
              error={rejection}
              below={
                editing
                  ? () => (
                      <form
                        className="api-key-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          save();
                        }}
                        // Escape in the field closes the editor and nothing behind it: the
                        // window's own Escape would leave Settings. A composition's Escape is the IME's,
                        // which Safari reports with `isComposing` already false and code 229 still.
                        onKeyDown={(event) => {
                          if (event.target !== field.current) return;
                          if (event.key !== "Escape") return;
                          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                          event.preventDefault();
                          event.stopPropagation();
                          cancel();
                        }}
                      >
                        <TextField
                          ref={field}
                          type={TEXT_FIELD_TYPE.PASSWORD}
                          autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
                          label={WORDS.FIELD}
                          placeholder={WORDS.PLACEHOLDER}
                          spellCheck={false}
                          disabled={saving}
                          value={pasted}
                          onChange={(value) => {
                            setPasted(value);
                            setRejection(undefined);
                          }}
                        />
                        <Button variant={BUTTON_VARIANT.OUTLINE} disabled={saving} onClick={cancel}>
                          {WORDS.CANCEL}
                        </Button>
                        <Button
                          type={BUTTON_TYPE.SUBMIT}
                          variant={BUTTON_VARIANT.PRIMARY}
                          busy={saving}
                          busyLabel={WORDS.SAVING}
                        >
                          {WORDS.SAVE}
                        </Button>
                      </form>
                    )
                  : undefined
              }
            >
              {() => (
                <>
                  {stored !== undefined && !editing ? (
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      disabled={removal.busy}
                      onClick={removal.ask}
                    >
                      {WORDS.DISCONNECT}
                    </Button>
                  ) : null}
                  {pasteOffered ? (
                    <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setEditing(true)}>
                      {stored === undefined ? WORDS.ADD : WORDS.REPLACE}
                    </Button>
                  ) : null}
                </>
              )}
            </SettingsRow>
          </div>
        ) : readFailed ? (
          <SettingsLine>
            <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
              {WORDS.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label="Loading your Claude plan" rows={1} marked />
        )}
      </SettingsSection>
      <ConfirmDialog
        confirm={removal}
        question={{
          title: "Disconnect your Claude plan?",
          body: "Claude Code agents will stop running on your Claude plan, and Luke deletes the token it holds.",
          verb: WORDS.DISCONNECT,
          running: "Disconnecting…",
        }}
      />
    </div>
  );
}
