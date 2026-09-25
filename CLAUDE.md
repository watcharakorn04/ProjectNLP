# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

NetBot is a browser-only React 19 + TypeScript + Vite app. It parses Cisco IOS / Huawei VRP running configs and answers questions about them using Groq, its only LLM provider (OpenAI-compatible chat completions streamed over REST), with a rule-based offline engine as the fallback. The UI and answers are available in English and Thai. See [README.md](README.md) for the user-facing overview.

## Commands

```bash
npm run dev          # Vite on :3000
npm run lint         # tsc --noEmit (the only static check; there is no ESLint)
npm test             # node:test via tsx: parser, configLoader, diagramExport, llm, Groq client + key storage, offline engine
npm run test:parser  # parser tests only
npm run build
```

- Run `npm run lint` and `npm test` after changes. Both must stay clean.
- New test files are **not** picked up automatically. Add them to the `test` script in `package.json`.
- The shell is Windows. `npm run clean` uses `rm -rf` and only works from Git Bash.

## Architecture

- **`src/core/`** is pure logic: no React, no DOM, no `fetch`. Anything testable belongs here, and every module in it has tests next to it (`*.test.ts`). `services/groqService.test.ts` covers the Groq client and key storage against a mocked `fetch` / `sessionStorage`.
  - `parser/`: `parseNetworkConfig(raw, vendorHint?)` → `ExtractedNetworkConfig`. `vendorParsers.ts` holds the per-vendor parsers, which split the config into sections via `splitSections`; they delegate ACLs, NAT and OSPF / BGP to `aclParser.ts`, `natParser.ts` and `routingParser.ts` (one Cisco and one Huawei function each). `cliParser.ts` handles vendor resolution, SVI / sub-interface gateway extraction, and warnings. When nothing is detected, it defaults to Cisco IOS with confidence 0.
  - `mockData.ts` fixtures are golden: `cliParser.test.ts` deep-equals them against real parser output, so a parser change that alters output must update them.
  - Indented `!` / `#` lines do not close a section (both vendors print them inside BGP blocks).
  - `configLoader.ts`: file validation (extension, 2 MB limit) and `loadConfigSource()` → `UploadedConfigFile`. `hasExtractedContent` counts ACLs, NAT rules and routing processes too, so an ACL- or BGP-only config is not treated as empty.
  - `diagramExport.ts`: pure helpers for diagram download (file name, SVG size from `viewBox`, PNG canvas size at `PNG_SCALE` capped at `MAX_CANVAS_SIDE`).
  - `llm/`: `promptBuilder.ts` (system prompt, quick-action tasks, `redactSecrets`, history trimming, `buildChatRequest`), `sseParser.ts`, `openaiProtocol.ts` (wire types, `FINISH_REASON`, tolerant chunk decoder), `groqKey.ts` (`isGroqKeyFormat`, `hasVerifiedKey`), and `markdownFences.ts` (Mermaid extraction from partial streams).
  - `buildChatRequest` returns a `ChatRequestBody` (`messages` with the system prompt first, `temperature`, `max_completion_tokens`); `groqService` adds `model`, `stream` and per-model params. Finish reasons are OpenAI's raw values (`stop`, `length`, `content_filter`). Temperature is 0.2 for `summary` / `topology`, otherwise 0.4.
  - The system prompt always includes the network summary format: four `###` sections with the exact headings in `SUMMARY_SECTIONS` (per language) and a fixed Interface & Addressing table header. The Thai prompt adds formal-register style rules. The few-shot examples (`buildSummaryExamples`, one made-up Cisco and one Huawei device, about 1–1.5k tokens) are attached only when `wantsNetworkSummary` holds: the `summary` action, or free text matching summary / overview / สรุป / ภาพรวม.
- **`src/services/`** holds the side-effecting code:
  - `llmHttp.ts`: HTTP plumbing for the Groq client: `LlmError` kinds, `redactApiKey`, `fetchWithRetry` (retries on 429/503 before the stream starts; `maxRetries` is configurable), `readSseEvents`.
  - `groqService.ts`: the only LLM client. Streaming, `[DONE]` handling, key validation via `GET /models` (non-`gsk_` keys are rejected without a request). Tries `GROQ_MODELS` in order, moving on only for unavailable-model errors (404, `model_not_found`, `model_decommissioned`) and remembering failures per key. gpt-oss models get `reasoning_effort: 'low'` and `include_reasoning: false`.
  - `apiKeyStorage.ts`: Groq key persistence in `sessionStorage` (`netbot_groq_key_v1`). It migrates the Groq entry of `netbot_llm_credentials_v2` and deletes that key and `netbot_gemini_credentials_v1`.
  - `offlineEngine.ts`: rule-based replies. Routing / NAT / ACL sections and evidence-based audit checks (`permit any any`, static NAT exposure, OSPF / BGP authentication reminders, no ACLs) come from `extractedConfig` via `offlineFeatures.ts`. `generateSummaryMarkdown`'s `detailSections` argument swaps the legacy routing list / ACL count for those sections.
  - `mermaidRenderer.ts`: serialised renders with `securityLevel: 'strict'`. `renderMermaid(code, theme, { htmlLabels })`: HTML labels are the default; `htmlLabels: false` gives plain SVG `<text>` labels.
  - `diagramExport.ts`: `exportDiagramSvg` / `exportDiagramPng` (both return `DiagramExportResult`). The SVG is re-serialised as XML with an absolute size and the theme background painted in. If drawing it to a canvas fails (`<foreignObject>` taints the canvas in some browsers), the PNG export re-renders with `htmlLabels: false`.
- **`src/hooks/`**: `useLlmStream` (one Groq stream at a time, abortable, never rejects), `useThrottledStream`, `usePersistedSettings` (`updateSettings` for language/theme, `updateCredentials` for the Groq key), `useSmartAutoScroll`, and `useToasts`.
- **`src/App.tsx`** owns all app state. `runAssistantTurn` is a two-step chain: **Groq → offline engine**. It streams from Groq when `hasVerifiedKey` holds and the action has the config it needs; otherwise the offline engine answers directly. If Groq fails before producing any text (after `fetchWithRetry`'s default retries), the offline engine answers with a notice. Partial text followed by an error is kept with a warning note.
- The Sidebar has a single "Groq API Key" field; there is no provider toggle. The `ChatFeed` header shows an online / offline badge (`hasVerifiedKey`) and exports the chat as Markdown; `MermaidViewer` has the PNG / SVG export buttons.

### Two config shapes coexist

`UploadedConfigFile` carries both:
- `extractedConfig` (`core/parser`, the newer vendor-neutral shape), and
- `parsedData` (`utils/networkParser.ts`, the legacy `ParsedNetworkConfig`).

`utils/diagramGenerator.ts`, some UI code and most of the offline engine still read `parsedData`. The prompt builder sends both to Groq. Don't delete the legacy parser without migrating those consumers.

## Conventions and invariants

- **Security**:
  - The Groq key goes only in the `Authorization: Bearer` header, with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'` (see `requestInit` in `llmHttp.ts`).
  - Check `isGroqKeyFormat` before sending a key anywhere, so keys for other services never reach Groq.
  - Pass any error text shown to the user through `redactApiKey`.
  - Never store keys in `localStorage`. Preferences (language, theme) go in `localStorage` (`netbot_settings_v1`), the key in `sessionStorage`.
- **Prompting**:
  - Config data is sent to the model inside `<parsed_config_json>` / `<raw_cli>` tags, and only in the final user turn.
  - Raw CLI must go through `redactSecrets` and be capped at `MAX_RAW_CONFIG_CHARS`.
  - `compactForPrompt` caps each ACL in the JSON at `MAX_PROMPT_ACL_RULES` (40) and sets `omittedRules`; the raw CLI still has every rule.
  - Few-shot examples go inside `<example>` tags, and the system prompt marks them as made-up. Keep them small, since they count against the free tier's token budget. If you change a summary heading, update `SUMMARY_SECTIONS` so the format and the examples stay in sync.
- **Mermaid**:
  - LLM-produced diagrams are untrusted. Always render them through `services/mermaidRenderer.ts`, never by calling `mermaid.render` directly.
- **i18n**:
  - UI strings live in `utils/i18nData.ts` (`EN` / `TH`). Quick-action labels live in `QUICK_ACTION_LABELS`.
  - When adding user-visible text, add both languages.
- **Storage keys**:
  - Storage keys are versioned (`_v1`, `_v2`). Legacy `netconfig_ai_*` keys are read for migration; legacy Gemini entries are deleted, not migrated.
- **Style**:
  - Match the existing style: 2-space indent, single quotes, and short JSDoc on exported functions explaining *why*.
  - Discriminated-union results are used instead of exceptions (for example `ConfigLoadResult`, `MermaidRenderResult`).
- **Model**:
  - Models are set by the ordered `GROQ_MODELS` chain in `services/groqService.ts`; `GROQ_MODEL` is its first entry. Groq retires models often; check https://console.groq.com/docs/deprecations before changing the chain.
  - The completion budget is `MAX_OUTPUT_TOKENS` (4096) in `promptBuilder.ts`, sized for the free tier's tokens-per-minute limits.

## Gotchas

- Gemini support was removed. Adding a second provider again means reintroducing a provider abstraction (request translation, per-provider credentials, fallback order).
- Nothing reads `APP_URL` from `.env.example`; the Groq key is entered in the sidebar.
- `express` and `dotenv` are listed as dependencies but never imported.
- `vite.config.ts` disables HMR when `DISABLE_HMR=true` (an AI Studio setting). Leave that block as is.
- `@/*` is aliased to the repo root, not `src/`.
