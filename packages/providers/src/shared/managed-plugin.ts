import fs from "node:fs/promises";
import path from "node:path";
import type { ObservationHookInstallation } from "./hook-merge.js";
import { canIgnoreFilesystemError, readTextFile } from "./local-session-adapter.js";

/**
 * Hook-fed observation for a provider that registers no commands at all:
 * instead of a configuration file naming scripts to run, the provider loads
 * whole plugin files from a directory of its own and runs them inside its own
 * process (OpenCode today). The arrangement therefore installs one managed
 * plugin file rather than merging entries — a whole file Luke owns, generated
 * by the build, recognized by the marker in its own header — and everything
 * else keeps `hook-merge.ts`'s discipline: install only where the provider's
 * home already exists, converge at every launch without moving an unchanged
 * file's mtime, and take back on removal exactly what the marker proves is
 * ours. The plugin itself is held to the scripts' bounds by its generated
 * content: one fixed token into Luke's spool, nothing read from an event
 * beyond the session it names, and silence once the spool is gone.
 *
 * There is no unparseable-file case here because there is no user file to
 * parse; its analogue is a foreign file wearing our name. That file is the
 * user's, however it got there: never rewritten, never deleted, and the
 * arrangement quietly installs nothing — the transcripts still observe.
 */

export interface ManagedObservationPluginSpec {
  /**
   * The header text a managed file is recognized by, versionless so a newer
   * build still recognizes and converges an older build's file. Changing it
   * is a migration: a file carrying the old marker would stop being
   * recognized as ours and would be left behind.
   */
  marker: string;
  /** The whole plugin file, fixed by the build around the spool it writes to. */
  content: (spoolDirectory: string) => string;
}

/**
 * Whether the file at the plugin path is Luke's to manage: a missing file is
 * ours to create, a marker-bearing one is ours to converge or remove, and
 * anything else is the user's own plugin that happens to wear our name.
 */
async function managedPluginSource(
  spec: ManagedObservationPluginSpec,
  pluginFilePath: string,
): Promise<{ ours: boolean; source?: string }> {
  const source = await readTextFile(pluginFilePath);
  if (source === undefined) return { ours: true };
  return { ours: source.includes(spec.marker), source };
}

/**
 * Puts the arrangement in place: the spool, and the plugin file inside the
 * provider's own plugin directory. Run at every launch and safe to run again
 * at any time — an unchanged file is left untouched down to its mtime.
 */
export async function installManagedObservationPlugin(
  spec: ManagedObservationPluginSpec,
  installation: ObservationHookInstallation,
): Promise<void> {
  // A machine with no provider home gets nothing at all, the same gate the
  // merged registrations keep: installing would create another product's
  // directory tree on its behalf, for sessions that do not exist. The
  // provider's own launch creates its home, so a provider that arrives later
  // is picked up the next time Luke starts.
  try {
    await fs.stat(installation.providerHome);
  } catch (error) {
    if (error instanceof Error && canIgnoreFilesystemError(error)) return;
    throw error;
  }

  const pluginFilePath = installation.hookScriptPath;
  const { ours, source } = await managedPluginSource(spec, pluginFilePath);
  if (!ours) return;

  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const content = spec.content(installation.spoolDirectory);
  if (source === content) return;
  // Creating the plugin subdirectory inside the provider's existing home is
  // the same liberty the merge takes creating a missing settings.json there:
  // the home proves the provider is present, and the subdirectory is the
  // documented place its plugins live.
  await fs.mkdir(path.dirname(pluginFilePath), { recursive: true });
  // Written beside and renamed over, so a provider starting mid-write never
  // loads half a plugin.
  const temporaryPath = `${pluginFilePath}.luke-tmp`;
  await fs.writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o644 });
  await fs.rename(temporaryPath, pluginFilePath);
}

/**
 * Takes the arrangement back out: the plugin file, but only while its marker
 * proves it ours, and the spool with whatever events it held. The provider's
 * plugin directory itself is left standing — it may hold the user's own
 * plugins, and a teardown that deletes a directory it did not create has the
 * relationship backwards.
 */
export async function removeManagedObservationPlugin(
  spec: ManagedObservationPluginSpec,
  installation: ObservationHookInstallation,
): Promise<void> {
  const { ours, source } = await managedPluginSource(spec, installation.hookScriptPath);
  if (ours && source !== undefined) {
    await fs.rm(installation.hookScriptPath, { force: true });
  }
  await fs.rm(installation.spoolDirectory, { recursive: true, force: true });
}
