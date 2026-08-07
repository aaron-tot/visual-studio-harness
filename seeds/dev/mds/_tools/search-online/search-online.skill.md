# searchOnline — web search & fetch

The `searchOnline` tool works with the web via an `action`.

## Actions

- `search` — Search the web by query (discovery). Params: `query` (required), `numResults` (1-20, default 8),
  `type` (auto|fast|deep), `livecrawl` (fallback|preferred), `contextMaxCharacters`, `provider` (exa|parallel).
- `fetch` — Fetch a known URL as markdown/text/html. Params: `url` (http/https), `format` (markdown|text|html, default markdown), `timeout`.

## Backends

- `exa` and `parallel`. Selection is `auto` (default), from env, or forced via `provider`.

## Guidance

- Use `search` when you do NOT have a URL; once you have a link, use `fetch` to read the actual content.
- Include the current year in search queries for current events.
