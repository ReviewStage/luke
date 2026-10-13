import { db } from "@sidecar/database/core/query";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@sidecar/database/github-installation-vocabulary";
import { githubInstallation } from "@sidecar/database/schemas/github-installation";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { StoreFailure } from "./store-failure.js";

/**
 * github-installations.ts -- the GitHub App installation connected to a workspace.
 *
 * A workspace's repositories come from at most one installation of the Luke
 * GitHub App, which an owner or admin connects, tied to it by a
 * `github_installation` row keyed on GitHub's own ids. One installation, and
 * so one GitHub account, stands for one workspace. The installation webhook
 * keeps each row's status, and a disconnect deletes the row, which is
 * Luke's own.
 */

const updateInstallationStatus = SqlSchema.void({
  Request: Schema.Struct({
    installationId: Schema.Number,
    status: Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS)),
    now: Schema.Date,
  }),
  execute: (row) =>
    db
      .update(githubInstallation)
      .set({ status: row.status, updatedAt: row.now })
      .where(eq(githubInstallation.installationId, row.installationId)),
});

const deleteInstallation = SqlSchema.void({
  Request: Schema.String,
  execute: (organizationId) =>
    db.delete(githubInstallation).where(eq(githubInstallation.organizationId, organizationId)),
});

/** Where the installation now stands, as its webhook said; an installation no workspace is connected to moves nothing. */
export function setInstallationStatus(
  installationId: number,
  status: GitHubInstallationStatus,
): Effect.Effect<void, StoreFailure, SqlClient.SqlClient> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    updateInstallationStatus({ installationId, status, now }),
  );
}

/** The workspace's installation disconnected; a workspace with none connected moves nothing. */
export function disconnectInstallation(
  organizationId: string,
): Effect.Effect<void, StoreFailure, SqlClient.SqlClient> {
  return deleteInstallation(organizationId);
}
