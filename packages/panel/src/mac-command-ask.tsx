import { ACT_KIND } from "@luke/host/acts";
import type { MacCommandAsk } from "@luke/host/app-state";
import { MAC_COMMAND_DECISION, type MacCommandDecision } from "@luke/host/contract";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { CommandAsk } from "@luke/ui";
import { useAct } from "./act.js";
import { SettingsPageLink } from "./open-settings.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";
import { useHeldThroughExit } from "./use-held-through-exit.js";

/**
 * mac-command-ask.tsx -- the command an agent asks to run on this Mac, put to the developer over the window while main holds it.
 *
 * Main holds each command it claimed under This Mac's Ask every
 * time until the developer answers or the command's own timeout passes
 * (`@luke/host`'s `compose-mac-commands.ts`), and the document carries the
 * asks waiting. The earliest is drawn, and the next takes its place as it
 * goes; the answer goes back by the ask's id, and the card goes as main
 * drops the ask, so one answered elsewhere or timed out leaves no card
 * standing once it has faded out. An answer main refuses says why in a toast, as every press does.
 */

/** The ask drawn: the earliest waiting, which main lists first. */
function firstAsk(asks: readonly MacCommandAsk[] | undefined): MacCommandAsk | undefined {
  return asks?.[0];
}

export function MacCommandAskDialog(): React.JSX.Element | null {
  const waiting = firstAsk(useAppSlice(APP_SLICE.MAC_COMMANDS)?.asks);
  const { press } = useAct();
  // Note that the card is drawn for the ask it was opened over until its fade has run, so its words do not change under its own exit.
  const { held: ask, onExited } = useHeldThroughExit(waiting);
  if (ask === undefined) return null;
  const answer = (decision: MacCommandDecision) =>
    press(ACT_KIND.MAC_COMMAND_ANSWER, { id: ask.id, decision });
  return (
    <CommandAsk
      key={ask.id}
      open={waiting !== undefined}
      onExited={onExited}
      command={ask.command}
      onAllowOnce={() => answer(MAC_COMMAND_DECISION.ALLOW_ONCE)}
      onAllowAlways={() => answer(MAC_COMMAND_DECISION.ALLOW_ALWAYS)}
      onDeny={() => answer(MAC_COMMAND_DECISION.DENY)}
      settingsPage={<SettingsPageLink page={SETTINGS_VIEW.THIS_MAC} />}
    />
  );
}
