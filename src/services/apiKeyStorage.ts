import type { ApiCredentials } from '../types/chat';

/**
 * The Groq key lives in `sessionStorage` only: it is scoped to this tab and discarded when it
 * closes, and is never written to `localStorage` with the other preferences.
 */

const SESSION_KEY = 'netbot_groq_key_v1';
/** v2 held `{ gemini, groq }` credentials; only the Groq entry is carried over. */
const LEGACY_SESSION_KEY_V2 = 'netbot_llm_credentials_v2';
/** v1 held a single Gemini key, which NetBot no longer uses. */
const LEGACY_SESSION_KEY_V1 = 'netbot_gemini_credentials_v1';

export const EMPTY_CREDENTIALS: ApiCredentials = { apiKey: '', status: 'unset' };

function sanitize(value: unknown): ApiCredentials {
  const entry = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const { apiKey, status, errorMessage } = entry;
  if (typeof apiKey !== 'string' || !apiKey) return EMPTY_CREDENTIALS;
  return {
    apiKey,
    // A reload mid-validation leaves the key unverified; the user re-validates from the sidebar.
    status: status === 'valid' || status === 'invalid' ? status : 'unset',
    errorMessage: typeof errorMessage === 'string' ? errorMessage : undefined
  };
}

export function loadCredentials(): ApiCredentials {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return sanitize(JSON.parse(saved));

    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY_V2);
    if (legacy) return sanitize((JSON.parse(legacy) as Record<string, unknown> | null)?.groq);
  } catch {
    // Unreadable or blocked storage: start without a key.
  }
  return EMPTY_CREDENTIALS;
}

/** Saves the Groq credentials and drops every legacy entry, including any stored Gemini key. */
export function saveCredentials(credentials: ApiCredentials): void {
  try {
    sessionStorage.removeItem(LEGACY_SESSION_KEY_V1);
    sessionStorage.removeItem(LEGACY_SESSION_KEY_V2);
    if (!credentials.apiKey) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
  } catch {
    // Storage unavailable (private mode / blocked): the key stays in memory for this page only.
  }
}
