import type { ApiCredentials } from '../../types/chat';

/** Every Groq API key starts with this prefix. */
export const GROQ_KEY_PREFIX = 'gsk_';

/**
 * Cheap format check run before any network call, so a key meant for another service
 * (e.g. an old Gemini `AIza…` key) is rejected locally and never sent to Groq.
 */
export function isGroqKeyFormat(apiKey: string): boolean {
  const key = apiKey.trim();
  return key.startsWith(GROQ_KEY_PREFIX) && key.length > GROQ_KEY_PREFIX.length;
}

/** True when a turn may go to Groq; otherwise the offline engine answers. */
export function hasVerifiedKey(credentials: ApiCredentials): boolean {
  return Boolean(credentials.apiKey) && credentials.status === 'valid';
}
