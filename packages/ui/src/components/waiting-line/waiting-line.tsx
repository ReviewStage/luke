import { LEAD_ROW, LEAD_SLOT, LEAD_WORDS } from "../numbered-steps/lead-row.js";
import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

export function WaitingLine({ children }: { children: string }): React.JSX.Element {
  return (
    <div className={`ui-waiting-line ${LEAD_ROW}`}>
      <span className={LEAD_SLOT}>
        <Spinner label={children} size={SPINNER_SIZE.INLINE} delay={false} />
      </span>
      <div className={LEAD_WORDS}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} aria-hidden="true">
          {children}
        </Text>
      </div>
    </div>
  );
}
