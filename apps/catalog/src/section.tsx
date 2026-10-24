import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "@luke/ui";
import type { ReactNode } from "react";

/**
 * section.tsx -- one titled group of samples within an example. Its heading
 * wears a class of its own, so the catalog's page rules never reach a shared
 * component an example draws as a heading.
 */
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
