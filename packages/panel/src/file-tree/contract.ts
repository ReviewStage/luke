export interface FolderEntry {
  readonly name: string;
  readonly folder: boolean;
}

export type FolderListing =
  | { readonly entries: readonly FolderEntry[]; readonly truncated: boolean }
  | { readonly notice: string; readonly retry: boolean };

export type ReadFolder = (path: string) => Promise<FolderListing>;

export const TREE_STANDING = {
  READING: "reading",
  DRAWN: "drawn",
  FAILED: "failed",
  NO_MATCH: "no-match",
} as const;

export type TreeStanding =
  | { readonly kind: typeof TREE_STANDING.READING }
  | {
      readonly kind: typeof TREE_STANDING.FAILED;
      readonly notice: string;
      readonly retry: boolean;
    }
  | {
      readonly kind: typeof TREE_STANDING.DRAWN | typeof TREE_STANDING.NO_MATCH;
      readonly cut: boolean;
    };

export const FILE_MARK = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;

export type FileMarkStatus = (typeof FILE_MARK)[keyof typeof FILE_MARK];

export interface FileMark {
  readonly path: string;
  readonly status: FileMarkStatus;
  readonly lines?: { readonly additions: number; readonly deletions: number } | undefined;
  readonly threads?: number | undefined;
  readonly viewed?: boolean | undefined;
}

export interface FileTreeProps {
  readonly readFolder: ReadFolder;
  readonly onStanding: (standing: TreeStanding) => void;
  readonly onOpen: (path: string, newTab: boolean) => void;
  readonly onViewed?: (path: string) => void;
  readonly onRows?: (rows: number) => void;
}

export interface RevealOptions {
  readonly focus: boolean;
}

export interface FileTreeHandle {
  readonly reveal: (path: string, options: RevealOptions) => void;
  readonly search: (query: string) => void;
  readonly only: (paths: readonly string[] | undefined) => void;
  readonly within: (entries: readonly FolderEntry[]) => void;
  readonly mark: (marks: readonly FileMark[]) => void;
  readonly relist: () => void;
  readonly unmount: () => void;
}

export interface FileTypeIcon {
  readonly symbol: string;
  readonly type: string;
}

export interface FileTreeModule {
  readonly mount: (host: HTMLElement, props: FileTreeProps) => FileTreeHandle;
  readonly fileIcon: (name: string) => FileTypeIcon;
}
