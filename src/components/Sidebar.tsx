import React, { useState } from 'react';
import {
  Network,
  Sun,
  Moon,
  Key,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  BarChart3,
  GitBranch,
  Repeat,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  ExternalLink,
  Info
} from 'lucide-react';
import { AppSettings, SupportedLanguage } from '../types/chat';
import { UploadedConfigFile } from '../types/network';
import { ConfigUploader } from './ConfigUploader';
import { i18n } from '../utils/i18nData';
import { validateApiKey } from '../utils/geminiClient';

interface SidebarProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  uploadedFile: UploadedConfigFile | null;
  onFileLoaded: (file: UploadedConfigFile) => void;
  onRemoveFile: () => void;
  onOpenRawViewer: () => void;
  onQuickAction: (actionType: 'summary' | 'topology' | 'compare' | 'security') => void;
  onResetChat: () => void;
  isGenerating?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  settings,
  onUpdateSettings,
  uploadedFile,
  onFileLoaded,
  onRemoveFile,
  onOpenRawViewer,
  onQuickAction,
  onResetChat,
  isGenerating = false
}) => {
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState(settings.apiKey);
  const [isValidating, setIsValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);

  const t = i18n[settings.currentLanguage];
  const isDark = settings.theme === 'dark';

  const handleSaveAndValidateKey = async (keyToTest: string) => {
    if (!keyToTest.trim()) {
      onUpdateSettings({
        apiKey: '',
        apiKeyStatus: 'unset',
        apiErrorMessage: undefined
      });
      setValidationMsg(null);
      return;
    }

    setIsValidating(true);
    onUpdateSettings({ apiKeyStatus: 'validating' });
    const result = await validateApiKey(keyToTest);
    setIsValidating(false);

    if (result.valid) {
      onUpdateSettings({
        apiKey: keyToTest.trim(),
        apiKeyStatus: 'valid',
        apiErrorMessage: undefined
      });
      setValidationMsg(t.apiKeyStatusValid);
    } else {
      onUpdateSettings({
        apiKey: keyToTest.trim(),
        apiKeyStatus: 'invalid',
        apiErrorMessage: result.message
      });
      setValidationMsg(result.message);
    }
  };

  const getStatusIcon = () => {
    if (isValidating || settings.apiKeyStatus === 'validating') {
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />;
    }
    if (settings.apiKeyStatus === 'valid') {
      return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    }
    if (settings.apiKeyStatus === 'invalid') {
      return <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
    }
    return <Key className="w-3.5 h-3.5 text-slate-500" />;
  };

  return (
    <aside
      className={`flex flex-col h-full w-full md:w-[320px] shrink-0 border-r transition-colors select-none ${
        isDark
          ? 'bg-slate-900 border-slate-800 text-slate-200'
          : 'bg-slate-50/90 border-slate-200 text-slate-800'
      }`}
    >
      {/* Top Branding Header */}
      <div className={`p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-sky-400 text-white shadow-md shadow-cyan-500/20">
              <Network className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-extrabold text-base tracking-tight leading-none bg-gradient-to-r from-cyan-400 via-sky-300 to-white bg-clip-text text-transparent">
                  {t.appTitle}
                </h1>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  v1.2
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-tight font-medium">
                {t.appSubtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Global Controls: Language & Theme */}
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-800/60">
          {/* Language Switcher Segmented Toggle */}
          <div
            className={`flex items-center p-0.5 rounded-lg border text-xs font-semibold ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-200 border-slate-300'
            }`}
          >
            <button
              onClick={() => onUpdateSettings({ currentLanguage: 'TH' })}
              className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${
                settings.currentLanguage === 'TH'
                  ? isDark
                    ? 'bg-cyan-600 text-white shadow'
                    : 'bg-white text-blue-900 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TH (ไทย)
            </button>
            <button
              onClick={() => onUpdateSettings({ currentLanguage: 'EN' })}
              className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${
                settings.currentLanguage === 'EN'
                  ? isDark
                    ? 'bg-cyan-600 text-white shadow'
                    : 'bg-white text-blue-900 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              EN
            </button>
          </div>

          {/* Theme Switcher Toggle */}
          <button
            onClick={() => onUpdateSettings({ theme: isDark ? 'light' : 'dark' })}
            className={`flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
              isDark
                ? 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                : 'bg-slate-200 border-slate-300 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {isDark ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.themeLight}</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-600" />
                <span>{t.themeDark}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable Center Section */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Gemini API Key Section */}
        <div
          className={`p-3 rounded-xl border text-xs space-y-2 ${
            isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-slate-300">
              {getStatusIcon()}
              <span className={isDark ? 'text-slate-200' : 'text-slate-800'}>
                {t.apiKeyLabel}
              </span>
            </div>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                settings.apiKeyStatus === 'valid'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : settings.apiKeyStatus === 'invalid'
                  ? 'bg-rose-500/10 text-rose-400'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {settings.apiKeyStatus === 'valid'
                ? 'Active'
                : settings.apiKeyStatus === 'invalid'
                ? 'Error'
                : 'Offline Engine'}
            </span>
          </div>

          <div className="relative flex items-center">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onBlur={() => handleSaveAndValidateKey(keyInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveAndValidateKey(keyInput);
              }}
              placeholder={t.apiKeyPlaceholder}
              className={`w-full pr-14 pl-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors outline-none focus:ring-1 focus:ring-cyan-500 ${
                isDark
                  ? 'bg-slate-900 border-slate-700/80 text-slate-100 placeholder:text-slate-600'
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
              }`}
            />
            <div className="absolute right-1 flex items-center">
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title={showKey ? 'Hide Key' : 'Show Key'}
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {validationMsg && (
            <p
              className={`text-[10px] leading-tight ${
                settings.apiKeyStatus === 'valid'
                  ? 'text-emerald-400'
                  : settings.apiKeyStatus === 'invalid'
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {validationMsg}
            </p>
          )}

          <p className="text-[10px] text-slate-500 leading-tight">
            {t.apiKeyHelp}
          </p>
        </div>

        {/* Config File Uploader Area */}
        <div className="space-y-2">
          <label className={`block text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            {t.uploadTitle}
          </label>
          <ConfigUploader
            uploadedFile={uploadedFile}
            onFileLoaded={onFileLoaded}
            onRemoveFile={onRemoveFile}
            onOpenRawViewer={onOpenRawViewer}
            theme={settings.theme}
            language={settings.currentLanguage}
          />
        </div>

        {/* Quick Action Buttons (MVP Prompt Shortcuts) */}
        <div className="space-y-2 pt-2">
          <label className={`block text-xs font-bold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            {settings.currentLanguage === 'TH' ? 'คำสั่งด่วน (Quick Actions)' : 'Quick Action Shortcuts'}
          </label>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => onQuickAction('summary')}
              disabled={isGenerating}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isDark
                  ? 'border-cyan-500/30 bg-gradient-to-r from-cyan-950/40 to-slate-900 text-cyan-300 hover:border-cyan-400 hover:bg-cyan-900/30'
                  : 'border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100 hover:border-blue-300'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="truncate">
                <span className="block truncate">{t.summarizeButton}</span>
                <span className="text-[10px] font-normal opacity-70 block">
                  {settings.currentLanguage === 'TH' ? 'VLANs, IPs, Trunks & Routing' : 'VLANs, IPs, Trunks & Routing'}
                </span>
              </div>
            </button>

            <button
              onClick={() => onQuickAction('topology')}
              disabled={isGenerating}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isDark
                  ? 'border-sky-500/30 bg-gradient-to-r from-sky-950/40 to-slate-900 text-sky-300 hover:border-sky-400 hover:bg-sky-900/30'
                  : 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 hover:border-sky-300'
              }`}
            >
              <GitBranch className="w-4 h-4 text-sky-400 shrink-0" />
              <div className="truncate">
                <span className="block truncate">{t.topologyButton}</span>
                <span className="text-[10px] font-normal opacity-70 block">
                  {settings.currentLanguage === 'TH' ? 'สร้าง Mermaid.js Topology' : 'Render Mermaid.js Topology'}
                </span>
              </div>
            </button>

            <button
              onClick={() => onQuickAction('compare')}
              disabled={isGenerating}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isDark
                  ? 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Repeat className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="truncate">{t.compareButton}</span>
            </button>

            <button
              onClick={() => onQuickAction('security')}
              disabled={isGenerating}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isDark
                  ? 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">{t.securityAuditButton}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer: Reset Chat Session */}
      <div className={`p-4 border-t ${isDark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-white'}`}>
        <button
          onClick={onResetChat}
          className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
            isDark
              ? 'border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10'
              : 'border-slate-200 bg-slate-100 text-slate-600 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{t.resetChat}</span>
        </button>

        <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span>Cisco IOS ⇄ Huawei VRP</span>
          <span>Dual-Stack Engine</span>
        </div>
      </div>
    </aside>
  );
};
