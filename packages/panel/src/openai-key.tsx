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

const OPENAI_KEY = {
  UNKNOWN: "unknown",
  SAVED: "saved",
  MISSING: "missing",
} as const;

type OpenAiKey = (typeof OPENAI_KEY)[keyof typeof OPENAI_KEY];

const OpenAiKeyContext = createContext<OpenAiKey>(OPENAI_KEY.UNKNOWN);

function keyOf(keys: readonly ProviderKeySummary[]): OpenAiKey {
  const key = keys.find((one) => one.provider === PROVIDER_KEY_PROVIDER.OPENAI);
  return key === undefined || key.status === PROVIDER_KEY_STATUS.UNREADABLE
    ? OPENAI_KEY.MISSING
    : OPENAI_KEY.SAVED;
}

export function OpenAiKeyProvider({
  account,
  children,
}: {
  account: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const { data: rows } = useQuery(providerKeysQuery(account));
  const key = useMemo(() => (rows === undefined ? OPENAI_KEY.UNKNOWN : keyOf(rows.keys)), [rows]);
  return <OpenAiKeyContext.Provider value={key}>{children}</OpenAiKeyContext.Provider>;
}

export function useOpenAiKeyMissing(): boolean {
  return useContext(OpenAiKeyContext) === OPENAI_KEY.MISSING;
}

export function useOpenApiKeys(): () => void {
  const openSettings = useOpenSettings();
  return useCallback(
    () => openSettings(agentKeyLink(PROVIDER_KEY_PROVIDER.OPENAI)),
    [openSettings],
  );
}
