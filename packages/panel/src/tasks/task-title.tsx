import { PageHeader, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
import { UNIT_ATTRIBUTED_CLASS } from "./description-unit-look.js";

export function TaskTitle({
  name,
  actions,
}: {
  name: string;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`task-title ${UNIT_ATTRIBUTED_CLASS}`}>
      <PageHeader title={name} actions={actions} />
    </div>
  );
}

export function TextTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="task-title">
      <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.P}>
        {name}
      </Text>
    </div>
  );
}
