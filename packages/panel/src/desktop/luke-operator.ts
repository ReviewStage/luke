import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_KIND, type TasklessAgent } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { askAct } from "../act.js";
import { useExperiment } from "../use-app-state.js";

/**
 * luke-operator.ts -- Luke, the account's operator in the listed workspace: ensured once per workspace by the first surface that names it, and the panel's one gate on `EXPERIMENT.OPERATOR`.
 *
 * The operator is one agent per member per workspace (`PUT
 * /api/workspaces/{id}/operator`), made blank the first time it is ensured,
 * so nobody presses Start. Its row at the sidebar's head draws it, ⌘K's Ask
 * Luke and its chord open it, its page names it Luke, and every other list
 * of agents leaves it out, each through this hook. While the account has the
 * experiment off the hook answers nothing and asks nothing, so nothing
 * stands anywhere.
 *
 * Each workspace's ensure is asked once for the window, whichever surface
 * draws first, and kept here, so switching back to a workspace shows its
 * Luke without asking again. One that failed stays failed until the reader
 * retries it, never by itself, so a service that keeps refusing draws a
 * quiet retry rather than a loop. A Reset ensures afresh with `reset`,
 * which archives the operator standing and answers the fresh one.
 */

/** The name the operator is drawn by, wherever it stands. */
export const LUKE_NAME = "Luke";

/** Where one workspace's ensure stands. */
const OPERATOR_READ = {
  ENSURING: "ensuring",
  ENSURED: "ensured",
  FAILED: "failed",
} as const;

type OperatorRead =
  | { readonly kind: typeof OPERATOR_READ.ENSURING }
  | { readonly kind: typeof OPERATOR_READ.ENSURED; readonly agentId: string }
  | { readonly kind: typeof OPERATOR_READ.FAILED };

/** What a Reset that did not land says. */
const RESET_REFUSED = "Luke could not be started afresh. Try again in a moment.";

/** Each workspace's ensure, by its id, kept for the window's life. */
const operatorsAtom = Atom.keepAlive(Atom.make<ReadonlyMap<string, OperatorRead>>(new Map()));

/** The account's operator in one workspace, as every surface that names it reads it. */
export interface LukeOperator {
  readonly workspaceId: string;
  /** Its id once ensured; none while the ensure is on its way or failed. */
  readonly agentId: string | undefined;
  /** Whether the ensure failed, which the row offers a retry for. */
  readonly failed: boolean;
  /** Asks the ensure again after it failed; nothing while one is on its way or it stands. */
  readonly retry: () => void;
  /** Archives the operator standing and ensures a fresh one, answering its id where it landed. */
  readonly reset: () => Promise<ActionResult & { readonly agentId?: string }>;
}

/** The operator's id an ensure answered, or none for a failure or a refusal. */
function ensuredId(workspaceId: string, reset: boolean): Promise<string | undefined> {
  return askAct(
    ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR,
    reset ? { workspaceId, reset } : { workspaceId },
  ).then(
    (answer) => ("agentId" in answer ? answer.agentId : undefined),
    () => undefined,
  );
}

/** What an ensure's answer leaves standing. */
function settled(agentId: string | undefined): OperatorRead {
  return agentId === undefined
    ? { kind: OPERATOR_READ.FAILED }
    : { kind: OPERATOR_READ.ENSURED, agentId };
}

/** Writes one workspace's ensure into what the window keeps. */
type OperatorsWrite = (
  change: (held: ReadonlyMap<string, OperatorRead>) => ReadonlyMap<string, OperatorRead>,
) => void;

/**
 * Asks one workspace's ensure where none was asked yet, or, `again`, where
 * the last one failed. Note that the claim is taken inside the write, which
 * runs at once, so two surfaces drawn together ask once.
 */
function claimEnsure(write: OperatorsWrite, workspaceId: string, again: boolean): void {
  let claimed = false;
  write((held) => {
    const standing = held.get(workspaceId);
    if (standing !== undefined && !(again && standing.kind === OPERATOR_READ.FAILED)) return held;
    claimed = true;
    return new Map(held).set(workspaceId, { kind: OPERATOR_READ.ENSURING });
  });
  if (!claimed) return;
  void ensuredId(workspaceId, false).then((agentId) =>
    write((held) => new Map(held).set(workspaceId, settled(agentId))),
  );
}

/**
 * Luke in the workspace named: ensured the first time any surface asks, and
 * none while the account has the experiment off or no workspace is listed.
 */
export function useLukeOperator(workspaceId: string | undefined): LukeOperator | undefined {
  const on = useExperiment(EXPERIMENT.OPERATOR);
  const reads = useAtomValue(operatorsAtom);
  const write = useAtomSet(operatorsAtom);
  const asked = on ? workspaceId : undefined;
  useEffect(() => {
    if (asked !== undefined) claimEnsure(write, asked, false);
  }, [asked, write]);
  if (asked === undefined) return undefined;
  const read = reads.get(asked);
  return {
    workspaceId: asked,
    agentId: read?.kind === OPERATOR_READ.ENSURED ? read.agentId : undefined,
    failed: read?.kind === OPERATOR_READ.FAILED,
    retry: () => claimEnsure(write, asked, true),
    reset: () =>
      ensuredId(asked, true).then((agentId) => {
        if (agentId === undefined) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: RESET_REFUSED };
        }
        write((held) => new Map(held).set(asked, settled(agentId)));
        return { status: ACTION_RESULT_STATUS.ACCEPTED, agentId };
      }),
  };
}

/** Whether an agent is the account's operator: by its kind, or, from a service before the summary said it, by the id its ensure answered. */
export function isLuke(agent: TasklessAgent, operator: LukeOperator): boolean {
  return agent.kind === CODING_AGENT_KIND.OPERATOR || agent.id === operator.agentId;
}

/**
 * The agents a list draws with Luke left out, since he stands in his own
 * row; every one while the account has him off. Note that he is known by his
 * kind, so a list read before his ensure answered never draws him twice.
 */
export function withoutLuke(
  agents: readonly TasklessAgent[],
  operator: LukeOperator | undefined,
): readonly TasklessAgent[] {
  return operator === undefined ? agents : agents.filter((agent) => !isLuke(agent, operator));
}
