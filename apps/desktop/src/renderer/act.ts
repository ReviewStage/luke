import * as Registry from "@effect-atom/atom/Registry";
import { useAtomSet } from "@effect-atom/atom-react/Hooks";
import type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import { Cause, Effect, Exit } from "effect";
import { useMemo } from "react";
import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActPayload,
  type ActResultFor,
  type SettingEntryPayload,
  type SettingUpdatePayload,
} from "#shared/messages/acts";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime";

/** A kind that carries nothing is called with nothing; every other kind carries its own payload. */
type ActArguments<Kind extends ActKind> =
  ActPayload<Kind> extends undefined ? [] : [payload: ActPayload<Kind>];

/** Pairs a kind with the payload it takes, the pairing {@link Act} declares. */
export function actRequest<Kind extends ActKind>(
  kind: Kind,
  payload: ActPayload<Kind> | undefined,
): Act {
  // SAFETY: ActArguments guarantees payload is present exactly when the kind's own schema takes one.
  return (payload === undefined ? { kind } : { kind, payload }) as Act;
}

/**
 * A kind's own outcome, decoded into the value a caller reads or the
 * rejection every reader already handles: unknown to this build, refused
 * with the sentence its row draws, or a value its own guard admits.
 */
function decodedOutcome<Kind extends ActKind>(kind: Kind, outcome: ActOutcome): ActResultFor<Kind> {
  if (outcome.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) {
    throw new Error(`Luke does not know the act ${kind}.`);
  }
  if (outcome.status === ACT_OUTCOME_STATUS.REFUSED) throw new Error(outcome.reason);
  if (ACT[kind].result(outcome.value) === false) {
    throw new Error(`Invalid answer to the act ${kind}.`);
  }
  // SAFETY: the kind's own result guard admitted this value.
  return outcome.value as ActResultFor<Kind>;
}

/**
 * The one act channel out of the sandbox, as an `Atom.fn` on the runtime this
 * bundle's root built: setting it sends one `{kind, payload}` over `app:act`,
 * and its own value is the raw outcome the bridge answered, undecoded — every
 * kind shares this one atom, so the guard that turns an outcome into a kind's
 * own value or a rejection lives beside it in {@link decodedOutcome} rather
 * than in the atom itself.
 */
const actAtom = rendererRuntime.fn((request: Act) =>
  Effect.tryPromise({ try: () => window.sidecar.act(request), catch: (error) => error }),
);

async function performAct<Kind extends ActKind>(
  send: (request: Act) => Promise<ActOutcome>,
  kind: Kind,
  payload: ActPayload<Kind> | undefined,
): Promise<ActResultFor<Kind>> {
  const outcome = await send(actRequest(kind, payload));
  return decodedOutcome(kind, outcome);
}

function performTell<Kind extends ActKind>(
  send: (request: Act) => Promise<ActOutcome>,
  kind: Kind,
  payload: ActPayload<Kind> | undefined,
): void {
  void performAct(send, kind, payload).catch(() => undefined);
}

/**
 * @deprecated Runs {@link actAtom}'s effect for the one caller that is not a
 * component or a hook: `settings/writes.ts`'s static `SETTINGS_WRITES`
 * object, and `index.tsx`'s bootstrap-failure path, both outside any render
 * tree. It runs the atom here rather than at a renderer root, so it is a
 * strangler shim on the run allowlist in `docs/adr/0001-effect.md`; P9-08
 * deletes it once nothing outside a hook still asks for an act.
 */
function runAct(request: Act): Promise<ActOutcome> {
  rendererRegistry.set(actAtom, request);
  return Effect.runPromiseExit(
    Registry.getResult(rendererRegistry, actAtom, { suspendOnWaiting: true }),
  ).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  });
}

/**
 * The one way this window causes anything, for a caller outside a render
 * tree: one kind and its payload, over `app:act`, answered with that kind's
 * own value. The main process refuses as a value rather than a throw, and the
 * refusal's sentence becomes this call's rejection, which is how every row
 * that reads a failure already reads one. The answer is checked against the
 * kind's own guard before a caller sees it, so a main process out of step
 * with this window is a rejection here rather than a wrong value drawn.
 */
export function act<Kind extends ActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): Promise<ActResultFor<Kind>> {
  return performAct(runAct, kind, payload);
}

/**
 * An act whose answer nothing reads, which is what a fire-and-forget send
 * was. The refusal is still a value at the channel; here it is dropped rather
 * than left to surface as an unhandled rejection in a window that had nowhere
 * to draw it. A kind whose refusal a row should show is called through
 * {@link act} instead.
 */
export function tell<Kind extends ActKind>(kind: Kind, ...[payload]: ActArguments<Kind>): void {
  performTell(runAct, kind, payload);
}

/**
 * The two settings writes, generic in the field each names, for the callers
 * that take them as a seam: the spoken settings change carries them, and a
 * test hands the same shape a fixture. Both are the acts a row's own press
 * mints — there is no second way to write a setting.
 */
export interface SettingWriteActs {
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
  updateSettingEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Promise<SettingsUpdateResult>;
}

export function updateSetting<Field extends AppSettingField>(
  field: Field,
  value: AppSettingValue<Field>,
): Promise<SettingsUpdateResult> {
  // SAFETY: the payload pairs a field with its own value type, which is the
  // pairing SettingUpdatePayload distributes over every plain field; a keyed
  // field is refused by the act's own schema, as the bridge guard refused it
  // before there were acts.
  return act(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload);
}

export function updateSettingEntry<Field extends KeyedAppSettingField>(
  field: Field,
  key: string,
  value: SettingEntryValue<Field> | undefined,
): Promise<SettingsUpdateResult> {
  // SAFETY: as above, for the keyed fields and their entry values.
  return act(ACT_KIND.SETTING_UPDATE_ENTRY, { field, key, value } as SettingEntryPayload);
}

/** What a component or hook reaches the act channel through, in one bundle. */
export interface ActHandle extends SettingWriteActs {
  act<Kind extends ActKind>(kind: Kind, ...args: ActArguments<Kind>): Promise<ActResultFor<Kind>>;
  tell<Kind extends ActKind>(kind: Kind, ...args: ActArguments<Kind>): void;
}

/**
 * The channel a component or hook reaches: `useAtomSet` over {@link actAtom},
 * mounted for this render tree's life and run on the registry the root
 * provided rather than on a runtime built here. `act`, `tell`,
 * `updateSetting`, and `updateSettingEntry` decode a kind's own outcome
 * exactly as the module-level functions above do, so a caller moving from one
 * to the other changes only where it asks from.
 */
export function useAct(): ActHandle {
  const send = useAtomSet(actAtom, { mode: "promise" });
  return useMemo<ActHandle>(() => {
    function boundAct<Kind extends ActKind>(
      kind: Kind,
      ...[payload]: ActArguments<Kind>
    ): Promise<ActResultFor<Kind>> {
      return performAct(send, kind, payload);
    }
    function boundTell<Kind extends ActKind>(kind: Kind, ...[payload]: ActArguments<Kind>): void {
      performTell(send, kind, payload);
    }
    return {
      act: boundAct,
      tell: boundTell,
      // SAFETY: as updateSetting's own cast above, for this render tree's channel.
      updateSetting: (field, value) =>
        boundAct(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload),
      // SAFETY: as updateSettingEntry's own cast above, for this render tree's channel.
      updateSettingEntry: (field, key, value) =>
        boundAct(ACT_KIND.SETTING_UPDATE_ENTRY, { field, key, value } as SettingEntryPayload),
    };
  }, [send]);
}
