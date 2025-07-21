# Design Tool SaaS

This repository contains a simple Node server and single-page application for building experiences. A built-in username/password system handles authentication. The default account is `Gehlhomes` with password `GEadmin`, and additional users can sign up to create their own experiences. All data is stored per user and may optionally be backed by Supabase.

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

### Setting Up Persistent Storage on Render

To prevent data loss on Render due to service restarts or redeploys, you must use a persistent disk or Supabase. Here's how to set up a persistent disk (requires a paid Render plan):

1. Log in to the Render Dashboard.
2. Navigate to your service.
3. Go to the "Disks" page or "Advanced" section.
4. Add a new disk:
   - Set the mount path, e.g., `/var/data`.
   - Choose a disk size (start small; you can increase later but not decrease).
5. Save changes; Render will redeploy your service.
6. In your service's environment variables, set `DATA_FILE=/var/data/data.json`.
7. Important: With a disk attached, your service cannot scale to multiple instances and deploys will have brief downtime.

If on a free plan, upgrade to paid or use Supabase instead.

### Setting Up Supabase for Persistent Storage

Supabase provides a free tier and ensures data persistence. Follow these steps:

1. Sign up at supabase.com and create a new project.
2. In your project, go to Database > Table Editor and create two tables:
   - `experiences` with columns: `id` (uuid, primary key, default gen_random_uuid()), `user_id` (text), `name` (text), `sections` (jsonb).
   - `analytics` with columns: `id` (text, primary key), `user_id` (text), `email` (text), `count` (integer), `pdf_base64` (text).
3. Note your project's URL and anon key (or service role key for full access) from Settings > API.
4. In Render, set environment variables: `SUPABASE_URL=your-url`, `SUPABASE_KEY=your-key`.
5. The server will automatically use Supabase if these are set.

Using Supabase is recommended for reliability and scalability.

## Running

Run the server with:

```
npm start
```

The server listens on `PORT` (defaults to 3000).

## Persistent Login

The front-end stores the logged-in user's ID in `localStorage` so you remain
authenticated when you refresh the page. Click **Logout** to clear the saved
ID.

Note: Experience and analytics data are no longer cached in localStorage to avoid quota limits. All data is fetched from and saved to the server.
