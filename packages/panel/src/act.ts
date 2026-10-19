import {
  ACT,
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActPayload,
  type ActResultFor,
  type SettingUpdatePayload,
} from "@luke/host/acts";
import {
  ACT_ERROR,
  isPortActKind,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@luke/host/contract";
import type { AppSettingField, AppSettingValue } from "@luke/settings";
import type { SettingsUpdateResult } from "@luke/settings/wire";
import { ORPCError } from "@orpc/client";
import { useMemo } from "react";
import { actPort, appBridge } from "./app-bridge.js";

/** Any kind a window may ask: one `app:act` carries, or one its act port answers. */
type AnyActKind = ActKind | PortActKind;

/** What a kind takes, from whichever side declares it. */
type AnyActPayload<Kind extends AnyActKind> = Kind extends PortActKind
  ? PortActPayload<Kind>
  : Kind extends ActKind
    ? ActPayload<Kind>
    : never;

/** What a kind answers, from whichever side declares it. */
type AnyActResult<Kind extends AnyActKind> = Kind extends PortActKind
  ? PortActResult<Kind>
  : Kind extends ActKind
    ? ActResultFor<Kind>
    : never;

/** A kind that carries nothing is called with nothing; every other kind carries its own payload. */
type ActArguments<Kind extends AnyActKind> =
  AnyActPayload<Kind> extends undefined ? [] : [payload: AnyActPayload<Kind>];

/** Pairs a kind with the payload it takes, the pairing {@link Act} declares. */
function actRequest<Kind extends ActKind>(kind: Kind, payload: ActPayload<Kind> | undefined): Act {
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
 * The one act channel out of the sandbox: one invoke over `app:act` carrying
 * one `{kind, payload}`, answered with the raw outcome the bridge returned,
 * undecoded — every kind shares this one door, so the guard that turns an
 * outcome into a kind's own value or a rejection lives beside it in
 * {@link decodedOutcome} rather than in the door itself. Note that each call
 * is its own promise rather than a set of one shared atom, because an atom
 * answers every caller waiting on it with its newest result: an agent's
 * transcript read is held open by the service for seconds, and any act sent
 * meanwhile would have handed the reader its answer, and taken the reader's.
 */
const send = (request: Act): Promise<ActOutcome> => appBridge().act(request);

/**
 * One kind on the window's act port: its procedure called by the kind's own
 * name, and a refusal rejected as the sentence it carries, the same
 * rejection an `app:act` refusal is, so a reader handles both alike.
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

async function performAct<Kind extends AnyActKind>(
  send: (request: Act) => Promise<ActOutcome>,
  kind: Kind,
  payload: AnyActPayload<Kind> | undefined,
): Promise<AnyActResult<Kind>> {
  if (isPortActKind(kind)) {
    // SAFETY: ActArguments paired this payload with this kind, and a port
    // kind's answer is the one its own procedure's output schema encoded.
    return (await portAct(kind, payload as PortActPayload<PortActKind>)) as AnyActResult<Kind>;
  }
  // SAFETY: every kind the port does not answer is one `app:act` carries.
  const appKind = kind as Exclude<Kind, PortActKind> & ActKind;
  // SAFETY: ActArguments paired this payload with this kind.
  const request = actRequest(appKind, payload as ActPayload<typeof appKind>);
  const outcome = await send(request);
  // SAFETY: an `app:act` kind's answer is the one its own guard admitted in decodedOutcome.
  return decodedOutcome(appKind, outcome) as AnyActResult<Kind>;
}

function performTell<Kind extends AnyActKind>(
  send: (request: Act) => Promise<ActOutcome>,
  kind: Kind,
  payload: AnyActPayload<Kind> | undefined,
): void {
  void performAct(send, kind, payload).catch(() => undefined);
}

/**
 * An act whose answer nothing reads, for a caller outside React: the call
 * window's avatar reports from the fiber running it, not from a render.
 */
export function tellAct<Kind extends AnyActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): void {
  performTell(send, kind, payload);
}

/**
 * An act whose answer a caller outside React reads: a read an atom holds
 * for every card that hangs it (`planning/mentioned-agent-card.tsx`).
 */
export function askAct<Kind extends AnyActKind>(
  kind: Kind,
  ...[payload]: ActArguments<Kind>
): Promise<AnyActResult<Kind>> {
  return performAct(send, kind, payload);
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

/** What a component or hook reaches the act channel through, in one bundle. */
export interface ActHandle extends SettingWriteActs {
  act<Kind extends AnyActKind>(
    kind: Kind,
    ...args: ActArguments<Kind>
  ): Promise<AnyActResult<Kind>>;
  tell<Kind extends AnyActKind>(kind: Kind, ...args: ActArguments<Kind>): void;
}

/** What a component or hook reaches the act channel through, in one bundle. */
export function useAct(): ActHandle {
  return useMemo<ActHandle>(() => {
    function boundAct<Kind extends AnyActKind>(
      kind: Kind,
      ...[payload]: ActArguments<Kind>
    ): Promise<AnyActResult<Kind>> {
      return performAct(send, kind, payload);
    }
    function boundTell<Kind extends AnyActKind>(
      kind: Kind,
      ...[payload]: ActArguments<Kind>
    ): void {
      performTell(send, kind, payload);
    }
    return {
      act: boundAct,
      tell: boundTell,
      // SAFETY: as updateSetting's own cast above, for this render tree's channel.
      updateSetting: (field, value) =>
        boundAct(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload),
    };
  }, []);
}
