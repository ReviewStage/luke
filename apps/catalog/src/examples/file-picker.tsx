import {
  ALIGN,
  Button,
  GAP,
  IconButton,
  ImageIcon,
  PhotoPick,
  Stack,
  useFilePicker,
} from "@repo/ui";
import { useEffect, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function Picks(): React.JSX.Element {
  const [said, setSaid] = useState("Nothing picked yet");
  const note = (files: readonly File[]) =>
    setSaid(files.length === 0 ? "Nothing picked" : files.map((file) => file.name).join(", "));
  const images = useFilePicker({ accept: "image/*", multiple: true, onFiles: note });
  const single = useFilePicker({ onFiles: note });
  return (
    <Stack gap={GAP.CONTROL} align={ALIGN.START}>
      <Button onClick={images.open}>Choose images</Button>
      <IconButton icon={<ImageIcon />} label="Attach screenshot" onClick={single.open} />
      {images.input}
      {single.input}
      <span>{said}</span>
    </Stack>
  );
}

function Photo({ name }: { name: string }): React.JSX.Element {
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const picker = useFilePicker({
    accept: "image/*",
    onFiles: ([picked]) => {
      if (picked !== undefined) setPhoto(URL.createObjectURL(picked));
    },
  });
  useEffect(
    () => () => {
      if (photo !== undefined) URL.revokeObjectURL(photo);
    },
    [photo],
  );
  return <PhotoPick name={name} unnamed="Workspace" photo={photo} picker={picker} />;
}

function FilePickers(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="file-picker-buttons" title="From a button">
        <Picks />
      </CatalogSection>
      <CatalogSection id="file-picker-photo" title="A photo for something named">
        <Stack gap={GAP.FIELD} align={ALIGN.START}>
          <Photo name="" />
          <Photo name="Acme" />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const FILE_PICKERS_EXAMPLE: Example = {
  id: "file-pickers",
  title: "File pickers",
  Render: FilePickers,
};
