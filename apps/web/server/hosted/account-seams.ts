import { accountPreferencesFromStored } from "@sidecar/settings";
import { eq } from "drizzle-orm";
import type { AccountAppSeams } from "../account-app.js";
import { isRealtimeVoiceSpeed } from "../core.js";
import { getDatabase } from "../db/index.js";
import { accountPreference, accountWorkspacePreference, user } from "../db/schema.js";
import type { HostedAccountPreferences } from "./account-preferences.js";
import { forgetPosthogPerson, POSTHOG_ENVIRONMENT, type PosthogForgetOptions } from "./posthog.js";
import { resolveHostedUserId } from "./vault-route.js";

/**
 * The account group's seams over this deployment's real database and
 * environment. `server/account-app.ts` describes the two endpoints; this is
 * the one place that hands them a real user table, a real preferences store,
 * and a real analytics erasure, so both `api/account/**` functions build the
 * group from the same wiring.
 */

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
): HostedAccountPreferences {
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

  const shared =
    accountPreferencesFromStored({
      ...(preference.voice ? { voice: preference.voice } : undefined),
      ...(preference.defaultWorkspaceProvider
        ? { defaultWorkspaceProvider: preference.defaultWorkspaceProvider }
        : undefined),
      ...(Object.keys(workspaceProjectDefaults).length > 0
        ? { workspaceProjectDefaults }
        : undefined),
      ...(Object.keys(workspaceAgentDefaults).length > 0 ? { workspaceAgentDefaults } : undefined),
    }) ?? {};
  return {
    ...shared,
    ...(isRealtimeVoiceSpeed(preference.voiceSpeed)
      ? { voiceSpeed: preference.voiceSpeed }
      : undefined),
  };
}

function workspacePreferenceRows(
  userId: string,
  preferences: HostedAccountPreferences,
  updatedAt: Date,
) {
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

/** Without both halves of the analytics configuration there is no person to erase and nothing to erase it with. */
function forgetAnalyticsSeam(): ((userId: string) => Promise<void>) | undefined {
  const personalApiKey = process.env[POSTHOG_ENVIRONMENT.PERSONAL_API_KEY];
  const projectId = process.env[POSTHOG_ENVIRONMENT.PROJECT_ID];
  if (!personalApiKey || !projectId) return undefined;
  const host = process.env[POSTHOG_ENVIRONMENT.API_HOST];
  return (userId: string) => {
    const forget: PosthogForgetOptions = { personalApiKey, projectId };
    if (host) forget.host = host;
    return forgetPosthogPerson(userId, forget);
  };
}

/** This deployment's account group, over its real database, environment, and auth session. */
export function accountAppSeams(): AccountAppSeams {
  return {
    resolveUserId: resolveHostedUserId,
    deleteUser: async (userId) => {
      await getDatabase().delete(user).where(eq(user.id, userId));
    },
    forgetAnalytics: forgetAnalyticsSeam(),
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
}
