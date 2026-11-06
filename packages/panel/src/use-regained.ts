import { useEffect, useRef } from "react";
import { useConnected } from "./connection.js";

export function useRegained(regained: () => void): void {
  const connected = useConnected();
  const latest = useRef(regained);
  latest.current = regained;
  const was = useRef(connected);
  useEffect(() => {
    const before = was.current;
    was.current = connected;
    if (connected && !before) latest.current();
  }, [connected]);
}
