import {
  CompositeSessionProviderAdapter,
  type SessionProviderAdapter,
  SessionProviderAdapterBase,
} from "@sidecar/session";
import { PROVIDER_ACT, type ProviderAct } from "../capabilities.js";
import { CliSessionAdapter } from "../shared/cli-session-adapter.js";
import { CloudSessionAdapter } from "../shared/cloud-session-adapter.js";
import { LocalSessionAdapter } from "../shared/local-session-adapter.js";

/**
 * The public act method each act travels through. Every base answers
 * unsupported here unless a subclass overrides the method itself or, for the
 * guarded bases below, the protected seam the method consults.
 */
const PUBLIC_ACT_METHOD = {
  [PROVIDER_ACT.MESSAGE]: "sendMessage",
  [PROVIDER_ACT.CONTROL]: "executeControl",
  [PROVIDER_ACT.CREATE_WORKSPACE]: "createWorkspace",
  [PROVIDER_ACT.ADD_AGENT]: "spawnWorkspaceAgent",
  [PROVIDER_ACT.RENAME_WORKSPACE]: "renameWorkspace",
  [PROVIDER_ACT.RENAME_SESSION]: "renameSession",
  [PROVIDER_ACT.READ_TRANSCRIPT]: "readTranscript",
  [PROVIDER_ACT.READ_CONVERSATION]: "readConversation",
} as const satisfies Record<ProviderAct, keyof SessionProviderAdapter>;

/**
 * `CloudSessionAdapter` overrides the six write methods as guards over
 * protected route seams, so a cloud subclass implements a write by supplying
 * the route, never by overriding the method.
 */
const CLOUD_ROUTE_SEAM = {
  [PROVIDER_ACT.MESSAGE]: "messageRoute",
  [PROVIDER_ACT.CONTROL]: "controlRoute",
  [PROVIDER_ACT.CREATE_WORKSPACE]: "workspaceCreationRoute",
  [PROVIDER_ACT.ADD_AGENT]: "workspaceAgentRoute",
  [PROVIDER_ACT.RENAME_WORKSPACE]: "workspaceRenameRoute",
  [PROVIDER_ACT.RENAME_SESSION]: "sessionRenameRoute",
} as const;

/** `LocalSessionAdapter` guards a message the same way, over `deliverMessage`. */
const LOCAL_MESSAGE_SEAM = "deliverMessage";

type SeamName =
  | (typeof PUBLIC_ACT_METHOD)[ProviderAct]
  | (typeof CLOUD_ROUTE_SEAM)[keyof typeof CLOUD_ROUTE_SEAM]
  | typeof LOCAL_MESSAGE_SEAM;

/**
 * The names every class between the adapter's own and its base defines for
 * itself. A seam an adapter implements is an own property of one of those
 * classes; one it inherits from the base is not, whatever the base answers.
 */
function definedBelow(adapter: SessionProviderAdapter, base: SessionProviderAdapter): Set<string> {
  const names = new Set<string>();
  let prototype = Object.getPrototypeOf(adapter);
  while (prototype !== null && prototype !== base) {
    for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
    prototype = Object.getPrototypeOf(prototype);
  }
  return names;
}

function cloudSeam(act: ProviderAct): SeamName {
  switch (act) {
    case PROVIDER_ACT.MESSAGE:
    case PROVIDER_ACT.CONTROL:
    case PROVIDER_ACT.CREATE_WORKSPACE:
    case PROVIDER_ACT.ADD_AGENT:
    case PROVIDER_ACT.RENAME_WORKSPACE:
    case PROVIDER_ACT.RENAME_SESSION:
      return CLOUD_ROUTE_SEAM[act];
    default:
      return PUBLIC_ACT_METHOD[act];
  }
}

function seamFor(
  adapter: SessionProviderAdapter,
  act: ProviderAct,
): [SessionProviderAdapter, SeamName] {
  if (adapter instanceof CloudSessionAdapter) {
    return [CloudSessionAdapter.prototype, cloudSeam(act)];
  }
  if (adapter instanceof LocalSessionAdapter) {
    return [
      LocalSessionAdapter.prototype,
      act === PROVIDER_ACT.MESSAGE ? LOCAL_MESSAGE_SEAM : PUBLIC_ACT_METHOD[act],
    ];
  }
  if (adapter instanceof CliSessionAdapter || adapter instanceof SessionProviderAdapterBase) {
    return [SessionProviderAdapterBase.prototype, PUBLIC_ACT_METHOD[act]];
  }
  throw new Error(
    `${adapter.provider.id} extends no adapter base this conformance check knows; teach it the seams before declaring the adapter's acts.`,
  );
}

/**
 * The acts an adapter actually implements, read from the seams it overrides
 * rather than by probing: every base answers unsupported for a session it has
 * not observed before it consults the seam, so a probe would only ever test
 * the guard. A composite implements the union of its members.
 */
export function implementedActs(adapter: SessionProviderAdapter): ReadonlySet<ProviderAct> {
  if (adapter instanceof CompositeSessionProviderAdapter) {
    return new Set(adapter.members.flatMap((member) => [...implementedActs(member)]));
  }
  const acts = new Set<ProviderAct>();
  for (const act of Object.values(PROVIDER_ACT)) {
    const [base, seam] = seamFor(adapter, act);
    if (definedBelow(adapter, base).has(seam)) acts.add(act);
  }
  return acts;
}
