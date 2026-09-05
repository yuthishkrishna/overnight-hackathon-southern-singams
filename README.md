# AirWise AI

Environment variables (create a `.env` file from `.env.example`):

- `GROQ_API_KEY` — Groq API key for AI completions (optional; server has a local fallback).
- `WAQI_TOKEN` — World Air Quality Index API token (optional; 'demo' used if missing).
- `PORT` — Server port (default 5000).
- `HOST` — Server bind address (default `0.0.0.0`, required by most container hosts).
- `CORS_ORIGIN` — Optional allowed origin for API requests. Leave unset to allow all origins.

Run locally:

```bash
npm install
npm start
```

On Windows, if PowerShell blocks `npm`, use `npm.cmd start`, run `node server.js`,
or double-click `start-server.cmd`.

Open the web app by visiting http://localhost:5000 in your browser (do NOT open client/index.html via file://). The client automatically defaults API calls to `http://localhost:5000` when opened from the filesystem.

Deploy with Docker:

```bash
docker build -t airwise .
docker run --rm -p 5000:5000 --env-file .env airwise
```

The service listens on the host and port supplied by `HOST` and `PORT`, serves the frontend and API from the same origin, and does not require `GROQ_API_KEY` because a local advisory fallback is included.

Notes:
- If `GROQ_API_KEY` is not set or invalid, the server falls back to a safe local advisory generator.
- Ensure the WAQI token is valid for production use.
