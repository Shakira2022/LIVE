# LIVE Emergency Response Platform

LIVE is a web-based emergency response coordination platform. It connects people requesting help with dispatchers, response organisations, and responders, and provides role-based tools for managing incidents, assignments, communications, and operational records.

This repository contains the Next.js web application and API, Supabase integration and database migrations, and an Android Capacitor shell that connects to the web application.

## Contents

- [What LIVE includes](#what-live-includes)
- [Technology](#technology)
- [Requirements](#requirements)
- [Set up the web application](#set-up-the-web-application)
- [Environment variables](#environment-variables)
- [Run the application](#run-the-application)
- [Database setup](#database-setup)
- [Mobile app](#mobile-app)
- [Optional services](#optional-services)
- [Project layout](#project-layout)
- [Useful commands](#useful-commands)
- [Deployment notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)

## What LIVE includes

The interface and available actions depend on the signed-in user's role:

- **Requesters** can submit and track emergency requests, share location, view request history, manage preferences, and contact support.
- **Dispatchers** can review incoming requests, coordinate assignments, monitor responders, manage cancellations, and access operational resources.
- **Responders** can manage availability and profile details, view and progress assigned missions, share location, and review history.
- **Managers** can view operational dashboards and analytics and manage incident-related work for their organisation.
- **Administrators** can manage users and organisations, review audit records and reports, configure settings, and handle support cases.
- **Auditors** have dedicated incident, application, integration, security, and audit views.

The application also includes registration and email verification, sign-in and password recovery, notifications, support workflows, mapping and route links, voice transcription, and AI-assisted requester tools. Integration availability depends on the environment configuration described below.

## Technology

- Next.js 16 App Router and API routes
- React 19 and TypeScript
- Supabase for application data and authentication-related storage
- JWT-based application sessions and role-aware API authorization
- Tailwind CSS, Leaflet, and ECharts
- Capacitor 8 Android wrapper in `mobile/`
- Optional Ollama, Gemini, Gmail SMTP, and Coturn integrations

## Requirements

For the web application:

- Node.js compatible with Next.js 16 (Node.js 20.9 or newer recommended)
- npm
- A Supabase project with the expected application schema

For the full local AI development command, install and configure [Ollama](https://ollama.com/) and a `llama-server` executable from llama.cpp, and make the configured models available. See [Optional services](#optional-services). You can run Next.js without starting those local AI services using `npm run dev:next`.

For Android development, install Android Studio, the Android SDK, and a compatible Java/Gradle toolchain.

## Set up the web application

1. Clone the repository and enter its root directory.
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Create `.env.local` in the repository root. Add the required values from [Environment variables](#environment-variables).
4. Apply the required Supabase migrations and confirm that the project has the application tables and policies expected by the code. See [Database setup](#database-setup).
5. Start the application using one of the commands below.

The root `.gitignore` excludes `.env` and `.env.local`. Never commit secret keys or passwords. The `docs/env.project.template.txt` file is a reference for configuration; it is not a ready-to-use secrets file and includes example values that must be replaced.

## Environment variables

### Required for the web app

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Used by browser and server clients. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public/anon key for the browser client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase administrative key. Keep it secret; never expose it as a `NEXT_PUBLIC_` variable. |
| `JWT_SECRET` | Secret used to sign application session tokens. Use a random value of at least 32 characters. |

Generate a suitable JWT secret with:

```sh
openssl rand -base64 48
```

### Email and public URL settings

| Variable | Purpose |
| --- | --- |
| `GMAIL_USER` | Gmail address used to send verification, password recovery, and related email. |
| `GMAIL_APP_PASSWORD` | Gmail app password for SMTP. Use an app password, not the account password. |
| `SUPPORT_EMAIL` | Optional support contact address; defaults to `GMAIL_USER` where used. |
| `APP_URL` | Public base URL used to create links in account emails. Set this to the deployed HTTPS URL in production. |

Email credentials are required for email delivery workflows. Other app functionality may start without them, but those email actions will not complete successfully.

### Optional settings

The application has defaults for most settings. Add these only when you need to override them:

| Variable | Default / purpose |
| --- | --- |
| `JWT_ISSUER` | `live-response-api`; token issuer. |
| `JWT_AUDIENCE` | `live-response-web`; token audience. |
| `ACCESS_TOKEN_TTL_SECONDS` | `900`; access-token lifetime. |
| `REFRESH_TOKEN_TTL_SECONDS` | `604800`; refresh-token lifetime. |
| `LOG_LEVEL` | `info`; accepts `debug`, `info`, `warn`, or `error`. |
| `RATE_LIMIT_ENABLED` | Enabled unless set to `0`. |
| `ALLOW_INSECURE_COOKIES` | Development only. Defaults to allowing cookies over local HTTP; production always uses secure cookies. Set to `0` to require secure cookies while developing. |
| `ROUTING_MAX_RADIUS_KM` | `150`; maximum automatic routing distance before a request is left for dispatcher triage. |
| `NEXT_PUBLIC_MAP_PROVIDER` | `osm`; map provider setting. |
| `NEXT_PUBLIC_ROUTE_LINK_PROVIDER` | `google`; provider for route links. |
| `NEXT_PUBLIC_MAP_TILE_URL` | Optional map tile URL override. |
| `NEXT_PUBLIC_ROUTER_URL` | Optional routing service URL override. |
| `NEXT_PUBLIC_TRACKING_MIN_INTERVAL_MS` | `8000`; minimum time between location updates. |
| `NEXT_PUBLIC_TRACKING_MIN_DISTANCE_M` | `15`; minimum distance between location updates. |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | `5000`; polling interval for live data. |
| `GEMINI_API_KEY` | Enables Gemini-backed assistant and speech services. Keep server-side. |
| `GEMINI_MODEL` | Optional assistant model override. |
| `GEMINI_SPEECH_MODEL` | Optional speech transcription model override. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Ollama endpoint and model used by AI features. Defaults are in `lib/assistant/ai-providers.ts` and `scripts/dev-with-ollama.cjs`. |
| `LIVE_TRANSLATION_BASE_URL`, `LIVE_TRANSLATION_MODEL` | Optional local translation service endpoint and model. |

TURN configuration is not currently wired into the in-app WebRTC call configuration. The `NEXT_PUBLIC_TURN_*` and `TURN_*` entries in `docs/env.project.template.txt` are reference values for future setup only; see [TURN-Server/README.md](TURN-Server/README.md).

## Run the application

### Standard development command

```sh
npm run dev
```

This repository's `dev` script first checks for a local Ollama server and the configured model, starts Ollama if possible, and starts the local translation server using `llama-server` if it is unavailable. It then launches Next.js. The translation model may require a large download and sufficient memory on its first run.

### Start Next.js without the local AI startup checks

```sh
npm run dev:next
```

This runs the Next.js development server directly. AI features that rely on an unavailable provider may not work.

Once the server is ready, open [http://localhost:3000](http://localhost:3000). The unauthenticated liveness endpoint is [http://localhost:3000/api/health](http://localhost:3000/api/health); it confirms that the service is running, but does not check Supabase connectivity.

### Production build

```sh
npm run build
npm run start
```

Set the production environment variables before building and starting the server. In particular, use a strong `JWT_SECRET`, a real Supabase project, HTTPS, and a correct `APP_URL`.

## Database setup

The app expects a Supabase database containing its application schema. Versioned SQL migrations are in [`supabase/migrations/`](supabase/migrations/). Apply them to the target Supabase project using the Supabase CLI or your established migration workflow, and check each migration before applying it to a database with existing data.

Additional one-off or demo SQL scripts are in [`supabase/manual/`](supabase/manual/). These are not automatically applied by the application; review them and run only when appropriate for your environment. Database attributes and project structure notes are available in [`DATABASE_ATTRIBUTES.md`](DATABASE_ATTRIBUTES.md) and [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md).

The application uses the Supabase service-role key for selected server-side operations. Configure Supabase row-level security and project access carefully, and keep the service-role key on the server only.

## Mobile app

The `mobile/` directory contains a Capacitor Android shell for the existing LIVE web application. It loads the running web server; it is not a bundled offline client and does not run the backend on the device.

Read [`mobile/README.md`](mobile/README.md) for Android setup, device networking, and production limitations. In brief:

1. Run the web backend from the repository root.
2. In `mobile/`, copy `.env.example` to `.env` and set `LIVE_MOBILE_SERVER_URL` to the reachable backend URL. Use `http://10.0.2.2:3000` for the Android emulator, or the computer's LAN address for a physical device on the same network.
3. Run `npm install` and `npm run android:sync` in `mobile/`, then open the Android project with `npm run android:open`.

For release distribution, use HTTPS and plan to replace the remote-server shell with a bundled mobile client. Browser microphone APIs also require a secure context, so voice features may not work at a plain HTTP LAN URL.

## Optional services

### AI and translation

The `npm run dev` helper expects Ollama and `llama-server` to be available. Its defaults are `qwen2.5:1.5b-instruct` for Ollama and `qvac/TranslatePsy-AfriSLM-0.8B-Q4-GGUF:Q4_K_M` for translation. Install/pull the Ollama model before starting; the script reports a command if the model is missing. Set `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `LIVE_TRANSLATION_BASE_URL`, and `LIVE_TRANSLATION_MODEL` to change these values.

Alternatively, configure `GEMINI_API_KEY` for Gemini-backed assistant and transcription features. Do not put provider keys in client-side variables.

### Coturn for WebRTC

An optional Coturn configuration is in [`TURN-Server/`](TURN-Server/). It is not currently enabled by the application. The TURN README describes local startup, ports, and what is needed before adding a TURN server to the WebRTC ICE configuration. Do not use the example credentials in a public deployment.

## Project layout

```text
app/                  Next.js pages, role-based screens, and API routes
components/           Shared interface and feature components
lib/                  Supabase, authentication, business logic, and services
supabase/migrations/  Versioned database migrations
supabase/manual/      Manually reviewed SQL scripts
mobile/               Capacitor Android shell
TURN-Server/          Optional, currently unconnected Coturn setup
docs/                 Setup references, API collection, and project documents
scripts/              Development and maintenance scripts
types/                Shared TypeScript types
```

## Useful commands

Run these from the repository root unless noted:

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked web dependencies. |
| `npm run dev` | Start the development workflow, including local AI service checks. |
| `npm run dev:next` | Start Next.js directly without AI service startup checks. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run TypeScript checking. |

An API collection and local Postman environment are in [`docs/postman/`](docs/postman/). Review the environment file before use and provide appropriate local values.

## Deployment notes

- Deploy the Next.js app to a Node.js-compatible host and provide all required environment variables through the host's secret manager.
- Set `APP_URL` to the canonical HTTPS origin so account links point back to the deployment.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, SMTP credentials, and AI provider keys server-only.
- Use HTTPS in production. Secure cookies are enforced in production.
- Apply and review database migrations against the intended Supabase project before directing users to the deployment.
- The Android shell depends on a reachable web backend; it is not an independently deployable offline app.
- The bundled TURN server is optional and needs public network reachability and app-side ICE configuration before it can relay calls.

## Troubleshooting

**The app reports missing environment variables at startup.** Check that `.env.local` is in the repository root and includes the three required server values. Ensure `JWT_SECRET` is at least 32 characters.

**`npm run dev` cannot start.** This command also requires Ollama and `llama-server`. Install them, configure the corresponding `OLLAMA_*` and `LIVE_TRANSLATION_*` URLs/models, or use `npm run dev:next` to run Next.js without the local AI startup checks.

**Login works locally but cookies do not persist through a tunnel.** For HTTPS tunnel testing, set `ALLOW_INSECURE_COOKIES=0` so development cookies are marked secure, then restart the server. Production cookies are always secure.

**Email links are wrong or email does not send.** Set `APP_URL` to the correct site origin and check `GMAIL_USER` plus `GMAIL_APP_PASSWORD`. Gmail SMTP requires an app password.

**The Android device cannot reach the server.** Check `LIVE_MOBILE_SERVER_URL`, ensure the computer and phone share a network, allow the server port through the firewall, and run `npm run android:sync` after changing the mobile environment file. See [`mobile/README.md`](mobile/README.md).

**Voice calls or transcription do not work.** Browser microphone capture needs a secure context. Check HTTPS access and the relevant transcription provider configuration. Coturn is not currently connected to the app.
