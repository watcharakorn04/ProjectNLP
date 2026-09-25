# NetBot — Cisco & Huawei Config Assistant

NetBot reads a Cisco IOS or Huawei VRP running configuration, turns it into structured data, and helps you understand it. It can summarise the config, draw the network topology, compare Cisco and Huawei CLI commands, and audit the config for security problems.

It runs entirely in the browser. Answers come from Google Gemini when you provide an API key, and from a built-in rule engine when you don't (or when Gemini fails).

## Features

- **Config upload**: drag and drop or pick a `.txt`, `.cfg`, `.conf` or `.log` file (max 2 MB). Files without an extension, such as `running-config`, are accepted too. Three sample configs are bundled.
- **Vendor detection**: the Cisco IOS or Huawei VRP syntax is detected automatically, with a confidence score.
- **Structured parsing**: hostname, VLANs, interfaces (access, trunk and routed), SVI / Vlanif gateways, router-on-a-stick sub-interfaces, and static routes (including VRF routes).
- **Quick actions**:
  - Summarize Config
  - Generate Topology
  - Compare Cisco ⇄ Huawei CLI
  - Config Security Audit
- **Streaming chat**: Gemini replies stream in as they are generated. You can stop a reply partway through.
- **Live topology canvas**: Mermaid diagrams are drawn as soon as a complete `mermaid` block arrives in a reply, and can be opened full screen.
- **Offline fallback**: the Smart Rule Engine answers from the parsed config when there is no key, the key is invalid, or a Gemini request fails.
- **English / Thai UI and answers**, plus light and dark themes.

## Quick start

Requirements: Node.js 20 or newer (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:3000
```

Open the app, paste a Gemini API key into the sidebar, and click validate. Without a key, the app still works in offline mode.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server on port 3000 (listens on `0.0.0.0`) |
| `npm run build` | Builds for production into `dist/` |
| `npm run preview` | Serves the production build |
| `npm run lint` | Type-checks with `tsc --noEmit` |
| `npm test` | Runs the parser, config loader and LLM unit tests (`node:test` via `tsx`) |
| `npm run test:parser` | Runs the parser tests only |

## Gemini API key

- You enter the key in the sidebar at runtime. It is validated with a small test request to `gemini-3.8-flash`.
- The key is stored in `sessionStorage` only, so it is discarded when you close the tab. It is sent only in the `x-goog-api-key` header (never in the URL), and it is removed from any error message shown in the UI.
- Before a config is sent to Gemini, passwords, secrets, keys and SNMP communities in it are replaced with `<redacted>`.
- `.env.example` lists `GEMINI_API_KEY` and `APP_URL` because the project was created in Google AI Studio. The client code does not currently read either variable.

## How it works

```
file / sample ─▶ core/configLoader ─▶ core/parser (vendor-neutral JSON)
                                   └▶ utils/networkParser (legacy shape for the UI and offline engine)

user question / quick action
   ├─ valid key ─▶ core/llm/promptBuilder ─▶ services/geminiService (SSE stream, retries on 429/503)
   │                                          └─ fails with no text ─▶ offline engine
   └─ no key ───▶ services/offlineEngine (rule-based Markdown + Mermaid)

reply text ─▶ core/llm/markdownFences ─▶ services/mermaidRenderer (strict mode) ─▶ topology canvas
```

## Project structure

```
src/
├── App.tsx                 Top-level state, chat turn orchestration, Gemini → offline fallback
├── components/             UI: Sidebar, ChatFeed, ChatMessageItem, ConfigUploader, TopologyCanvas, modals, toasts
├── core/                   Pure logic, no React or DOM (unit tested)
│   ├── configLoader.ts     Validates a file or sample and builds the UploadedConfigFile
│   ├── parser/             Cisco IOS / Huawei VRP CLI parser → ExtractedNetworkConfig
│   └── llm/                Prompt builder, secret redaction, SSE parser, Gemini chunk decoder, Markdown fences
├── hooks/                  Streaming, throttling, persisted settings, auto-scroll, toasts
├── services/               Gemini REST client, API-key storage, offline engine, Mermaid renderer
├── types/                  Shared chat, network and app types
└── utils/                  Vendor detector, legacy parser, diagram generator, i18n strings, sample configs
```

## Tech stack

React 19, TypeScript, Vite 8, Tailwind CSS 4, Mermaid 12, Motion, and lucide-react. The Gemini API is called over plain `fetch`, with no SDK.
