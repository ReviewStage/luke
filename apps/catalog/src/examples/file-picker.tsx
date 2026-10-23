import { Button, GAP, IconButton, ImageIcon, Stack, useFilePicker } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * file-picker.tsx -- the system's file picker opened from a button and from an icon button, one
 * taking many images, one taking a single file, each saying what it was handed.
 */

function Picks(): React.JSX.Element {
  const [said, setSaid] = useState("Nothing picked yet");
  const note = (files: readonly File[]) =>
    setSaid(files.length === 0 ? "Nothing picked" : files.map((file) => file.name).join(", "));
  const images = useFilePicker({ accept: "image/*", multiple: true, onFiles: note });
  const single = useFilePicker({ onFiles: note });
  return (
    <Stack gap={GAP.CONTROL} align="start">
      <Button onClick={images.open}>Choose images</Button>
      <IconButton icon={<ImageIcon />} label="Attach screenshot" onClick={single.open} />
      {images.input}
      {single.input}
      <span>{said}</span>
    </Stack>
  );
}

function FilePickers(): React.JSX.Element {
  return (
    <CatalogSection id="file-picker-buttons" title="From a button">
      <Picks />
    </CatalogSection>
  );
}

export const FILE_PICKERS_EXAMPLE: Example = {
  id: "file-pickers",
  title: "File pickers",
  Render: FilePickers,
};
