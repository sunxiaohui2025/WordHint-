# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository layout

- `GOAL.md` — authoritative product spec, LLM API contract, and Definition of Done.
- `wordhint/` — Chrome Manifest V3 extension (no build step, load unpacked directly).
- `inslight/` — screenshot archive (not part of the extension).

No git, no package manager. Extension loads directly from `wordhint/`.

## Running the extension

`chrome://extensions` → Developer mode → "Load unpacked" → select `wordhint/`.

## Tests

Run from `wordhint/test/` with Node (ES modules, no framework):

```bash
node test/unit.mjs      # Pure logic tests against wordlist/data files
node test/verify.mjs    # Headed Chrome via puppeteer-core (hardcoded macOS path)
node test/e2e.mjs       # Connects to running Chrome at http://127.0.0.1:9223
```

`puppeteer-core` must be installed globally or in a parent `node_modules` for verify/e2e tests.

## Architecture (wordhint/)

MV3 extension with three core files:

| File | Role |
|------|------|
| `background.js` | Service worker: word library preload, filter logic, LLM API, selection translation |
| `content.js` | Content script: word extraction, ruby annotation injection, tooltips, mutation observer |
| `popup.html/js` | Settings UI: library checkboxes, whitelist/wordbook management, CSV export |

### Annotation pipeline

1. `content.js` extracts words from text nodes → sends `FILTER_WORDS` to background
2. `background.js` applies priority filter: **acronym skip → wordbook (force translate) → whitelist (skip) → selected library match → else skip**
3. Words with dict meanings annotated immediately; unknown words batched to LLM via `FETCH_MEANINGS`
4. Results rendered as `<ruby><rt>` overlays; hover/click shows tooltip with「我认识」「收藏」buttons

### Data files (`wordhint/data/`)

- **8 tiered libraries**: `compulsory`, `gaokao_diff`, `cet4_diff`, `cet6_diff`, `postgrad_diff`, `ielts_diff`, `toefl_diff`, `gre_diff`
- `word_library.json` — reverse index `word → libraryName`
- `word_dict.json` — `word → Chinese meaning` (in-memory, avoids LLM calls)

### LLM API contract

Configuration is stored in `.env` (not committed to git). See `.env.example` for template.

```bash
POST {BASE_URL}/{MODEL}/v1/chat/completions
Authorization: Bearer {API_KEY}
{
  "model": "{MODEL}",
  "messages": [...],
  "temperature": 0,
  "max_tokens": 300,
  "chat_template_kwargs": {"enable_thinking": false}  # REQUIRED
}
```

### Storage schema (`chrome.storage.local`)

| Key | Type | Description |
|-----|------|-------------|
| `selectedLibs` | string[] | Active library names |
| `enabled` | boolean | Extension on/off |
| `fontSize` | number | Annotation font size (px) |
| `whitelist` | string[] | "我认识" words (never annotate) |
| `wordbook` | object[] | {word, meaning, sentence, time} |

## Language

Respond in Chinese (中文), except for technical terms.

## UI style

Material Design (Google design language).

## Working style

- **Think before coding:** state assumptions; ask if unclear.
- **Simplicity first:** minimum code, no speculative features.
- **Surgical changes:** touch only what's needed; match existing style.
- **Goal-driven:** verify via tests or success criteria from `GOAL.md`.