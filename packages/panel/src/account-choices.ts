import { signedInAccountId } from "@repo/credentials/snapshot";
import { agentDefaultOf } from "@repo/features/account-preferences-live";
import type { ModelChoice } from "@repo/features/models-wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  accountPreferencesQuery,
  accountPreferencesRetryMutation,
  modelsQuery,
  modelsRetryMutation,
} from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

export interface DrawnAgentDefault {
  readonly choice: ModelChoice | undefined;
  readonly failed: boolean;
  readonly retry: () => Promise<void>;
}

function useAccountKey(): string | undefined {
  return signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
}

export function useAccountPreferences() {
  return useQuery(accountPreferencesQuery(useAccountKey()));
}

export function useOfferedModels(drawing = true) {
  const accountId = useAccountKey();
  return useQuery(modelsQuery(drawing ? accountId : undefined));
}

export function useAgentDefault(): DrawnAgentDefault {
  const preferences = useAccountPreferences();
  const models = useOfferedModels();
  const { mutateAsync: retryPreferences } = useMutation(accountPreferencesRetryMutation());
  const { mutateAsync: retryModels } = useMutation(modelsRetryMutation());
  const read = models.isError
    ? { failed: true as const }
    : models.data === undefined
      ? {}
      : { rows: models.data };
  const choice =
    preferences.data === undefined ? undefined : agentDefaultOf(preferences.data.agent, read);
  const retry = useCallback(
    () => Promise.allSettled([retryPreferences(), retryModels()]).then(() => undefined),
    [retryPreferences, retryModels],
  );
  return { choice, failed: preferences.isError, retry };
}
