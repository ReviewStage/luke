import { and, asc, eq } from "drizzle-orm";
import { workspaceFile } from "../../db/schema.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The identity workspace and the notebook, one row per user per file. A path
 * is workspace-relative and plain — no leading slash, no empty or `..`
 * segment — so a row can never name a file outside the workspace; the
 * contents are sealed whole and rewritten whole, the way the desktop's
 * workspace files land through a rename.
 */

export interface WorkspaceFileRecord {
  readonly path: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkspaceFileListing {
  readonly path: string;
  readonly updatedAt: number;
}

const PATH_SEPARATOR = "/";

function isWorkspacePath(path: string): boolean {
  if (path.length === 0 || path.startsWith(PATH_SEPARATOR) || path.includes("\\")) return false;
  return path
    .split(PATH_SEPARATOR)
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function assertWorkspacePath(path: string): void {
  if (!isWorkspacePath(path)) throw new Error("a workspace path is relative and names no parent");
}

export async function readWorkspaceFile(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  path: string,
): Promise<WorkspaceFileRecord | undefined> {
  assertWorkspacePath(path);
  const [row] = await db
    .select()
    .from(workspaceFile)
    .where(and(eq(workspaceFile.userId, userId), eq(workspaceFile.path, path)));
  if (!row) return undefined;
  return {
    path: row.path,
    content: seal.open(row.sealedContent),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Writes the file whole, creating it or replacing it. */
export async function writeWorkspaceFile(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  path: string,
  content: string,
  now: number,
): Promise<void> {
  assertWorkspacePath(path);
  const sealedContent = seal.seal(content);
  await db
    .insert(workspaceFile)
    .values({ userId, path, sealedContent, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [workspaceFile.userId, workspaceFile.path],
      set: { sealedContent, updatedAt: now },
    });
}

/** Writes the file only where none stands: the seeding a launch does once, and an edit never undone by an upgrade. */
export async function seedWorkspaceFile(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  path: string,
  content: string,
  now: number,
): Promise<boolean> {
  assertWorkspacePath(path);
  const inserted = await db
    .insert(workspaceFile)
    .values({ userId, path, sealedContent: seal.seal(content), createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ path: workspaceFile.path });
  return inserted.length > 0;
}

export async function deleteWorkspaceFile(
  db: HostedStoreDatabase,
  userId: string,
  path: string,
): Promise<boolean> {
  assertWorkspacePath(path);
  const removed = await db
    .delete(workspaceFile)
    .where(and(eq(workspaceFile.userId, userId), eq(workspaceFile.path, path)))
    .returning({ path: workspaceFile.path });
  return removed.length > 0;
}

export async function listWorkspaceFiles(
  db: HostedStoreDatabase,
  userId: string,
): Promise<readonly WorkspaceFileListing[]> {
  return db
    .select({ path: workspaceFile.path, updatedAt: workspaceFile.updatedAt })
    .from(workspaceFile)
    .where(eq(workspaceFile.userId, userId))
    .orderBy(asc(workspaceFile.path));
}
