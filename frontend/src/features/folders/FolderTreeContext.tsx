import { createContext, useContext } from "react";

export interface FolderTreeContextValue {
  projectId: string;
  canWrite: boolean;
  selectedFolderId: string | null;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  renamingId: string | null;
  /** `undefined` = not creating; `null` = creating at the project root. */
  creatingParentId: string | null | undefined;
  inlineError: string | null;
  inlineBusy: boolean;
  select: (folderId: string | null) => void;
  submitRename: (id: string, name: string) => void;
  submitCreate: (name: string) => void;
  cancelInline: () => void;
  uploadInto: (folderId: string | null, files: File[]) => void;
}

export const FolderTreeContext = createContext<FolderTreeContextValue | null>(null);

export function useFolderTreeContext(): FolderTreeContextValue {
  const value = useContext(FolderTreeContext);
  if (!value) throw new Error("FolderTreeContext missing");
  return value;
}
