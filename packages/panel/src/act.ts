import { ACT_KIND } from "@luke/host/acts";
import {
  ACT_ERROR,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  type SettingUpdatePayload,
} from "@luke/host/contract";
import type { AppSettingField, AppSettingValue } from "@luke/settings";
import type { SettingsUpdateResult } from "@luke/settings/wire";
import { ORPCError } from "@orpc/client";
import { useMemo } from "react";
import { actPort } from "./app-bridge.js";

/**
 * What each kind takes and answers, keyed by the kind. Note that a kind's own
 * entry is looked up by its key rather than chosen by a conditional over
 * every kind, which TypeScript would distribute over the whole union at each
 * generic signature that names it.
 */
type ActPayloads = { readonly [Kind in PortActKind]: PortActPayload<Kind> };
type ActResults = { readonly [Kind in PortActKind]: PortActResult<Kind> };

/** What a kind takes. */
type ActPayload<Kind extends PortActKind> = ActPayloads[Kind];

/** What a kind answers. */
type ActResult<Kind extends PortActKind> = ActResults[Kind];

/** A kind that carries nothing is called with nothing; every other kind carries its own payload. */
type ActArguments<Kind extends PortActKind> =
  ActPayload<Kind> extends undefined ? [] : [payload: ActPayload<Kind>];

/**
 * One kind on the window's act port: its procedure called by the kind's own
 * name, and a refusal rejected as the sentence it carries, the rejection
 * every reader already handles. Note that each call is its own promise rather
 * than a set of one shared atom, because an atom answers every caller waiting
 * on it with its newest result: an agent's transcript read is held open by
 * the service for seconds, and any act sent meanwhile would have handed the
 * reader its answer, and taken the reader's.
 */
async function portAct(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): Promise<PortActResult<PortActKind>> {
  // SAFETY: the contract keys each procedure by its kind, and ActArguments
  // paired this payload with it; the erasure is the one dispatch on the kind.
  const call = actPort()[kind] as (
    payload: PortActPayload<PortActKind>,
  ) => Promise<PortActResult<PortActKind>>;
  try {
    return await call(payload);
  } catch (error) {
    if (error instanceof ORPCError && error.code === ACT_ERROR.REFUSED) {
      throw new Error(error.message);
    }
    throw error;
  }
}

async function performAct<Kind extends PortActKind>(
  kind: Kind,
  payload: ActPayload<Kind> | undefined,
): Promise<ActResult<Kind>> {
  // SAFETY: ActArguments paired this payload with this kind, and a kind's
  // answer is the one its own procedure's output schema encoded.
  return (await portAct(kind, payload as PortActPayload<PortActKind>)) as ActResult<Kind>;
}

/**
 * An act whose answer nothing reads, for a caller outside React: the call
 * window's avatar reports from the fiber running it, not from a render.
 */
export function tellAct<Kind extends PortActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): void {
  void performAct(kind, payload).catch(() => undefined);
}

/**
 * An act whose answer a caller outside React reads: a read an atom holds
 * for every card that hangs it (`planning/mentioned-agent-card.tsx`).
 */
export function askAct<Kind extends PortActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): Promise<ActResult<Kind>> {
  return performAct<Kind>(kind, payload);
}

/**
 * The settings write, generic in the field it names. It is the act a row's
 * own press mints — there is no second way to write a setting.
 */
interface SettingWriteActs {
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
}

/**
 * What a component or hook reaches the act channel through, in one bundle.
 * Note that `act` and `tell` are typed as `askAct` and `tellAct` themselves,
 * rather than restated as generic methods: with every kind the act port
 * answers, comparing two such generic signatures is a union TypeScript can
 * no longer represent.
 */
export interface ActHandle extends SettingWriteActs {
  act: typeof askAct;
  tell: typeof tellAct;
}

/** What a component or hook reaches the act channel through, in one bundle. */
export function useAct(): ActHandle {
  return useMemo<ActHandle>(
    () => ({
      act: askAct,
      tell: tellAct,
      // SAFETY: as updateSetting's own cast above, for this render tree's channel.
      updateSetting: (field, value) =>
        askAct(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload),
    }),
    [],
  );
}
