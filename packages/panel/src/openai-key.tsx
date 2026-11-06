import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@repo/features/provider-key-wire";
import { agentKeyLink } from "@repo/settings/settings-views";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { providerKeysQuery } from "./live-reads.js";
import { useOpenSettings } from "./open-settings.js";

/**
 * openai-key.tsx -- whether the signed-in account has an OpenAI API key saved, which its calls and dictation run on, as every surface offering them reads it.
 *
 * Calls and dictated clips run on the account's own OpenAI key and never on
 * ours, so with none saved the Call and Dictate buttons say where to add
 * one and open Codex's row in Settings › Agents rather than starting
 * something the service would refuse. The window holds the account's keys
 * (`LIVE_READ.PROVIDER_KEYS`) while it is signed in, which the host asks
 * again whenever a window comes forward, which is how the developer comes
 * back from saving one elsewhere, and lays from each save's and remove's own
 * answer, so a key saved or removed in Settings turns the buttons at once.
 * Until a read has answered, and where none ever has, nothing is known, and
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

const OpenAiKeyContext = createContext<OpenAiKey>(OPENAI_KEY.UNKNOWN);

/**
 * Whether the keys hold an OpenAI API key the service can open, which is all
 * it asks before it opens a call or hears a clip: one it can no longer
 * decrypt is refused as none, while one OpenAI refused is still tried.
 */
function keyOf(keys: readonly ProviderKeySummary[]): OpenAiKey {
  const key = keys.find((one) => one.provider === PROVIDER_KEY_PROVIDER.OPENAI);
  return key === undefined || key.status === PROVIDER_KEY_STATUS.UNREADABLE
    ? OPENAI_KEY.MISSING
    : OPENAI_KEY.SAVED;
}

/** Holds the signed-in account's keys and hands whether it has an OpenAI one to everything under it. */
export function OpenAiKeyProvider({
  account,
  children,
}: {
  /** Who is signed in, by the id the host holds the account's keys under; nothing while no one is. */
  account: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { data: rows } = useQuery(providerKeysQuery(account));
  const key = useMemo(() => (rows === undefined ? OPENAI_KEY.UNKNOWN : keyOf(rows.keys)), [rows]);
  return <OpenAiKeyContext.Provider value={key}>{children}</OpenAiKeyContext.Provider>;
}

/** Whether the account is known to have no OpenAI API key; false while nothing is known. */
export function useOpenAiKeyMissing(): boolean {
  return useContext(OpenAiKeyContext) === OPENAI_KEY.MISSING;
}

/** Opens Settings › Agents at Codex's row, where the account's OpenAI key is saved. */
export function useOpenApiKeys(): () => void {
  const openSettings = useOpenSettings();
  return useCallback(
    () => openSettings(agentKeyLink(PROVIDER_KEY_PROVIDER.OPENAI)),
    [openSettings],
  );
}
