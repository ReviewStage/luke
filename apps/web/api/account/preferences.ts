import type { AccountPreferences } from "@sidecar/settings";
import { accountPreferencesFromStored } from "@sidecar/settings";
import { eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { accountPreference, accountWorkspacePreference } from "../../server/db/schema.js";
import {
  type AccountPreferencesReadOptions,
  type AccountPreferencesWriteOptions,
  handleAccountPreferencesRead,
  handleAccountPreferencesWrite,
} from "../../server/hosted/account-preferences.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

function rowPreferences(
  preference: {
    voice: string | null;
    voiceSpeed: number | null;
    defaultWorkspaceProvider: string | null;
  },
  workspacePreferences: readonly {
    providerId: string;
    defaultProjectId: string | null;
    agent: string | null;
    model: string | null;
    effort: string | null;
  }[],
): AccountPreferences {
  const workspaceProjectDefaults: Record<string, string> = {};
  const workspaceAgentDefaults: Record<string, { agent: string; model?: string; effort?: string }> =
    {};

  for (const row of workspacePreferences) {
    if (row.defaultProjectId) {
      workspaceProjectDefaults[row.providerId] = row.defaultProjectId;
    }
    if (row.agent) {
      workspaceAgentDefaults[row.providerId] = {
        agent: row.agent,
        ...(row.model ? { model: row.model } : undefined),
        ...(row.effort ? { effort: row.effort } : undefined),
      };
    }
  }

  return (
    accountPreferencesFromStored({
      ...(preference.voice ? { voice: preference.voice } : undefined),
      ...(preference.voiceSpeed !== null ? { voiceSpeed: preference.voiceSpeed } : undefined),
      ...(preference.defaultWorkspaceProvider
        ? { defaultWorkspaceProvider: preference.defaultWorkspaceProvider }
        : undefined),
      ...(Object.keys(workspaceProjectDefaults).length > 0
        ? { workspaceProjectDefaults }
        : undefined),
      ...(Object.keys(workspaceAgentDefaults).length > 0 ? { workspaceAgentDefaults } : undefined),
    }) ?? {}
  );
}

function workspacePreferenceRows(userId: string, preferences: AccountPreferences, updatedAt: Date) {
  const projects = preferences.workspaceProjectDefaults ?? {};
  const agents = preferences.workspaceAgentDefaults ?? {};
  const rows = new Map<
    string,
    {
      userId: string;
      providerId: string;
      defaultProjectId: string | null;
      agent: string | null;
      model: string | null;
      effort: string | null;
      updatedAt: Date;
    }
  >();
  const rowFor = (providerId: string) => {
    const existing = rows.get(providerId);
    if (existing) return existing;
    const row = {
      userId,
      providerId,
      defaultProjectId: null,
      agent: null,
      model: null,
      effort: null,
      updatedAt,
    };
    rows.set(providerId, row);
    return row;
  };

  for (const [providerId, defaultProjectId] of Object.entries(projects)) {
    if (defaultProjectId) rowFor(providerId).defaultProjectId = defaultProjectId;
  }
  for (const [providerId, agent] of Object.entries(agents)) {
    if (!agent) continue;
    const row = rowFor(providerId);
    row.agent = agent.agent;
    row.model = agent.model ?? null;
    row.effort = agent.effort ?? null;
  }

  return [...rows.values()];
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const options: AccountPreferencesReadOptions = {
        request,
        resolveUserId,
        readPreferences: async (userId) => {
          const database = getDatabase();
          return database.transaction(async (transaction) => {
            const [preference] = await transaction
              .select({
                voice: accountPreference.voice,
                voiceSpeed: accountPreference.voiceSpeed,
                defaultWorkspaceProvider: accountPreference.defaultWorkspaceProvider,
                updatedAt: accountPreference.updatedAt,
              })
              .from(accountPreference)
              .where(eq(accountPreference.userId, userId))
              .limit(1);
            if (!preference) return undefined;

            const workspacePreferences = await transaction
              .select({
                providerId: accountWorkspacePreference.providerId,
                defaultProjectId: accountWorkspacePreference.defaultProjectId,
                agent: accountWorkspacePreference.agent,
                model: accountWorkspacePreference.model,
                effort: accountWorkspacePreference.effort,
              })
              .from(accountWorkspacePreference)
              .where(eq(accountWorkspacePreference.userId, userId));

            return {
              preferences: rowPreferences(preference, workspacePreferences),
              updatedAt: preference.updatedAt,
            };
          });
        },
      };
      return handleAccountPreferencesRead(options);
    }

    const options: AccountPreferencesWriteOptions = {
      request,
      resolveUserId,
      writePreferences: async (userId, preferences) => {
        const database = getDatabase();
        const updatedAt = new Date();
        await database.transaction(async (transaction) => {
          await transaction
            .insert(accountPreference)
            .values({
              userId,
              voice: preferences.voice ?? null,
              voiceSpeed: preferences.voiceSpeed ?? null,
              defaultWorkspaceProvider: preferences.defaultWorkspaceProvider ?? null,
              updatedAt,
            })
            .onConflictDoUpdate({
              target: accountPreference.userId,
              set: {
                voice: preferences.voice ?? null,
                voiceSpeed: preferences.voiceSpeed ?? null,
                defaultWorkspaceProvider: preferences.defaultWorkspaceProvider ?? null,
                updatedAt,
              },
            });

          await transaction
            .delete(accountWorkspacePreference)
            .where(eq(accountWorkspacePreference.userId, userId));
          const workspaceRows = workspacePreferenceRows(userId, preferences, updatedAt);
          if (workspaceRows.length > 0) {
            await transaction.insert(accountWorkspacePreference).values(workspaceRows);
          }
        });
        return updatedAt;
      },
    };
    return handleAccountPreferencesWrite(options);
  },
};
