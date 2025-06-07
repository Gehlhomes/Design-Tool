# Design Tool SaaS

This repository contains a simple Node server and single-page application for building experiences. A built-in username/password system handles authentication. The default account is `gehlhomes` with password `GEadmin`, and additional users can sign up to create their own experiences. All data is stored per user and may optionally be backed by Supabase.

## Environment Variables

- `SUPABASE_URL` – URL of your Supabase project
- `SUPABASE_KEY` – service role or anon key
- `DATA_FILE` – optional path to JSON file used when Supabase is not configured.
  If not provided, data is stored in `~/design-tool/data.json`, which ensures
  your saved experiences persist even when the application code is replaced.

Create these variables when deploying on Render or another platform.

## Running

```
npm start
```

The server listens on `PORT` (defaults to 3000).
