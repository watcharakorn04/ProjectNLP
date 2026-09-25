import { useCallback, useEffect, useState } from 'react';
import type { ApiCredentials, AppSettings } from '../types/chat';
import { loadCredentials, saveCredentials } from '../services/apiKeyStorage';

const STORAGE_KEY_SETTINGS = 'netbot_settings_v1';
const LEGACY_STORAGE_KEY_SETTINGS = 'netconfig_ai_settings_v1';

type Preferences = Omit<AppSettings, 'credentials'>;

const DEFAULT_PREFERENCES: Preferences = { currentLanguage: 'EN', theme: 'dark' };

/**
 * Loads preferences (language, theme) from `localStorage` and the Groq key from `sessionStorage`.
 * Only known preference fields are read, so fields older versions stored here (a Gemini `apiKey`,
 * `preferredProvider`) are dropped when the settings are next written.
 */
function loadInitialSettings(): AppSettings {
  let preferences = DEFAULT_PREFERENCES;

  try {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS) ?? localStorage.getItem(LEGACY_STORAGE_KEY_SETTINGS);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Preferences>;
      preferences = {
        currentLanguage: parsed.currentLanguage === 'TH' ? 'TH' : 'EN',
        theme: parsed.theme === 'light' ? 'light' : 'dark'
      };
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY_SETTINGS);
  } catch {
    // ignore
  }

  return { ...preferences, credentials: loadCredentials() };
}

export function usePersistedSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadInitialSettings);

  useEffect(() => {
    const { credentials, ...preferences } = settings;
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(preferences));
    } catch {
      // ignore
    }
    saveCredentials(credentials);
  }, [settings]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const updateSettings = useCallback((patch: Partial<Preferences>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Merges into the credentials against the latest state, so async validations don't clobber each other. */
  const updateCredentials = useCallback((patch: Partial<ApiCredentials>) => {
    setSettings((prev) => ({ ...prev, credentials: { ...prev.credentials, ...patch } }));
  }, []);

  return { settings, updateSettings, updateCredentials };
}
