# Design Tool SaaS

This repository contains a simple Node server and single-page application for building experiences. The app now supports per-user data storage via Supabase and uses Memberstack for user authentication. Visitors must log in or sign up before accessing the builder.

## Environment Variables

- `SUPABASE_URL` – URL of your Supabase project
- `SUPABASE_KEY` – service role or anon key
- `DATA_FILE` – optional path to JSON file used when Supabase is not configured

Create these variables when deploying on Render or another platform.

## Running

```
npm start
```

The server listens on `PORT` (defaults to 3000).
