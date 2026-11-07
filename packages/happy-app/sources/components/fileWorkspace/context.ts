import * as React from 'react';
import type { FileWorkspaceController, FileWorkspaceSnapshot } from './controller';
export type FileReference = { path: string; hash: string; quote?: string };
export type FileWorkspaceContextValue = {
    draftCacheError: boolean;
    enabled: boolean; root: string; controller: FileWorkspaceController; snapshot: FileWorkspaceSnapshot;
    reference: FileReference | null; setReference: React.Dispatch<React.SetStateAction<FileReference | null>>;
    openReference: (path: string) => Promise<void>;
    chatWidth: number; setChatWidth: (width: number) => void;
    maximized: boolean; setMaximized: (value: boolean) => void;
};
export const FileWorkspaceContext = React.createContext<FileWorkspaceContextValue | null>(null);
export const useFileWorkspace = () => React.useContext(FileWorkspaceContext);
