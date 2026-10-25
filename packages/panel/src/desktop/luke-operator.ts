import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  CODING_AGENT_KIND,
  type CodingAgentSummary,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { readerZone } from "@luke/features/date-mention";
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
 * which archives the operator standing and answers the fresh one; its Undo
 * ensures with `restore`, which archives the fresh one and brings back the
 * one the Reset retired.
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
const RESET_REFUSED = "Luke could not be reset. Try again in a moment.";

/** What a Reset's Undo that did not land says. */
const RESTORE_REFUSED = "Luke could not be put back. Try again in a moment.";

/** Each account's ensures, by the account's id, then by each workspace's id. */
type OperatorReads = ReadonlyMap<string | undefined, ReadonlyMap<string, OperatorRead>>;

/**
 * Each account's ensure in each workspace, kept for the window's life. Note
 * that it is the account's as much as the workspace's, because an operator is
 * one member's, so another account signed in to the same workspace in this
 * window ensures its own rather than opening the last one's.
 */
const operatorsAtom = Atom.keepAlive(Atom.make<OperatorReads>(new Map()));

/** Where an ensure is kept: the account asking, none in a fixture run, and the workspace. */
interface OperatorPlace {
  readonly accountId: string | undefined;
  readonly workspaceId: string;
}

/** One account's ensure in one workspace, as the window holds it. */
function readAt(held: OperatorReads, place: OperatorPlace): OperatorRead | undefined {
  return held.get(place.accountId)?.get(place.workspaceId);
}

/** What the window holds with one account's ensure in one workspace set to `read`. */
function withRead(held: OperatorReads, place: OperatorPlace, read: OperatorRead): OperatorReads {
  const account = new Map(held.get(place.accountId)).set(place.workspaceId, read);
  return new Map(held).set(place.accountId, account);
}

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
  readonly reset: () => Promise<OperatorAnswer>;
  /** Archives the operator standing and brings back the one a Reset retired, by its id, answering it where it landed. */
  readonly restore: (agentId: string) => Promise<OperatorAnswer>;
}

/** What a Reset or its Undo came to: the operator standing after it, where it landed. */
export type OperatorAnswer = ActionResult & { readonly agentId?: string };

/** What an ensure asks beyond the workspace: nothing, a fresh operator, or the archived one named back. */
type EnsureAsk = Record<string, never> | { readonly reset: true } | { readonly restore: string };

/** The operator's id an ensure answered, or none for a failure or a refusal. */
function ensuredId(workspaceId: string, ask: EnsureAsk): Promise<string | undefined> {
  return askAct(
    ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR,
    // The zone this window reads in, which the heartbeat an ensure that makes Luke aims at him is read in.
    { workspaceId, ...ask, timeZone: readerZone() },
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

/** Writes one ensure into what the window keeps. */
type OperatorsWrite = (change: (held: OperatorReads) => OperatorReads) => void;

/**
 * Asks one workspace's ensure where none was asked yet, or, `again`, where
 * the last one failed. Note that the claim is taken inside the write, which
 * runs at once, so two surfaces drawn together ask once.
 */
function claimEnsure(write: OperatorsWrite, place: OperatorPlace, again: boolean): void {
  let claimed = false;
  write((held) => {
    const standing = readAt(held, place);
    if (standing !== undefined && !(again && standing.kind === OPERATOR_READ.FAILED)) return held;
    claimed = true;
    return withRead(held, place, { kind: OPERATOR_READ.ENSURING });
  });
  if (!claimed) return;
  // Note that the answer lands under the account that asked, so one arriving after a sign-out is never another account's.
  void ensuredId(place.workspaceId, {}).then((agentId) =>
    write((held) => withRead(held, place, settled(agentId))),
  );
}

/** A Reset or its Undo asked, the operator it answered kept as the one standing, or `refused` said where none landed. */
function replaced(
  write: OperatorsWrite,
  place: OperatorPlace,
  ask: EnsureAsk,
  refused: string,
): Promise<OperatorAnswer> {
  return ensuredId(place.workspaceId, ask).then((agentId) => {
    if (agentId === undefined) return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
    write((held) => withRead(held, place, settled(agentId)));
    return { status: ACTION_RESULT_STATUS.ACCEPTED, agentId };
  });
}

/**
 * Luke for the account in the workspace named: ensured the first time any
 * surface asks, and none while the account has the experiment off or no
 * workspace is listed.
 */
export function useLukeOperator(asking: {
  readonly accountId: string | undefined;
  readonly workspaceId: string | undefined;
}): LukeOperator | undefined {
  const on = useExperiment(EXPERIMENT.OPERATOR);
  const reads = useAtomValue(operatorsAtom);
  const write = useAtomSet(operatorsAtom);
  const { accountId } = asking;
  const workspaceId = on ? asking.workspaceId : undefined;
  useEffect(() => {
    if (workspaceId !== undefined) claimEnsure(write, { accountId, workspaceId }, false);
  }, [accountId, workspaceId, write]);
  if (workspaceId === undefined) return undefined;
  const place = { accountId, workspaceId };
  const read = readAt(reads, place);
  return {
    workspaceId,
    agentId: read?.kind === OPERATOR_READ.ENSURED ? read.agentId : undefined,
    failed: read?.kind === OPERATOR_READ.FAILED,
    retry: () => claimEnsure(write, place, true),
    reset: () => replaced(write, place, { reset: true }, RESET_REFUSED),
    restore: (agentId) => replaced(write, place, { restore: agentId }, RESTORE_REFUSED),
  };
}

/** Whether an agent is the account's operator: by its kind, or, from a service before the summary said it, by the id its ensure answered. */
export function isLuke(
  agent: Pick<CodingAgentSummary, "id" | "kind">,
  operator: LukeOperator,
): boolean {
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
