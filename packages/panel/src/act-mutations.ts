import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind, SettingUpdatePayload } from "@repo/host/contract";
import type { AppSettingField, AppSettingValue } from "@repo/settings";
import { mutationOptions } from "@tanstack/react-query";
import { type ActResult, type ActVariables, sendAct, toastActFailure } from "./act.js";

export function actMutation<Kind extends PortActKind>(kind: Kind) {
  return mutationOptions<ActResult<Kind>, Error, ActVariables<Kind>>({
    mutationKey: [kind],
    mutationFn: (variables) => sendAct(kind, variables),
  });
}

export function pressMutation<Kind extends PortActKind>(kind: Kind) {
  return mutationOptions<ActResult<Kind>, Error, ActVariables<Kind>>({
    ...actMutation(kind),
    onError: (cause, variables) =>
      toastActFailure({
        surface: FAILURE_SURFACE.ACT,
        act: kind,
        cause,
        about: failureAboutOf(variables),
      }),
  });
}

export interface SettingWrite<Field extends AppSettingField = AppSettingField> {
  readonly field: Field;
  readonly value: AppSettingValue<Field>;
}

export function settingMutation() {
  return mutationOptions({
    mutationKey: [ACT_KIND.SETTING_UPDATE],
    mutationFn: ({ field, value }: SettingWrite) =>
      sendAct(ACT_KIND.SETTING_UPDATE, { field, value } as SettingUpdatePayload),
  });
}
