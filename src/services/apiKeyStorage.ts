import type { AppSettings } from '../types/chat';

/**
 * Gemini credentials live in `sessionStorage` only: they are scoped to this tab and
 * discarded when it closes, and are never written to `localStorage` with the other preferences.
 */

export type StoredCredentials = Pick<AppSettings, 'apiKey' | 'apiKeyStatus' | 'apiErrorMessage'>;

const SESSION_KEY = 'netbot_gemini_credentials_v1';

export const EMPTY_CREDENTIALS: StoredCredentials = { apiKey: '', apiKeyStatus: 'unset' };

export function loadCredentials(): StoredCredentials {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return EMPTY_CREDENTIALS;
    const parsed = JSON.parse(saved) as Partial<StoredCredentials>;
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    if (!apiKey) return EMPTY_CREDENTIALS;
    // A reload mid-validation leaves the key unverified; the user re-validates from the sidebar.
    const apiKeyStatus = parsed.apiKeyStatus === 'valid' || parsed.apiKeyStatus === 'invalid' ? parsed.apiKeyStatus : 'unset';
    return { apiKey, apiKeyStatus, apiErrorMessage: parsed.apiErrorMessage };
  } catch {
    return EMPTY_CREDENTIALS;
  }
}

export function saveCredentials(credentials: StoredCredentials): void {
  try {
    if (!credentials.apiKey) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
  } catch {
    // Storage unavailable (private mode / blocked): the key stays in memory for this page only.
  }
}
