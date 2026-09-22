# Brave Bulk Submitter

A local-first dashboard for batching public website URLs into Brave Search through a visible browser workflow. Validate, review, submit, and retry without storing credentials or relying on an API.

## Why this exists

Brave Search provides a URL submission form at [`search.brave.com/submit-url`](https://search.brave.com/submit-url), but the workflow is one URL at a time. This app turns that repetitive process into a reviewable queue with explicit selection, visible progress, rate-aware pacing, and an activity log.

## What it does

- Loads URLs from pasted text or a `.txt` / `.csv` file.
- Normalizes bare domains to HTTPS and removes duplicates.
- Rejects non-HTTP URLs, embedded credentials, local hostnames, and non-public/special-use literal IP addresses, including IPv6.
- Opens a visible browser and submits each selected URL individually.
- Waits for Brave's success confirmation before moving to the next URL.
- Records ready, submitting, accepted, and failed states in the dashboard.
- Supports stopping after the current URL and retrying failed URLs.
- Runs loopback-only (`127.0.0.1`, `::1`, or `localhost`) and refuses non-local binds; queue activity stays in memory.

## Important boundary

This tool does not bypass or solve CAPTCHA / human-verification challenges. If Brave requires manual verification, complete it in the visible browser and retry the affected URL. Do not enter credentials into this app; it has no login flow and does not store passwords, cookies, or API keys.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm start
```

Open <http://127.0.0.1:3210>.

The queue starts empty. Paste URLs into the editor or import a `.txt` / `.csv` file, review the parsed list, and replace the queue.

### Optional Brave executable

By default, the app launches Playwright's Chromium. To use an installed Brave Browser executable instead, copy `.env.example` to `.env` and set `BRAVE_EXECUTABLE_PATH`.

Example Windows path:

```text
BRAVE_EXECUTABLE_PATH=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe
```

You can also change `SUBMISSION_DELAY_MS` and `VERIFICATION_TIMEOUT_MS` in `.env`. `HOST` may only be set to a loopback address or `localhost`; the server intentionally refuses network-facing binds.

## Tests and checks

```bash
npm test
npm run check
```

## Architecture

```text
src/server.js       Local HTTP server, API, in-memory run state, and static files
src/queue.js        URL normalization, validation, deduplication, queue records
src/submitter.js    Visible Playwright browser workflow for Brave's form
src/public/         Dashboard HTML, CSS, and browser-side controls
test/               Node built-in tests
```

The server exposes a small local API:

- `GET /api/state` returns queue, run, and activity state.
- `GET /api/events` streams live state updates over Server-Sent Events.
- `POST /api/sites` replaces the queue from `{ "input": "..." }`.
- `POST /api/run` starts selected records from `{ "siteIds": [] }`.
- `POST /api/run/stop` requests a safe stop.

## Private-first GitHub workflow

Keep the repository private while reviewing the implementation. Once GitHub CLI is installed and authenticated, create a private remote with:

```bash
gh repo create brave-bulk-submitter --private --source . --remote origin --push
```

Before making it public, review `.env` handling, README, commit metadata, and the security notes. Never commit `.env`, browser profiles, generated logs, or private URL lists.

## Repository description

> Local-first dashboard for batching public website URLs into Brave Search with validation, visible browser progress, pacing, and retry controls.

## License

MIT. See [`LICENSE`](./LICENSE).

