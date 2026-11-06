import { PRODUCT_NAME } from "@repo/features/product-name";
import type { Workspace } from "@repo/features/workspace-wire";
import { useEffect } from "react";

export function windowTitle(input: {
  readonly signedIn: boolean;
  readonly subject: string | undefined;
  readonly workspace: Pick<Workspace, "name"> | undefined;
}): string {
  if (!input.signedIn) return PRODUCT_NAME;
  if (input.workspace === undefined) return input.subject ?? PRODUCT_NAME;
  return input.subject === undefined
    ? input.workspace.name
    : `${input.subject} — ${input.workspace.name}`;
}

export function useWindowTitle(input: Parameters<typeof windowTitle>[0]): void {
  const title = windowTitle(input);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
