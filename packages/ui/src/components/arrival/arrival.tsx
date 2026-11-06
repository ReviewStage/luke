import { type ReactNode, useState } from "react";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";

export function Arrival({
  reading,
  label,
  children,
}: {
  reading: boolean;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  const [waited, setWaited] = useState(reading);
  if (reading && !waited) setWaited(true);
  if (reading) {
    return (
      <p className="ui-arrival-wait" role="status">
        <SpinnerRing size={SPINNER_SIZE.SMALL} />
        <span>{label}</span>
      </p>
    );
  }
  return (
    <div className="ui-arrival" data-waited={waited ? "" : undefined}>
      {children}
    </div>
  );
}
