import { eq } from "drizzle-orm";
import { accountPreference, accountWorkspacePreference } from "../../db/schema.js";
import type { HostedStoreDatabase } from "../store/database.js";

/** The developer's saved creation tie-breaks, as the projects context narrates them and admission reads them. */
export interface HostedWorkspaceDefaults {
  readonly defaultProviderId?: string;
  readonly defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
}

/**
 * The developer's saved creation tie-breaks as the account keeps them: the
 * provider a nameless creation goes to, and each provider's default project.
 * They steer the projects context the brain reads and the admission of a
 * creation that names no project, exactly as the desktop's settings do.
 */
export async function readWorkspaceDefaults(
  db: Pick<HostedStoreDatabase, "select">,
  userId: string,
): Promise<HostedWorkspaceDefaults> {
  const [preference] = await db
    .select({ defaultWorkspaceProvider: accountPreference.defaultWorkspaceProvider })
    .from(accountPreference)
    .where(eq(accountPreference.userId, userId));
  const projects = await db
    .select({
      providerId: accountWorkspacePreference.providerId,
      defaultProjectId: accountWorkspacePreference.defaultProjectId,
    })
    .from(accountWorkspacePreference)
    .where(eq(accountWorkspacePreference.userId, userId));
  const defaultProjectIds: Partial<Record<string, string>> = {};
  for (const row of projects) {
    if (row.defaultProjectId) defaultProjectIds[row.providerId] = row.defaultProjectId;
  }
  return {
    ...(preference?.defaultWorkspaceProvider
      ? { defaultProviderId: preference.defaultWorkspaceProvider }
      : undefined),
    ...(Object.keys(defaultProjectIds).length > 0 ? { defaultProjectIds } : undefined),
  };
}
