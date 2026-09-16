import type { ToolDescriptor } from "./registry.js";

/**
 * What a run may call, decided by policy rather than by who opened it. A
 * policy is an allow list, a deny list, or both; layers apply in OpenClaw's
 * order — global, then the agent's, then the provider's, then the session's,
 * then the child's, then the turn's own layer, the one fact about a turn's
 * kind the host adds beneath the configuration — and at every layer deny wins
 * over allow. An allow list narrows the catalog to what it names
 * (a name outside the catalog is ignored, never invented); a deny list
 * removes what it names; a layer naming neither leaves the set as it stood.
 * A group name (`group:read`) stands for every tool the registry filed
 * under it. The result is the effective policy the host enforces twice: when
 * it builds the schemas a model is offered, and again at the door of every
 * dispatch, so a call for a tool the policy removed is refused whether or
 * not the model was shown it.
 *
 * Origin is attribution, not permission: a user's run, an observation, a
 * continuation, and a child all execute what the effective policy allows,
 * writes included. What a run is not offered is decided here and only here.
 */

export interface ToolPolicy {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export const TOOL_POLICY_LAYER = {
  GLOBAL: "global",
  AGENT: "agent",
  PROVIDER: "provider",
  SESSION: "session",
  CHILD: "child",
  TURN: "turn",
} as const;

export type ToolPolicyLayer = (typeof TOOL_POLICY_LAYER)[keyof typeof TOOL_POLICY_LAYER];

/** The order the layers apply in, fixed by the pinned OpenClaw pipeline: the declaration order above. */
export const TOOL_POLICY_ORDER: readonly ToolPolicyLayer[] = Object.values(TOOL_POLICY_LAYER);

/** The configured layers: everything but the turn's own, which the host supplies per turn. */
type ConfiguredToolPolicyLayer = Exclude<ToolPolicyLayer, typeof TOOL_POLICY_LAYER.TURN>;

export type ToolPolicyLayers = Partial<Record<ConfiguredToolPolicyLayer, ToolPolicy>>;

export const GROUP_PREFIX = "group:";
const WILDCARD_SUFFIX = "*";

function matches(pattern: string, name: string): boolean {
  if (pattern.endsWith(WILDCARD_SUFFIX)) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

/** Expands one policy entry to the tool names it stands for within the catalog. */
function expand(entry: string, catalog: readonly ToolDescriptor[]): readonly string[] {
  if (entry.startsWith(GROUP_PREFIX)) {
    const group = entry.slice(GROUP_PREFIX.length);
    return catalog.filter((tool) => tool.groups.includes(group)).map((tool) => tool.schema.name);
  }
  return catalog.filter((tool) => matches(entry, tool.schema.name)).map((tool) => tool.schema.name);
}

interface ToolDenial {
  readonly tool: string;
  readonly layer: ToolPolicyLayer;
}

export interface EffectiveToolPolicy {
  /** The tools the run is offered and may dispatch, in catalog order. */
  readonly allowed: readonly ToolDescriptor[];
  /** Every tool the layers removed, with the layer that removed it first. */
  readonly denied: readonly ToolDenial[];
  allows(name: string): boolean;
  /** The layer that removed the tool named, or nothing when it stands or was never in the catalog. */
  deniedBy(name: string): ToolPolicyLayer | undefined;
}

function applyLayer(
  standing: ReadonlySet<string>,
  policy: ToolPolicy,
  layer: ToolPolicyLayer,
  catalog: readonly ToolDescriptor[],
  denied: ToolDenial[],
): ReadonlySet<string> {
  let next: Set<string>;
  if (policy.allow !== undefined) {
    const allowed = new Set(policy.allow.flatMap((entry) => expand(entry, catalog)));
    next = new Set([...standing].filter((name) => allowed.has(name)));
    for (const name of standing) {
      if (!allowed.has(name)) denied.push({ tool: name, layer });
    }
  } else {
    next = new Set(standing);
  }
  for (const entry of policy.deny ?? []) {
    for (const name of expand(entry, catalog)) {
      if (next.delete(name)) denied.push({ tool: name, layer });
    }
  }
  return next;
}

/**
 * Resolves the layers over the catalog into the effective policy. The turn's
 * own layer comes last, because it states a fact about the turn's kind rather
 * than a preference: nothing a configured allow list says can restore what it
 * removed.
 */
export function resolveToolPolicy(
  catalog: readonly ToolDescriptor[],
  layers: ToolPolicyLayers,
  turn?: ToolPolicy,
): EffectiveToolPolicy {
  const denied: ToolDenial[] = [];
  let standing: ReadonlySet<string> = new Set(catalog.map((tool) => tool.schema.name));
  for (const layer of TOOL_POLICY_ORDER) {
    const policy = layer === TOOL_POLICY_LAYER.TURN ? turn : layers[layer];
    if (policy) standing = applyLayer(standing, policy, layer, catalog, denied);
  }
  const allowed = catalog.filter((tool) => standing.has(tool.schema.name));
  const names = new Set(allowed.map((tool) => tool.schema.name));
  const deniedBy = new Map<string, ToolPolicyLayer>();
  for (const denial of denied) {
    if (!deniedBy.has(denial.tool)) deniedBy.set(denial.tool, denial.layer);
  }
  return {
    allowed,
    denied,
    allows: (name) => names.has(name),
    deniedBy: (name) => deniedBy.get(name),
  };
}
