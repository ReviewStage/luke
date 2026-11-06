import { createContext, useContext } from "react";

const OpenFileTabContext = createContext<((path: string) => void) | undefined>(undefined);

export const OpenFileTabProvider = OpenFileTabContext.Provider;

export function useOpenFileTab(): ((path: string) => void) | undefined {
  return useContext(OpenFileTabContext);
}
