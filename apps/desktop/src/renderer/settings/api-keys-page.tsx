import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeyStatus,
  type ProviderKeySummary,
} from "@sidecar/hosted/provider-key-wire";
import { CheckIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { HarnessMark } from "../provider-marks";
import { RetryButton } from "../retry-button";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { BusyLabel, SpinnerRegion } from "../spinner";
import { useConfirm } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";

/**
 * api-keys-page.tsx -- Settings › API keys: the account's own Anthropic and OpenAI keys a coding agent runs on.
 *
 * One row per provider. A provider with no key of the account's draws a
 * password field and Save; one with a key draws its hint — its prefix and
 * last four characters, as the service answers it — when it was added, and
 * how the provider last answered it, with Replace and Remove beside. The
 * service never answers a key, so the page never holds one but the one
 * being pasted: it stands in the field alone, is read from it once on Save,
 * and is cleared from it as soon as the service keeps it. A save the
 * service refuses says why under the row and leaves the field as pasted.
 * One change runs at a time across the rows, since every answer is the
 * account's keys whole and two in flight could land out of order.
 * Remove asks first, in place. The whole page is kept out of the screen
 * recording, which masks a field's characters but not their count.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: "Your keys could not be read.",
  SIGNED_OUT: "Sign in to add your own API keys.",
  NOTE: "A coding agent on a provider's model runs on your own key for that provider when you add one, and usage on it is billed to you by that provider. Without one, it runs on Luke's.",
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

const ADDED_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** What a key's status says on its row, by the provider it names. */
function keyStatusWords(provider: ProviderKeyProvider, status: ProviderKeyStatus): string {
  const name = PROVIDER_NAME[provider];
  switch (status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
      return "Verified";
    case PROVIDER_KEY_STATUS.INVALID:
      return `${name} rejected this key. Replace it.`;
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return `Out of quota or credit at ${name}.`;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return "This key can no longer be read. Replace it.";
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
  const [replacing, setReplacing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const removal = useConfirm({ subject: stored !== undefined, surfaceOpen: true }, () =>
    onRemove(provider),
  );
  const editing = stored === undefined || replacing;

  // Replace opens the field with the focus in it, ready for the paste.
  useEffect(() => {
    if (replacing) field.current?.focus();
  }, [replacing]);

  const save = () => {
    const key = field.current?.value.trim() ?? "";
    if (key === "" || saving || locked) return;
    setSaving(true);
    setRejection(undefined);
    void onSave(provider, key).then((refused) => {
      setSaving(false);
      setRejection(refused);
      if (refused !== undefined) return;
      // Kept: the key leaves the field, and the row draws the service's word for it.
      if (field.current !== null) field.current.value = "";
      setReplacing(false);
    });
  };

  return (
    <div
      className="settings-row settings-row-wrapping api-key-row"
      {...searchAnchorProps(PROVIDER_ANCHOR[provider])}
    >
      <span className="settings-copy">
        <span className="settings-name">
          <HarnessMark provider={provider} />
          <strong>{name}</strong>
          {stored?.status === PROVIDER_KEY_STATUS.VERIFIED && !editing ? <CheckIcon /> : null}
        </span>
        {stored !== undefined && !editing ? (
          <small>
            <code className="api-key-hint">{stored.hint}</code>
            {` · Added ${ADDED_FORMAT.format(stored.addedAt)} · `}
            <span
              className={
                stored.status === PROVIDER_KEY_STATUS.VERIFIED ? undefined : "api-key-trouble"
              }
              role={stored.status === PROVIDER_KEY_STATUS.VERIFIED ? undefined : "alert"}
            >
              {keyStatusWords(provider, stored.status)}
            </span>
          </small>
        ) : (
          <small>{`Usage on your key is billed by ${name}.`}</small>
        )}
      </span>
      {editing ? (
        <form
          className="settings-actions api-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            ref={field}
            type="password"
            className={`settings-input ${NO_CAPTURE}`}
            aria-label={`${name} API key`}
            placeholder={`Paste your ${name} API key`}
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
            onChange={() => setRejection(undefined)}
          />
          <button type="submit" className="toolbar-button" disabled={saving || locked}>
            <BusyLabel busy={saving} label="Checking the key">
              Save
            </BusyLabel>
          </button>
          {replacing ? (
            <button
              type="button"
              className="toolbar-button"
              disabled={saving}
              onClick={() => {
                if (field.current !== null) field.current.value = "";
                setRejection(undefined);
                setReplacing(false);
              }}
            >
              Cancel
            </button>
          ) : null}
        </form>
      ) : (
        <ConfirmSwap
          confirm={{
            question: `Remove your ${name} API key? Agents on ${name} models will run on Luke's key.`,
            stage: removal.stage,
            verb: "Remove",
            running: "Removing",
            onKeep: removal.keep,
            onAct: removal.run,
          }}
        >
          <button
            type="button"
            className="toolbar-button"
            disabled={removal.busy || locked}
            onClick={() => setReplacing(true)}
          >
            Replace
          </button>
          <button
            type="button"
            className="toolbar-button account-delete"
            disabled={removal.busy || locked}
            /* The ellipsis is the promise that it asks first. */
            title="Remove…"
            onClick={removal.ask}
          >
            Remove
          </button>
        </ConfirmSwap>
      )}
      {rejection !== undefined || removal.rejection !== undefined ? (
        <p className="error-message api-key-error" role="alert">
          {rejection ?? removal.rejection}
        </p>
      ) : null}
    </div>
  );
}

export function ApiKeysSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
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
    <section className={`settings-section settings-plain ${NO_CAPTURE}`}>
      {!signedIn ? (
        <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>
      ) : keys !== undefined ? (
        <>
          <p className="settings-note">{PAGE_LINE.NOTE}</p>
          {PROVIDERS.map((provider) => (
            <ProviderKeyRow
              key={provider}
              provider={provider}
              stored={keys.find((each) => each.provider === provider)}
              locked={changing !== undefined && changing !== provider}
              onSave={save}
              onRemove={remove}
            />
          ))}
        </>
      ) : readFailed ? (
        <>
          <p className="error-message" role="alert">
            {PAGE_LINE.FAILED}
          </p>
          <RetryButton onRetry={() => setAttempt((count) => count + 1)} />
        </>
      ) : (
        <SpinnerRegion label="Loading your keys" />
      )}
    </section>
  );
}
