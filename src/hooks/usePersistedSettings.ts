import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '../types/chat';
import { loadCredentials, saveCredentials, StoredCredentials } from '../services/apiKeyStorage';

const STORAGE_KEY_SETTINGS = 'netbot_settings_v1';
const LEGACY_STORAGE_KEY_SETTINGS = 'netconfig_ai_settings_v1';

type Preferences = Omit<AppSettings, keyof StoredCredentials>;

const DEFAULT_PREFERENCES: Preferences = { currentLanguage: 'EN', theme: 'dark' };

/**
 * Loads settings from two stores: preferences (language, theme) from `localStorage`,
 * credentials from `sessionStorage`. Earlier versions kept the API key in `localStorage`;
 * such a key is moved into the session store and scrubbed from `localStorage`.
 */
function loadInitialSettings(): AppSettings {
  let preferences = DEFAULT_PREFERENCES;
  let credentials = loadCredentials();

  try {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS) ?? localStorage.getItem(LEGACY_STORAGE_KEY_SETTINGS);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<AppSettings>;
      preferences = {
        currentLanguage: parsed.currentLanguage === 'TH' ? 'TH' : 'EN',
        theme: parsed.theme === 'light' ? 'light' : 'dark'
      };
      if (!credentials.apiKey && typeof parsed.apiKey === 'string' && parsed.apiKey.trim()) {
        credentials = { apiKey: parsed.apiKey.trim(), apiKeyStatus: parsed.apiKeyStatus === 'valid' ? 'valid' : 'unset' };
      }
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY_SETTINGS);
  } catch {
    // ignore
  }

  return { ...preferences, ...credentials };
}

export function usePersistedSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadInitialSettings);

  useEffect(() => {
    const { apiKey, apiKeyStatus, apiErrorMessage, ...preferences } = settings;
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(preferences));
    } catch {
      // ignore
    }
    saveCredentials({ apiKey, apiKeyStatus, apiErrorMessage });
  }, [settings]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, updateSettings };
}
