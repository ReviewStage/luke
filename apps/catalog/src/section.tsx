import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
import type { ReactNode } from "react";

export function CatalogSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="catalog-section" aria-labelledby={id}>
      <Text
        as={TEXT_ELEMENT.H2}
        variant={TEXT_VARIANT.SECTION}
        id={id}
        className="catalog-section-title"
      >
        {title}
      </Text>
      {children}
    </section>
  );
}
