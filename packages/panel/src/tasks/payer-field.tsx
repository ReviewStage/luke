import type { CodingAgentPayer } from "@luke/features/coding-agent-wire";
import type { ProviderKeysAnswer } from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SELECT_ALIGN, Select } from "@luke/ui";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useNativeAgentsAccess } from "../use-app-state.js";
import { PAYER_WORDS, type PayerOffer } from "./payer-model.js";

/**
 * payer-field.tsx -- the payer a draft agent starts on, picked beside its model chip, and the account's keys it is offered from.
 *
 * Drawn only where `payerOffer` offers one (`payer-model.ts`): a pop-up
 * naming the payer the Start will name, the account's default until the
 * developer picks another for this one agent. Outside the native-agents
 * cohort the keys are never read and nothing is drawn, so the draft stands
 * as it always did.
 */

/** The account's provider keys as the service holds them, read once as the draft opens, for an account in the cohort alone; none before the read, outside it, or where it failed. */
export function useStartPayerKeys(): ProviderKeysAnswer | undefined {
  const { act } = useAct();
  const inCohort = useNativeAgentsAccess();
  const [keys, setKeys] = useState<ProviderKeysAnswer | undefined>(undefined);
  useEffect(() => {
    if (!inCohort) return;
    let live = true;
    act(ACT_KIND.PROVIDER_KEYS_READ).then(
      (read) => {
        if (live && !("failure" in read)) setKeys(read);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, inCohort]);
  return inCohort ? keys : undefined;
}

/** The payer pop-up over the offer, standing on `value`. */
export function PayerField({
  offer,
  value,
  onChange,
  disabled,
}: {
  offer: PayerOffer;
  value: CodingAgentPayer;
  onChange: (payer: CodingAgentPayer) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Select
      label={PAYER_WORDS.FIELD}
      options={offer.options.map((option) => ({ value: option.payer, label: option.label }))}
      value={value}
      onChange={onChange}
      disabled={disabled}
      align={SELECT_ALIGN.START}
    />
  );
}
