import type { AppSettingField, AppSettingValue } from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
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
  type SettingUpdatePayload,
} from "#shared/messages/acts";

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
const send = (request: Act): Promise<ActOutcome> => window.sidecar.act(request);

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
  act<Kind extends ActKind>(kind: Kind, ...args: ActArguments<Kind>): Promise<ActResultFor<Kind>>;
  tell<Kind extends ActKind>(kind: Kind, ...args: ActArguments<Kind>): void;
}

/** What a component or hook reaches the act channel through, in one bundle. */
export function useAct(): ActHandle {
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
    };
  }, []);
}
