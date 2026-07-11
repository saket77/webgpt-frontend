# WebGPT Cloud Service

Hosted control plane for async WebGPT browser runs.

V0 exposes a small Cloud Run API and uses Browserbase as the first browser
execution backend. Browserbase is intentionally modeled as
`execution: "browserbase"` so future runners such as local Playwright or the
extension can share the same run shape.

The built-in IPO routine uses a deterministic-first strategy: it reads the
InvestorGain JSON endpoint directly, extracts open Mainboard IPO rows with
subscription over `10x` and GMP at least `50%`, and falls back to Browserbase
only if that deterministic fetch/parsing path fails.

## Run

```bash
npm run cloud:service
```

Defaults:

- `WEBGPT_CLOUD_PORT=3100`
- `WEBGPT_BACKEND_URL=http://localhost:3000`
- SQLite database: `apps/webgpt-cloud-service/data/cloud-runs.sqlite`

If `WEBGPT_CLOUD_ADMIN_TOKEN` is omitted, the service binds to `127.0.0.1`.
When `NODE_ENV=production`, `WEBGPT_CLOUD_ADMIN_TOKEN` is required.

Routine scheduling runs in the same service process. V0 supports daily schedules
with an IANA timezone, for example `09:00 Asia/Kolkata`.

## API

Create an async run:

```bash
curl -X POST http://127.0.0.1:3100/cloud-runs \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://www.investorgain.com/report/ipo-gmp-live/331/all/",
    "goal": "Filter IPOs by open and then extract the subscription and GMP",
    "mode": "webgpt",
    "execution": "browserbase"
  }'
```

Fetch status and result:

```bash
curl http://127.0.0.1:3100/cloud-runs/<id>
```

While a run is active, the response includes live Browserbase URLs plus a
compact `progress` object:

```json
{
  "status": "running",
  "liveViewUrl": "https://www.browserbase.com/devtools-fullscreen/...",
  "progress": {
    "message": "Planner selected extract",
    "updatedAt": "2026-07-06T12:35:30.000Z",
    "eventsMode": "compact",
    "events": [
      {
        "kind": "session_ready",
        "message": "Browserbase session ready.",
        "createdAt": "2026-07-06T12:35:19.590Z"
      }
    ]
  }
}
```

Raw planner/debug event payloads stay stored in SQLite, but are hidden from the
default polling response. Request them only when investigating a run:

```bash
curl "http://127.0.0.1:3100/cloud-runs/<id>?events=full"
curl "http://127.0.0.1:3100/cloud-runs/<id>?events=none"
curl "http://127.0.0.1:3100/cloud-runs/<id>?eventLimit=5"
```

Health:

```bash
curl http://127.0.0.1:3100/health
```

## Routines

Routines are saved wrappers around CloudRuns:

```text
RoutineTemplate -> Routine -> RoutineTrigger -> CloudRun -> Notification
```

Templates are code-defined product recipes. V0 includes:

```bash
curl http://127.0.0.1:3100/routine-templates
```

The `ipo_gmp_daily` template is tuned for the daily IPO email workflow:

- source: InvestorGain Mainboard IPO GMP report
- deterministic filter: Open + Mainboard + subscription `> 10x` + GMP `>= 50%`
- fallback: Browserbase WebGPT run with the same goal when the API path fails
- email: matching rows are rendered first, followed by the JSON result preview

Create a routine from the IPO template:

```bash
curl -X POST http://127.0.0.1:3100/routines \
  -H 'content-type: application/json' \
  -d '{
    "templateId": "ipo_gmp_daily",
    "name": "Mom IPO tracker",
    "enabled": true,
    "schedule": {
      "type": "daily",
      "time": "09:00",
      "timezone": "Asia/Kolkata"
    },
    "notification": {
      "type": "email",
      "to": ["mom@example.com"]
    }
  }'
```

Trigger a routine immediately:

```bash
curl -X POST http://127.0.0.1:3100/routines/<routine_id>/trigger
```

Inspect routine history:

```bash
curl http://127.0.0.1:3100/routines/<routine_id>/triggers
```

Email notifications are routine-only in V0. Supported providers:

- `console`: logs the email payload locally.
- `gmail_api`: sends through Gmail API over HTTPS with an OAuth refresh token.

Provider selection uses `WEBGPT_EMAIL_PROVIDER` when set. Otherwise it uses
`gmail_api` when Gmail credentials are present, and `console` as the fallback.

Gmail API test:

```bash
WEBGPT_EMAIL_PROVIDER=gmail_api \
GMAIL_CLIENT_ID='...' \
GMAIL_CLIENT_SECRET='...' \
GMAIL_REFRESH_TOKEN='...' \
WEBGPT_EMAIL_FROM='Saket Mundhada <saketmundhada7@gmail.com>' \
npm run cloud:service
```

Console-only local test:

```bash
npm run cloud:service
```

## Cleanup

To see what would be removed for a fresh WebGPT bench/routine run:

```bash
npm run cloud:cleanup
```

To delete cloud-service SQLite data, Browserbase event logs, planner artifacts,
and planner run logs:

```bash
npm run cloud:cleanup -- --yes
```

If `WEBGPT_CLOUD_ADMIN_TOKEN` is set, include:

```bash
-H "Authorization: Bearer $WEBGPT_CLOUD_ADMIN_TOKEN"
```
