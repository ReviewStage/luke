import { useState } from "react";

export interface BusyPress {
  busy: boolean;
  onPress: () => void;
}

export function useBusyPress(press: () => unknown): BusyPress {
  const [busy, setBusy] = useState(false);
  const onPress = () => {
    const started = press();
    if (!(started instanceof Promise)) return;
    setBusy(true);
    const settle = () => setBusy(false);
    started.then(settle, settle);
  };
  return { busy, onPress };
}
