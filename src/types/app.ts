import { AppSettings, ChatMessage } from './chat';
import { UploadedConfigFile } from './network';

/** Aggregate of the state held in `App.tsx` (currently spread across individual `useState` hooks). */
export interface AppState {
  settings: AppSettings;
  uploadedFile: UploadedConfigFile | null;
  messages: ChatMessage[];
  isGenerating: boolean;
  isRawModalOpen: boolean;
  fullscreenDiagramCode: string | null;
  isMobileSidebarOpen: boolean;
}
