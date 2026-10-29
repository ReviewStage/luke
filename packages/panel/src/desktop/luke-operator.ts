import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AGENT_KIND, type AgentSummary, type TasklessAgent } from "@luke/features/agent-wire";
import { readerZone } from "@luke/features/date-mention";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import { askAct } from "../act.js";
import { useExperiment } from "../use-app-state.js";

/**
 * luke-operator.ts -- Luke, the account's operator in the listed workspace: ensured once per workspace by the first surface that names it, and the panel's one gate on `EXPERIMENT.OPERATOR`.
 *
 * The operator is one agent per member per workspace (`PUT
 * /api/workspaces/{id}/operator`), made blank the first time it is ensured,
 * so nobody presses Start. Its row at the sidebar's head draws it, and ⌘K's
 * Ask Luke and its chord open it, each through this hook. While the account
 * has the experiment off the hook answers nothing and asks nothing, so none
 * of those stands. Note that every other place knows Luke by his kind alone,
 * whatever the experiment says: his page names him Luke and offers no
 * Rename, Archive, or Delete (`agent-actions.tsx`), every place drawing an
 * agent draws him with his face, and every other list of agents leaves him
 * out (`withoutLuke`), so an operator that stands while the experiment is off
 * is never drawn as an ordinary agent.
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

/** What a Reset or its Undo came to: the operator standing after it, where it landed, or what refused it beneath, where it did not. */
export type OperatorAnswer = ActionResult & { readonly agentId?: string; readonly cause?: unknown };

/** What an ensure asks beyond the workspace: nothing, a fresh operator, or the archived one named back. */
type EnsureAsk = Record<string, never> | { readonly reset: true } | { readonly restore: string };

/** What an ensure came to: the operator's id it answered, or the answer or error that refused it. */
type Ensured = { readonly agentId: string } | { readonly cause: unknown };

/** The operator's id an ensure answered, or what failed or refused it. */
function ensuredId(workspaceId: string, ask: EnsureAsk): Promise<Ensured> {
  return askAct(
    ACT_KIND.AGENTS_ENSURE_OPERATOR,
    // The zone this window reads in, which the heartbeat an ensure that makes Luke aims at him is read in.
    { workspaceId, ...ask, timeZone: readerZone() },
  ).then(
    (answer) => ("agentId" in answer ? { agentId: answer.agentId } : { cause: answer }),
    (cause: unknown) => ({ cause }),
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
  void ensuredId(place.workspaceId, {}).then((ensured) =>
    write((held) =>
      withRead(held, place, settled("agentId" in ensured ? ensured.agentId : undefined)),
    ),
  );
}

/** A Reset or its Undo asked, the operator it answered kept as the one standing, or `refused` said where none landed, with what refused it beneath. */
function replaced(
  write: OperatorsWrite,
  place: OperatorPlace,
  ask: EnsureAsk,
  refused: string,
): Promise<OperatorAnswer> {
  return ensuredId(place.workspaceId, ask).then((ensured): OperatorAnswer => {
    if (!("agentId" in ensured)) {
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused, cause: ensured.cause };
    }
    const { agentId } = ensured;
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
  const read = workspaceId === undefined ? undefined : readAt(reads, { accountId, workspaceId });
  // Note that Luke is the same object until his read changes, so a surface may build on him once rather than on every render.
  return useMemo((): LukeOperator | undefined => {
    if (workspaceId === undefined) return undefined;
    const place = { accountId, workspaceId };
    return {
      workspaceId,
      agentId: read?.kind === OPERATOR_READ.ENSURED ? read.agentId : undefined,
      failed: read?.kind === OPERATOR_READ.FAILED,
      retry: () => claimEnsure(write, place, true),
      reset: () => replaced(write, place, { reset: true }, RESET_REFUSED),
      restore: (agentId) => replaced(write, place, { restore: agentId }, RESTORE_REFUSED),
    };
  }, [accountId, workspaceId, read, write]);
}

/** Whether an agent is the account's operator, by its kind alone. */
export function isLuke(agent: Pick<AgentSummary, "kind">): boolean {
  return agent.kind === AGENT_KIND.OPERATOR;
}

/**
 * The agents a list draws with Luke left out, since he stands in his own
 * row. Note that he is known by his kind, whatever the experiment says, so a
 * list read before his ensure answered never draws him twice, and one read
 * while the account has him off never draws him as an ordinary agent.
 */
export function withoutLuke(agents: readonly TasklessAgent[]): readonly TasklessAgent[] {
  return agents.filter((agent) => !isLuke(agent));
}
