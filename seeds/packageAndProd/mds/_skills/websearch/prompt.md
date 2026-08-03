# websearch — backends and params

`websearch` searches the web by query (discovery). After you have a link, use `webfetch` to read it.

## Backends

Two backends: `exa` and `parallel`. Selection is `auto` (default), from env, or forced via `provider`.

## Params

- `query` (required): search query. Include the year for current events.
- `numResults`: number of results (default 8, range 1-20).
- `type`: search depth — `auto` (default), `fast`, or `deep` (Exa).
- `livecrawl`: `fallback` (default) or `preferred` (Exa).
- `contextMaxCharacters`: max context chars for the LLM (default ~10000, Exa, range 500-50000).
- `provider`: force backend — `exa` or `parallel` (overrides env/A-B).

## Usage guidance

Use websearch when you do NOT have a URL. Once you have a link, use `webfetch` to read the actual content.
