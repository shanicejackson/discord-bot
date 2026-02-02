Hosting recommendations for card-bot

This document explains safe ways to host `card-bot` (Docker / Pterodactyl / manual).

1) Build a Docker image locally (recommended)

- Build locally so npm runs on your machine (not the hosted container):

```bash
# from repo/card-bot
docker build -t yourusername/card-bot:latest .
```

- Test locally with an env file:

```bash
docker run --env-file .env -d --name card-bot yourusername/card-bot:latest
docker logs -f card-bot
```

- Push to a registry (Docker Hub / GHCR) and configure your host to pull and run the image.

2) Use Pterodactyl / limited containers

If your host runs npm install at startup and has low memory, prefer one of these approaches:

A) Preinstall dependencies locally and upload

```bash
# locally (card-bot folder)
npm ci --production
# create an archive to upload to the server
zip -r card-bot-with-modules.zip .
```

Upload the zip, extract on the server and set the Panel environment variable `NPM_INSTALL=0` so the start script does not try to install again.

B) Provide a prebuilt Docker image instead of letting the panel run npm. (See step 1.)

3) Environment variables and secrets

- Do NOT commit `.env` to Git. The repo's `.gitignore` already excludes it.
- Provide runtime env vars via your hosting panel (Pterodactyl) or `--env-file` when running the Docker container.
- Required examples (from `.env`): DISCORD_TOKEN, CLIENT_ID, GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_ID, BUG_CHANNEL_ID

4) Process management

- For long-running reliability on a server: use `pm2` or the platform's process manager. Example with pm2:

```bash
npm i -g pm2
pm2 start index.js --name card-bot
pm2 save
pm2 startup
```

5) Notes

- The Dockerfile included in this repo installs build deps at image build time (needed for `better-sqlite3`) and removes them to keep the image small.
- If you want me to prepare a release image and push it to Docker Hub, I can build it locally and upload it for you.
