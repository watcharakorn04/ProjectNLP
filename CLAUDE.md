# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

NetBot is a browser-only React 19 + TypeScript + Vite app. It parses Cisco IOS / Huawei VRP running configs and answers questions about them using Gemini (streamed over REST), with a rule-based offline engine as the fallback. The UI and answers are available in English and Thai. See [README.md](README.md) for the user-facing overview.

## Commands

```bash
npm run dev          # Vite on :3000
npm run lint         # tsc --noEmit (the only static check; there is no ESLint)
npm test             # node:test via tsx: parser, configLoader, llm
npm run test:parser  # parser tests only
npm run build
```

- Run `npm run lint` and `npm test` after changes. Both must stay clean.
- New test files are **not** picked up automatically. Add them to the `test` script in `package.json`.
- The shell is Windows. `npm run clean` uses `rm -rf` and only works from Git Bash.

## Architecture

- **`src/core/`** is pure logic: no React, no DOM, no `fetch`. Anything testable belongs here, and every module in it has tests next to it (`*.test.ts`).
  - `parser/`: `parseNetworkConfig(raw, vendorHint?)` → `ExtractedNetworkConfig`. `vendorParsers.ts` holds the per-vendor parsers, which split the config into sections via `splitSections`. `cliParser.ts` handles vendor resolution, SVI / sub-interface gateway extraction, and warnings. When nothing is detected, it defaults to Cisco IOS with confidence 0.
  - `configLoader.ts`: file validation (extension, 2 MB limit) and `loadConfigSource()` → `UploadedConfigFile`.
  - `llm/`: `promptBuilder.ts` (system prompt, quick-action tasks, `redactSecrets`, history trimming, `buildGeminiRequest`), `sseParser.ts`, `geminiProtocol.ts` (wire types + tolerant chunk decoder), and `markdownFences.ts` (Mermaid extraction from partial streams).
- **`src/services/`** holds the side-effecting code:
  - `geminiService.ts`: `fetch` + SSE streaming, `GeminiError` kinds, and retries on 429/503 before the stream starts. It strips `thinkingConfig` for models older than 2.5.
  - `apiKeyStorage.ts`: key persistence in `sessionStorage`.
  - `offlineEngine.ts`: rule-based replies.
  - `mermaidRenderer.ts`: serialised renders with `securityLevel: 'strict'`.
- **`src/hooks/`**: `useGeminiStream` (one stream at a time, abortable, never rejects), `useThrottledStream`, `usePersistedSettings`, `useSmartAutoScroll`, and `useToasts`.
- **`src/App.tsx`** owns all app state. In `runAssistantTurn`, Gemini is used only when the key status is `valid` and the action has the config it needs. If Gemini fails before producing any text, the offline engine answers instead.

### Two config shapes coexist

`UploadedConfigFile` carries both:
- `extractedConfig` (`core/parser`, the newer vendor-neutral shape), and
- `parsedData` (`utils/networkParser.ts`, the legacy `ParsedNetworkConfig`).

The offline engine, `utils/diagramGenerator.ts` and some UI code still read `parsedData`. The prompt builder sends both to Gemini. Don't delete the legacy parser without migrating those consumers.

## Conventions and invariants

- **Security**:
  - The API key goes only in the `x-goog-api-key` header, with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`.
  - Pass any error text shown to the user through `redactApiKey`.
  - Never store the key in `localStorage`. Preferences go in `localStorage` (`netbot_settings_v1`), the key in `sessionStorage`.
- **Prompting**:
  - Config data is sent to the model inside `<parsed_config_json>` / `<raw_cli>` tags, and only in the final user turn.
  - Raw CLI must go through `redactSecrets` and be capped at `MAX_RAW_CONFIG_CHARS`.
- **Mermaid**:
  - LLM-produced diagrams are untrusted. Always render them through `services/mermaidRenderer.ts`, never by calling `mermaid.render` directly.
- **i18n**:
  - UI strings live in `utils/i18nData.ts` (`EN` / `TH`). Quick-action labels live in `QUICK_ACTION_LABELS`.
  - When adding user-visible text, add both languages.
- **Storage keys**:
  - Storage keys are versioned (`_v1`, `_v2`). Legacy `netconfig_ai_*` keys are read for migration.
- **Style**:
  - Match the existing style: 2-space indent, single quotes, and short JSDoc on exported functions explaining *why*.
  - Discriminated-union results are used instead of exceptions (for example `ConfigLoadResult`, `MermaidRenderResult`).
- **Model**:
  - The model is set by `GEMINI_MODEL` in `services/geminiService.ts`.

## Gotchas

- Nothing reads `GEMINI_API_KEY` / `APP_URL` from `.env.example`; the key is entered in the sidebar.
- `express`, `dotenv` and `@google/genai` are listed as dependencies but never imported.
- `vite.config.ts` disables HMR when `DISABLE_HMR=true` (an AI Studio setting). Leave that block as is.
- `@/*` is aliased to the repo root, not `src/`.
