# Design Tool SaaS

This repository contains a simple Node server and single-page application for building experiences. A built-in username/password system handles authentication. The default account is `gehlhomes` with password `GEadmin`, and additional users can sign up to create their own experiences. All data is stored per user and may optionally be backed by Supabase.

## Environment Variables

- `SUPABASE_URL` – URL of your Supabase project
- `SUPABASE_KEY` – service role or anon key
- `DATA_FILE` – optional path to JSON file used when Supabase is not configured.
  By default the server stores data in `~/design-tool/data.json`. When running
  on platforms such as Render you should use a persistent volume or external
  database and set `DATA_FILE` to that path (for example `/var/data/data.json`).
  If the file lives inside the application directory it will be removed whenever
  the service restarts and all experiences and submissions will be lost.

Create these variables when deploying on Render or another platform.

## Running

```
npm start
```

The server listens on `PORT` (defaults to 3000).

## Persistent Login

The front-end stores the logged-in user's ID in `localStorage` so you remain
authenticated when you refresh the page. Click **Logout** to clear the saved
ID.
