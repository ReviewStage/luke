import { FILL_ELEMENT, Fill } from "@repo/ui";
import type { ReactNode, Ref } from "react";

export function AgentTabFrame({
  label,
  ref,
  children,
}: {
  label?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      ref={ref}
      className="agent-tab ph-no-capture"
      aria-label={label}
    >
      {children}
    </Fill>
  );
}

export function AgentTabFoot({ children }: { children: ReactNode }): React.JSX.Element {
  return <footer className="agent-tab-foot mt-auto flex-none">{children}</footer>;
}
