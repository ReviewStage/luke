import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeyStatus,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  ErrorState,
  PencilIcon,
  SettingsLine,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_TYPE,
  TextField,
  TrashIcon,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessMark } from "../harness-marks";
import { dayText } from "../tasks/task-time";
import { MenuRow } from "./menu-row";

/**
 * api-keys-section.tsx -- Settings › Coding agents › API keys: the account's own Anthropic and OpenAI keys a coding agent runs on.
 *
 * A group of the Coding agents page, under the default model it runs. One
 * row per provider. A provider with no key of the account's offers Add key;
 * one with a key draws how the provider last answered it, its hint — its
 * prefix and last four characters, as the service answers it — and when it
 * was added, with Edit key and Remove key behind the row's ⋯ and a
 * right-click. Adding or editing grows the row a password field, Cancel,
 * and Save. The service never answers a key, so the page never holds one
 * but the one being pasted: it stands in the open field alone, is sent once
 * on Save, and is cleared as soon as the service keeps it, or the field is
 * cancelled. A save the service refuses says why under the field and leaves
 * it as pasted. One change runs at a time across the rows, since every answer is
 * the account's keys whole and two in flight could land out of order.
 * Remove asks first, in the confirm dialog. The whole group is kept out of
 * the screen recording, which masks a field's characters but not their
 * count.
 *
 * The group is `@luke/ui`'s `SettingsSection`, each provider a `SettingsRow`
 * led by its mark (through `MenuRow`), the field its `TextField`, and the
 * presses its `Button`s.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: "Your keys could not be read.",
  SIGNED_OUT: "Sign in to add your own API keys.",
  SAVE_FAILED: "The key could not be saved. Try again.",
  REMOVE_FAILED: "The key could not be removed. Try again.",
} as const;

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

const PROVIDER_NAME = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: "Anthropic",
  [PROVIDER_KEY_PROVIDER.OPENAI]: "OpenAI",
} as const satisfies Record<ProviderKeyProvider, string>;

const PROVIDER_ANCHOR = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: SETTINGS_SEARCH_ROW.API_KEY_ANTHROPIC,
  [PROVIDER_KEY_PROVIDER.OPENAI]: SETTINGS_SEARCH_ROW.API_KEY_OPENAI,
} as const satisfies Record<ProviderKeyProvider, string>;

const PROVIDERS: readonly ProviderKeyProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

/** What a key's status says on its row, by the provider it names. */
function keyStatusWords(provider: ProviderKeyProvider, status: ProviderKeyStatus): string {
  const name = PROVIDER_NAME[provider];
  switch (status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
      return "Verified";
    case PROVIDER_KEY_STATUS.INVALID:
      return `${name} rejected this key.`;
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return `Out of quota or credit at ${name}.`;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return "This key can no longer be read.";
  }
}

/** Why a save kept nothing, in words the developer can act on. */
function rejectionWords(provider: ProviderKeyProvider, rejection: ProviderKeyRejection): string {
  const name = PROVIDER_NAME[provider];
  switch (rejection) {
    case PROVIDER_KEY_REJECTION.INVALID:
      return `${name} didn't accept this key. Check it and try again.`;
    case PROVIDER_KEY_REJECTION.WRONG_PROVIDER: {
      const other =
        provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
          ? PROVIDER_KEY_PROVIDER.OPENAI
          : PROVIDER_KEY_PROVIDER.ANTHROPIC;
      return `This looks like an ${PROVIDER_NAME[other]} key. Paste it into the ${PROVIDER_NAME[other]} row.`;
    }
    case PROVIDER_KEY_REJECTION.UNREACHABLE:
      return `Couldn't reach ${name} to check this key. Try again.`;
    case PROVIDER_KEY_REJECTION.TOO_MANY_TRIES:
      return "Too many keys tried in the last hour. Try again later.";
  }
}

/** One provider's row: its key as the service describes it, or the field a key is pasted into. */
function ProviderKeyRow({
  provider,
  stored,
  locked,
  onSave,
  onRemove,
}: {
  provider: ProviderKeyProvider;
  stored: ProviderKeySummary | undefined;
  /** Whether another row's change is in flight, which this row waits out. */
  locked: boolean;
  /** Saves the key, answering why nothing was kept where it was not. */
  onSave: (provider: ProviderKeyProvider, key: string) => Promise<string | undefined>;
  onRemove: (provider: ProviderKeyProvider) => Promise<ActionResult>;
}): React.JSX.Element {
  const name = PROVIDER_NAME[provider];
  const field = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const removal = useConfirmDialog({ subject: stored !== undefined, surfaceOpen: true }, () =>
    onRemove(provider),
  );

  // Add and Edit open the field with the focus in it, ready for the paste.
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const save = () => {
    const key = pasted.trim();
    if (key === "" || saving || locked) return;
    setSaving(true);
    setRejection(undefined);
    void onSave(provider, key).then((refused) => {
      setSaving(false);
      setRejection(refused);
      if (refused !== undefined) return;
      // Kept: the key leaves the field, and the row draws the service's word for it.
      setPasted("");
      setEditing(false);
    });
  };
  const cancel = () => {
    setPasted("");
    setRejection(undefined);
    setEditing(false);
  };

  const actions =
    stored === undefined || editing
      ? []
      : [
          {
            label: "Edit key",
            icon: <PencilIcon />,
            disabled: removal.busy || locked,
            onSelect: () => setEditing(true),
          },
          {
            label: "Remove key",
            icon: <TrashIcon />,
            danger: true,
            disabled: removal.busy || locked,
            onSelect: removal.ask,
          },
        ];
  const verified = stored?.status === PROVIDER_KEY_STATUS.VERIFIED;

  // Note that the row grows its field under its line and says its refusal
  // under both, so the card's rule runs above the row and not between its parts.
  return (
    <div className="api-key">
      <MenuRow
        label={`${name} key actions`}
        actions={actions}
        anchor={PROVIDER_ANCHOR[provider]}
        row={{
          leading: (
            <span className="settings-row-mark">
              <HarnessMark provider={provider} />
            </span>
          ),
          label: name,
          description:
            stored === undefined ? undefined : (
              <>
                <span
                  className="settings-state"
                  data-state={verified ? "connected" : "attention"}
                  role={verified ? undefined : "alert"}
                >
                  {keyStatusWords(provider, stored.status)}
                </span>
                {" · "}
                <code className="api-key-hint">{stored.hint}</code>
                {` · Added ${dayText(stored.addedAt)}`}
              </>
            ),
          error: rejection,
          below: editing ? (
            <form
              className="api-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
              // Escape in the field closes the editor and nothing behind it: the
              // window's own Escape would leave Settings. A composition's Escape is the IME's.
              onKeyDown={(event) => {
                if (event.target !== field.current) return;
                if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }}
            >
              <TextField
                ref={field}
                type={TEXT_FIELD_TYPE.PASSWORD}
                autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
                label={`${name} API key`}
                placeholder={`Paste your ${name} API key`}
                spellCheck={false}
                disabled={saving}
                value={pasted}
                onChange={(value) => {
                  setPasted(value);
                  setRejection(undefined);
                }}
              />
              <Button variant={BUTTON_VARIANT.OUTLINE} disabled={saving} onClick={cancel}>
                Cancel
              </Button>
              <Button
                type={BUTTON_TYPE.SUBMIT}
                variant={BUTTON_VARIANT.PRIMARY}
                disabled={locked}
                busy={saving}
                busyLabel="Checking the key"
              >
                Save
              </Button>
            </form>
          ) : null,
          control:
            stored === undefined && !editing ? (
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                disabled={locked}
                onClick={() => setEditing(true)}
              >
                Add key
              </Button>
            ) : undefined,
        }}
      />
      <ConfirmDialog
        confirm={removal}
        question={{
          title: `Remove your ${name} API key?`,
          body: `Agents on ${name} models will run on Luke's key.`,
          verb: "Remove key",
          running: "Removing…",
        }}
      />
    </div>
  );
}

/** The API keys group: what an own key does, and a row per provider, or why they cannot be drawn. */
export function ApiKeysSection({
  signedIn,
  onKeys,
}: {
  signedIn: boolean;
  /** The keys as last read or changed, none where they could not be read; not called while the read is out. */
  onKeys: (keys: readonly ProviderKeySummary[]) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [keys, setKeys] = useState<readonly ProviderKeySummary[] | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [changing, setChanging] = useState<ProviderKeyProvider | undefined>(undefined);

  // The page opening reads the keys as the service holds them now, which a step may just have marked.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Nothing of an earlier read, or an earlier account, stands while this one is out.
    setKeys(undefined);
    setReadFailed(false);
    act(ACT_KIND.PROVIDER_KEYS_READ).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setReadFailed(true);
        else setKeys(answer.keys);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt]);

  // The page beside the group hears every answer, so nothing there says what a key used to be.
  useEffect(() => {
    if (keys !== undefined || readFailed) onKeys(keys ?? []);
  }, [keys, readFailed, onKeys]);

  const save = useCallback(
    (provider: ProviderKeyProvider, key: string): Promise<string | undefined> => {
      setChanging(provider);
      return act(ACT_KIND.PROVIDER_KEYS_SAVE, { provider, key })
        .catch(() => undefined)
        .then((answer) => {
          setChanging(undefined);
          if (answer === undefined || "failure" in answer) return PAGE_LINE.SAVE_FAILED;
          setKeys(answer.keys);
          return answer.rejected === undefined
            ? undefined
            : rejectionWords(provider, answer.rejected);
        });
    },
    [act],
  );

  const remove = useCallback(
    (provider: ProviderKeyProvider): Promise<ActionResult> => {
      setChanging(provider);
      return act(ACT_KIND.PROVIDER_KEYS_REMOVE, { provider })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          setChanging(undefined);
          if (answer === undefined || "failure" in answer) {
            return { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.REMOVE_FAILED };
          }
          setKeys(answer.keys);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        });
    },
    [act],
  );

  return (
    <div className={NO_CAPTURE}>
      <SettingsSection title="API keys">
        {!signedIn ? (
          <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>
        ) : keys !== undefined ? (
          PROVIDERS.map((provider) => (
            <ProviderKeyRow
              key={provider}
              provider={provider}
              stored={keys.find((each) => each.provider === provider)}
              locked={changing !== undefined && changing !== provider}
              onSave={save}
              onRemove={remove}
            />
          ))
        ) : readFailed ? (
          <SettingsLine>
            <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
              {PAGE_LINE.FAILED}
            </ErrorState>
          </SettingsLine>
        ) : (
          <SettingsRowsSkeleton label="Loading your keys" rows={PROVIDERS.length} marked />
        )}
      </SettingsSection>
    </div>
  );
}
