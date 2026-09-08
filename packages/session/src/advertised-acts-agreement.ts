import { ACT_KIND, advertisedActFor, advertisedControls } from "./advertised-acts.js";
import type { Session } from "./session-shape.js";

/**
 * Where the advertisement a session now carries disagrees with the six
 * capability fields it is replacing, named one line each, or nothing when they
 * say the same thing. It exists only for the window in which both are
 * written, and goes when the fields do; it holds no assertion of its own
 * because it is exported from a package a renderer bundles, where `node:test`
 * could not resolve.
 */
/** One capability field's value, in the shapes the six of them take. */
type ComparableFact =
  | boolean
  | string
  | undefined
  | readonly string[]
  | readonly (readonly (string | undefined)[])[];

function shown(fact: ComparableFact): string {
  return JSON.stringify(fact ?? null);
}

export function advertisedActDisagreements(session: Session): readonly string[] {
  const disagreements: string[] = [];
  const differs = (field: string, advertised: ComparableFact, kept: ComparableFact): void => {
    if (shown(advertised) !== shown(kept)) {
      disagreements.push(`${field}: advertised ${shown(advertised)}, kept ${shown(kept)}`);
    }
  };

  differs(
    "canReceiveMessage",
    advertisedActFor(session, ACT_KIND.MESSAGE) !== undefined,
    session.canReceiveMessage,
  );
  differs(
    "canRename",
    advertisedActFor(session, ACT_KIND.RENAME_SESSION) !== undefined,
    session.canRename,
  );
  differs(
    "renameTarget",
    advertisedActFor(session, ACT_KIND.RENAME_WORKSPACE)?.target,
    session.renameTarget,
  );
  differs(
    "spawnableAgents",
    advertisedActFor(session, ACT_KIND.ADD_AGENT)?.agents ?? [],
    session.spawnableAgents,
  );
  differs(
    "spawnTarget",
    advertisedActFor(session, ACT_KIND.ADD_AGENT)?.target,
    session.spawnTarget,
  );
  differs(
    "controls",
    advertisedControls(session).map((control) => [
      control.id,
      control.label,
      control.controlKind,
      control.target,
    ]),
    session.controls.map((control) => [control.id, control.label, control.kind, control.target]),
  );
  return disagreements;
}
