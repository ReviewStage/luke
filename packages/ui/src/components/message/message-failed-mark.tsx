import { GLYPH } from "../../icons/glyph-registry.js";
import { isReported, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import { ANNOUNCE, announce } from "../announcer/announcer.js";
import { BUTTON_VARIANT, IconButton } from "../button/button.js";
import { useFailureDetails } from "../failure-copy/failure-copy.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";

const COPY_DETAILS = "Copy details";
const COPIED = "Copied";
const NOT_COPIED = "Could not copy";

function copyAnswered(copy: (text: string) => Promise<void>, details: string): void {
  let copying: Promise<void>;
  try {
    copying = copy(details);
  } catch (refusal) {
    copying = Promise.reject(refusal);
  }
  copying.then(
    () => announce(ANNOUNCE.POLITE, COPIED),
    () => announce(ANNOUNCE.ALERT, NOT_COPIED),
  );
}

export function MessageFailedMark({
  label,
  reason,
  groups,
  failure,
  replayUnmasked = false,
}: {
  label: string;
  reason: string;
  groups: readonly (readonly MenuEntry[])[];
  failure: ReportedFailure | Unreported | undefined;
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const reported = isReported(failure) ? failure : undefined;
  const details = useFailureDetails(reported);
  const copy: readonly (readonly MenuEntry[])[] =
    reported === undefined || details === undefined
      ? []
      : [
          [
            {
              label: COPY_DETAILS,
              icon: <GLYPH.COPY />,
              onSelect: () => copyAnswered(reported.copy, details),
            },
          ],
        ];
  return (
    <>
      <IconButton
        label={label}
        variant={BUTTON_VARIANT.DANGER_QUIET}
        icon={<GLYPH.FAILED />}
        {...menu.trigger()}
      />
      {menu.drawn === undefined ? null : (
        <Menu
          label={label}
          heading={reason}
          menu={menu.drawn}
          groups={[...groups, ...copy]}
          onClose={menu.close}
          replayUnmasked={replayUnmasked}
        />
      )}
    </>
  );
}
