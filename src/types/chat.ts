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
    /** Which engine produced an assistant reply. */
    source?: 'gemini' | 'offline_engine';
    /** Error notices are shown to the user but excluded from the LLM chat history. */
    isError?: boolean;
    /** Gemini finish reason when it was not a normal `STOP` (e.g. `MAX_TOKENS`, `SAFETY`). */
    finishReason?: string;
  };
}

/** Assistant reply currently being generated (not yet part of the message list). */
export interface PendingReply {
  id: string;
  timestamp: string;
  vendorTag?: VendorType;
  /** Text received so far (throttled). */
  text: string;
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
