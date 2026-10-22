import { PROVIDER_KEY_PROVIDER, type ProviderKeySummary } from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAct } from "./act.js";
import { useOpenSettings } from "./open-settings.js";

/**
 * openai-key.tsx -- whether the signed-in account has an OpenAI API key saved, which its calls and dictation run on, as every surface offering them reads it.
 *
 * Calls and dictated clips run on the account's own OpenAI key and never on
 * Luke's, so with none saved the Call and Dictate buttons say where to add
 * one and open Settings › Agents rather than starting something the service
 * would refuse. The window reads the account's keys once it is signed in,
 * again whenever it is focused, which is how the developer comes back from
 * saving one elsewhere, and Settings hands over every answer its own key
 * reads and writes, so a key saved or removed there turns the buttons at
 * once.
 * Until a read has answered, and whenever one fails, nothing is known, and
 * nothing is turned away on a guess. Outside the window, as in a test of one
 * surface, nothing is known either.
 */

/** What the window knows of the account's OpenAI API key. */
const OPENAI_KEY = {
  /** Not read yet, read with no answer, or no account signed in: nothing is turned away. */
  UNKNOWN: "unknown",
  SAVED: "saved",
  MISSING: "missing",
} as const;

type OpenAiKey = (typeof OPENAI_KEY)[keyof typeof OPENAI_KEY];

interface OpenAiKeyStanding {
  readonly key: OpenAiKey;
  /** The account's API keys as an answer of the service's left them. */
  readonly settle: (keys: readonly ProviderKeySummary[]) => void;
}

const UNKNOWN_STANDING: OpenAiKeyStanding = {
  key: OPENAI_KEY.UNKNOWN,
  settle: () => undefined,
};

const OpenAiKeyContext = createContext<OpenAiKeyStanding>(UNKNOWN_STANDING);

/** Whether the keys hold an OpenAI API key, which is all the service asks before it opens a call or hears a clip. */
function keyOf(keys: readonly ProviderKeySummary[]): OpenAiKey {
  return keys.some((one) => one.provider === PROVIDER_KEY_PROVIDER.OPENAI)
    ? OPENAI_KEY.SAVED
    : OPENAI_KEY.MISSING;
}

/** Reads the signed-in account's keys and hands whether it has an OpenAI one to everything under it. */
export function OpenAiKeyProvider({
  account,
  children,
}: {
  /** Who is signed in, by the key the window holds the account under; nothing while no one is. */
  account: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { act } = useAct();
  const [key, setKey] = useState<OpenAiKey>(OPENAI_KEY.UNKNOWN);
  // Note that only the newest word is kept, a read or a settle alike, because
  // reads overlap, and one answered after a later word is from before it.
  const words = useRef(0);

  const read = useCallback(() => {
    words.current += 1;
    const sentAs = words.current;
    act(ACT_KIND.PROVIDER_KEYS_READ).then(
      (answer) => {
        if (sentAs !== words.current) return;
        setKey("failure" in answer ? OPENAI_KEY.UNKNOWN : keyOf(answer.keys));
      },
      () => {
        if (sentAs === words.current) setKey(OPENAI_KEY.UNKNOWN);
      },
    );
  }, [act]);

  // An account signed in is read at once, and nothing of an earlier account's stands meanwhile.
  useEffect(() => {
    words.current += 1;
    setKey(OPENAI_KEY.UNKNOWN);
    if (account !== undefined) read();
  }, [account, read]);

  // The focus is the developer back from wherever a key may have been saved or removed.
  useEffect(() => {
    if (account === undefined) return;
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [account, read]);

  const settle = useCallback((keys: readonly ProviderKeySummary[]) => {
    words.current += 1;
    setKey(keyOf(keys));
  }, []);

  const standing = useMemo(
    () => (account === undefined ? UNKNOWN_STANDING : { key, settle }),
    [account, key, settle],
  );
  return <OpenAiKeyContext.Provider value={standing}>{children}</OpenAiKeyContext.Provider>;
}

/** Whether the account is known to have no OpenAI API key; false while nothing is known. */
export function useOpenAiKeyMissing(): boolean {
  return useContext(OpenAiKeyContext).key === OPENAI_KEY.MISSING;
}

/** How Settings hands the window the account's keys as each of its answers leaves them. */
export function useSettleOpenAiKey(): OpenAiKeyStanding["settle"] {
  return useContext(OpenAiKeyContext).settle;
}

/** Opens Settings › Agents, where the account's API keys are saved. */
export function useOpenApiKeys(): () => void {
  const openSettings = useOpenSettings();
  return useCallback(() => openSettings({ page: SETTINGS_VIEW.CODING_AGENTS }), [openSettings]);
}
