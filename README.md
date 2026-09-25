# NetBot — Cisco & Huawei Config Assistant

NetBot reads a Cisco IOS or Huawei VRP running configuration, turns it into structured data, and helps you understand it. It can summarise the config, draw the network topology, compare Cisco and Huawei CLI commands, and audit the config for security problems.

It runs entirely in the browser. Answers come from Groq when you provide a Groq API key, and from a built-in rule engine when you don't (or when the Groq request fails).

## Features

- **Config upload**: drag and drop or pick a `.txt`, `.cfg`, `.conf` or `.log` file (max 2 MB). Files without an extension, such as `running-config`, are accepted too. Three sample configs are bundled.
- **Vendor detection**: the Cisco IOS or Huawei VRP syntax is detected automatically, with a confidence score.
- **Structured parsing**: hostname, VLANs, interfaces (access, trunk and routed), SVI / Vlanif gateways, router-on-a-stick sub-interfaces, static routes (including VRF routes), ACLs (numbered / named, basic / advanced), NAT (static, dynamic, PAT / Easy IP, pools), and OSPF / BGP processes.
- **Quick actions**:
  - Summarize Config: always four sections in the same order (Executive Overview, Interface & Addressing table, Topology diagram, Security / Configuration Recommendations ranked High / Medium / Low).
  - Generate Topology
  - Compare Cisco ⇄ Huawei CLI
  - Config Security Audit: also checks broad ACL rules (`permit any any`), static NAT exposure, and OSPF / BGP neighbour authentication.
- **Streaming chat**: Groq replies stream in as they are generated. You can stop a reply partway through, and export the whole conversation as Markdown.
- **Answer-mode badge**: the chat header shows whether answers come from Groq (online) or from the offline engine.
- **Live topology canvas**: Mermaid diagrams are drawn as soon as a complete `mermaid` block arrives in a reply, and can be opened full screen.
- **Diagram export**: download any rendered diagram as SVG or PNG (`netbot-topology-YYYYMMDD.*`). PNGs are rendered at 2x scale on the current theme's background.
- **Offline fallback**: the Smart Rule Engine answers from the parsed config when there is no valid key, or when Groq fails before answering (for example a persistent HTTP 429 or 503). Its summary and audit include the parsed routing, NAT and ACL data. Questions about static routes, ACLs, NAT, OSPF or BGP ("show the NAT rules", "BGP neighbors") get tables built from the parsed config, and the topology diagram is drawn deterministically from SVIs, IP interfaces, trunks and default routes.
- **English / Thai UI and answers**, plus light and dark themes.

## Quick start

Requirements: Node.js 20 or newer (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:3000
```

Open the app and paste a Groq API key (`gsk_…`, from https://console.groq.com/keys) into the sidebar; it is validated when the field loses focus or you press Enter. Without a key, the app still works in offline mode.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server on port 3000 (listens on `0.0.0.0`) |
| `npm run build` | Builds for production into `dist/` |
| `npm run preview` | Serves the production build |
| `npm run lint` | Type-checks with `tsc --noEmit` |
| `npm test` | Runs the parser, offline diagram generator, Smart Rule Engine, config loader, diagram export, LLM, Groq client and offline engine unit tests (`node:test` via `tsx`) |
| `npm run test:parser` | Runs the `core/parser` tests only |

## Groq API key

- You enter the key in the sidebar at runtime. Keys that don't start with `gsk_` are rejected without a network call; others are validated with `GET /models`, which uses no tokens.
- Groq is called through its OpenAI-compatible chat completions API. It tries `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `openai/gpt-oss-120b` and `openai/gpt-oss-20b` in that order, moving to the next model when one is missing or not enabled for your key (HTTP 404 / `model_not_found`). Groq retired the Llama models for free and developer tiers on 2026-08-16, so free keys end up on gpt-oss. Models that failed are skipped for the rest of the session. Output is capped at 4096 tokens to fit the free tier's per-minute token limits.
- HTTP 429 and 503 are retried twice with backoff before the stream starts. If Groq still fails before sending any text, the Smart Rule Engine answers instead.
- The key is stored in `sessionStorage` only (`netbot_groq_key_v1`), so it is discarded when you close the tab. It is sent only in the `Authorization: Bearer` header, never in the URL, and it is removed from any error message shown in the UI.
- Before a config is sent to Groq, passwords, secrets, keys and SNMP communities in it are replaced with `<redacted>`.
- To save tokens, each ACL in the structured JSON sent to Groq is cut to its first 40 rules. The raw CLI that is also sent still contains every rule.
- Summary requests (the quick action, or a message that asks for a summary or overview) carry one short made-up Cisco and one Huawei example of the expected answer, and run at temperature 0.2.
- `.env.example` lists only `APP_URL`, because the project was created in Google AI Studio. The client code does not read it.

## How it works

```
file / sample ─▶ core/configLoader ─▶ core/parser (vendor-neutral JSON)
                                   └▶ utils/networkParser (legacy shape for the UI and offline engine)

user question / quick action
   ├─ valid key ─▶ core/llm/promptBuilder ─▶ services/groqService (SSE stream)
   │                                         └─ fails with no text ─▶ offline engine
   └─ no key ────▶ services/offlineEngine + offlineFeatures (rule-based Markdown + Mermaid,
                    via core/parser/smartRuleEngine + diagramGenerator)

reply text ─▶ core/llm/markdownFences ─▶ services/mermaidRenderer (strict mode) ─▶ topology canvas
                                                                                  └▶ services/diagramExport (SVG / PNG)
```

## Project structure

```
src/
├── App.tsx                 Top-level state, chat turn orchestration, Groq → offline fallback
├── components/             UI: Sidebar, ChatFeed, ChatMessageItem, ConfigUploader, TopologyCanvas, modals, toasts
├── core/                   Pure logic, no React or DOM (unit tested)
│   ├── configLoader.ts     Validates a file or sample and builds the UploadedConfigFile
│   ├── diagramExport.ts    File names and size calculations for diagram export
│   ├── parser/             Cisco IOS / Huawei VRP CLI parser → ExtractedNetworkConfig (interfaces, VLANs, routes, ACLs, NAT, OSPF / BGP),
│   │                       plus the offline topology generator and the feature-question tables (smartRuleEngine)
│   └── llm/                Prompt builder, secret redaction, SSE parser, OpenAI-format chunk decoder, Groq key checks, Markdown fences
├── hooks/                  Streaming, throttling, persisted settings, auto-scroll, toasts
├── services/               Groq client, API-key storage, offline engine, Mermaid renderer, diagram export
├── types/                  Shared chat, network and app types
└── utils/                  Vendor detector, legacy parser and diagram generator, i18n strings, sample configs
```

## Tech stack

React 19, TypeScript, Vite 8, Tailwind CSS 4, Mermaid 12, Motion, and lucide-react. The Groq API is called over plain `fetch`, with no SDK.
