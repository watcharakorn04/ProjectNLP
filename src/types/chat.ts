import { VendorType } from './network';

export type SenderRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  sender: SenderRole;
  timestamp: string;
  text: string;
  diagramType?: 'mermaid' | 'ascii';
  diagramCode?: string;
  vendorTag?: VendorType;
  metadata?: {
    isTopologyPrompt?: boolean;
    isSummaryPrompt?: boolean;
    tokensUsed?: number;
    model?: string;
  };
}

export type SupportedLanguage = 'EN' | 'TH';
export type AppTheme = 'dark' | 'light';

export interface AppSettings {
  currentLanguage: SupportedLanguage;
  theme: AppTheme;
  apiKey: string;
  apiKeyStatus: 'unset' | 'validating' | 'valid' | 'invalid';
  apiErrorMessage?: string;
}
