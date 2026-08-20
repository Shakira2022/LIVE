# Middleware Integration Plan

**Merging `C:\dev\emergency-response` into `LIVE`**
Version 0.1 · prepared for the 12-person middleware team

---

## 1. What each project actually is

The two folders are not two versions of the same app. They are two halves of one app.

| | `emergency-response` | `LIVE` |
|---|---|---|
| Next.js | 14.2.15 | **16.0.3** |
| React | 18.3 | **19.2** |
| Path alias `@/*` | `./src/*` | **`./*`** |
| Layout | `src/app`, `src/lib` | root `app/`, `lib/` |
| Frontend | 6 components, 5 pages, unstyled | **~35 components, 25 pages, complete** |
| API routes | **15, fully built** | 3, hand-written |
| Auth | **JWT + httpOnly cookies + refresh rotation** | user object in `localStorage` |
| Validation | **Zod schemas on every endpoint** | scattered `if (!x) return 400` |
| Rate limiting | **yes** | no |
| Audit logging | **automatic, every route** | manual, fired from the browser |
| Database | its own `db/schema.sql`, never deployed | **`supabase/schema.sql`, live on Supabase** |

**`emergency-response` is the middleware layer this team was asked to build. `LIVE` is the frontend and the real database.** The integration is one-directional: middleware moves *into* LIVE. Nothing goes the other way.

Two things in LIVE are deliberately **not** touched: the UI components, and the deployed database schema.

---

## 2. The one hard problem: the schemas disagree

`emergency-response` was written against a schema that was never deployed. LIVE's schema **is** deployed. Every service query therefore had to be rewritten. This is done — the table below is the record of what changed, and it is the thing to check first when something returns an empty result.

### 2.1 `users`

| emergency-response | LIVE (deployed) | Consequence |
|---|---|---|
| `full_name` | `first_name`, `last_name`, `display_name` | Split on write, join on read |
| `organisation_id` column | **no column** — via `organisation_members` | Every org lookup is a second query. Centralised in `resolveOrganisation()` |
| `failed_login_count` | `failed_login_attempts` | Renamed |
| `callback_number` | **no column** — lives on the request | Moved |
| `emergency_contact_name/phone` | **`emergency_contacts` table** | The current `/api/register` **silently discards** both fields the user typed. Fixed. |
| `status`: active/suspended/deleted | `pending`/`active`/`suspended`/`locked`/`deactivated` | More states; only `active` may sign in |
| — | **`deleted_at`** | Every user query must filter `.is('deleted_at', null)` or deleted accounts can sign in |

### 2.2 `emergency_requests`

| emergency-response | LIVE (deployed) |
|---|---|
| `reference` | `reference_code` |
| `organisation_id` | `routed_organisation_id` |
| `latitude` / `longitude` / `manual_address` on the row | **`request_locations` table**, 1:1 |
| `location_source` (`gps`\|`manual`) | `location_method` (`gps`\|`manual`\|**`map_pin`**) |
| `cancellation_requested` boolean | `cancellation_requested_at` timestamp |
| `closed_at` only | **`received_at`, `assigned_at`, `en_route_at`, `arrived_at`, `closed_at`, `cancelled_at`, `rejected_at`** — one column per milestone, each must be stamped on transition |
| no severity | **`severity` NOT NULL** (`critical`/`high`/`moderate`) |
| `idempotency_key` nullable | **NOT NULL UNIQUE** — duplicate prevention is enforced by the database, not by application logic |
| 7 statuses | **8** — `rejected` added |

### 2.3 The rest

| emergency-response | LIVE (deployed) |
|---|---|
| `devices_sessions` | `device_sessions` — and it stores **`jwt_id_hash`**, not the raw token id |
| `request_status_history.changed_by` / `.changed_by_role` | `changed_by_user_id` / `actor_role` (+ `changed_by_system`, `correlation_id`) |
| `request_assignments.assigned_to` / `team_label` / `vehicle_label` (free text) | `responder_user_id` / `team_id` / `vehicle_id` — **all foreign keys**. You cannot type a team name any more; the team must exist. |
| `request_assignments.assigned_by` nullable | `assigned_by_user_id` **NOT NULL** |
| `audit_logs` with a `log_type` column | **three tables**: `audit_logs`, `security_logs`, `application_logs` |
| `audit_logs.ip_hash` (text) | `ip_address` is **`inet`** — a hash will not fit. The hash now goes in `safe_metadata.ipHash` |
| `request_location_pings` (many per request) | **nothing equivalent.** `request_locations` is UNIQUE per request |

### 2.4 The one genuine gap: live tracking

`request_locations.request_id` is `UNIQUE`. It answers *"where is the incident"*, not *"where is the responder right now"*. A movement trail needs many rows per request.

`supabase/migrations/0001_request_location_pings.sql` is included, **not applied**. It only ADDS a table — it alters and drops nothing, so it cannot break the backend or frontend team's work. Decide in the Monday sync:

- **Run it** → live tracking works, Block 4 delivers in full.
- **Don't run it** → `PUT /api/requests/[id]/location` still works (it upserts the current position); continuous tracking goes on the deferred list (Block 8, Person 9).

---

## 3. Files to add, and where

Everything below has been **written into the LIVE folder already**. `npx tsc --noEmit` is clean and `npx next build` compiles all 15 routes plus the edge middleware under Next 16.

### New — the middleware layer

```
LIVE/
├── middleware.ts                          NEW  root edge middleware (page guards)
├── instrumentation.ts                     NEW  startup env validation
├── .env.example                           NEW  documented template, no secrets
│
├── types/
│   └── index.ts                           NEW  the shared contract (Block 1 P2)
│
├── lib/middleware/                        NEW  ← the whole layer lives here
│   ├── env.ts                             fail-fast env access
│   ├── errors.ts                          error taxonomy → HTTP status
│   ├── logger.ts                          structured JSON logs + redaction
│   ├── jwt.ts                             sign/verify, Edge + Node
│   ├── password.ts                        bcrypt + timing-attack defence
│   ├── reference.ts                       ER-YYMMDD-XXXX generator
│   ├── status.ts                          transition rules + display mapping
│   ├── validation.ts                      all Zod schemas
│   ├── geo.ts                             distance, map embeds, route links
│   ├── api/
│   │   ├── handler.ts                     ★ THE PIPELINE — read this first
│   │   ├── response.ts                    { ok, data, requestId } envelope
│   │   ├── context.ts                     correlation id, IP hashing
│   │   ├── cookies.ts                     httpOnly cookie handling
│   │   ├── rate-limit.ts                  fixed-window limiter
│   │   └── audit.ts                       routes events to the 3 log tables
│   ├── server/
│   │   ├── db.ts                          lazy service-role Supabase client
│   │   ├── auth-service.ts                sessions, rotation, lockout
│   │   └── requests-service.ts            all request reads/writes
│   └── client/
│       └── api.ts                         browser fetch helper + auto-refresh
│
├── app/api/
│   ├── health/route.ts                    NEW  GET
│   ├── auth/
│   │   ├── login/route.replacement.ts     ← swap in (see §3.1)
│   │   ├── logout/route.ts                NEW
│   │   ├── me/route.ts                    NEW
│   │   ├── refresh/route.ts               NEW  (GET + POST)
│   │   └── register/route.ts              NEW  (replaces /api/register)
│   ├── requests/
│   │   ├── route.ts                       NEW  GET list, POST create
│   │   └── [id]/
│   │       ├── route.ts                   NEW  GET detail
│   │       ├── status/route.ts            NEW  PATCH
│   │       ├── location/route.ts          NEW  PUT
│   │       ├── assignments/route.ts       NEW  POST
│   │       ├── notes/route.ts             NEW  POST
│   │       └── cancel/route.ts            NEW  POST
│   └── admin/audit-logs/route.ts          NEW  GET
│
├── components/auth/
│   └── auth-provider.replacement.tsx      ← swap in (see §3.1)
│
└── supabase/migrations/
    └── 0001_request_location_pings.sql    NEW, optional, additive only
```

### 3.1 The two files that replace existing ones — shipped disarmed

`app/api/auth/login/route.ts` and `components/auth/auth-provider.tsx` already exist in LIVE. Overwriting them would have left the repo non-compiling (pages read `user.name` and `user.initials` off `MockUser`; the new provider yields `PublicUser`). They are therefore delivered **alongside** the originals as `.replacement.ts` / `.replacement.tsx`. Next.js ignores non-`route.ts` files in `app/`, so nothing activates until someone chooses to.

To swap, when Block 2 is ready:

```bash
git mv app/api/auth/login/route.ts app/api/auth/login/route.old.ts
git mv app/api/auth/login/route.replacement.ts app/api/auth/login/route.ts

git mv components/auth/auth-provider.tsx components/auth/auth-provider.old.tsx
git mv components/auth/auth-provider.replacement.tsx components/auth/auth-provider.tsx
npx tsc --noEmit    # the errors it now lists ARE the Block 3 migration checklist
```

That last `tsc` run is the useful part: every error is a page still reading a field off `MockUser`. `name` → `fullName`, `MockUser` → `PublicUser`, `status: "Active"` → `status: 'active'`.

**`middleware.ts` ships with a kill switch.** Page guards do nothing until `JWT_SECRET` is set — it only adds security headers and a correlation id. So it can be merged immediately without locking anyone out of the app they are still building. Delete `GUARDS_ENABLED` once Block 2 is merged.

**`instrumentation.ts` warns in development, throws in production.** A teammate who has not copied `.env.example` yet can still run `npm run dev`; a production deploy missing `JWT_SECRET` fails on boot, which is Person 9's requirement.

### Deliberately NOT copied

| Skipped | Why |
|---|---|
| `src/components/*`, `src/hooks/*` | LIVE's components are better and already styled. The hooks (`useGeolocation`, `usePolling`) are worth reading if Block 4 wants a reference, but they are unstyled and duplicate work LIVE has done. |
| `src/app/**/page.tsx` | LIVE has 25 finished pages. These are 5 rough ones. |
| `db/schema.sql`, `db/seed.sql` | LIVE's schema is deployed. Adopting this would destroy the backend team's work. |
| `app/api/organisations/*`, `app/api/notifications/*` | Written against tables shaped differently in LIVE. Port later if needed — they are not on the block plan. |
| `tailwind.config.ts`, `postcss.config.mjs`, `globals.css` | LIVE has its own design system. |

### Existing LIVE files that change

| File | Change | Owner |
|---|---|---|
| `package.json` | add `jose@^5.9.6`, `zod@^3.23.8` | Block 1, P1 |
| `.env.local` | add the JWT block from `.env.example` | Block 1, P1 |
| `app/api/auth/login/route.ts` | replaced — see §3.1 | Block 2, P6 |
| `components/auth/auth-provider.tsx` | replaced — see §3.1 | Block 3, P1 |
| `app/api/register/route.ts` | **delete after one release** — superseded by `/api/auth/register` | Block 2, P6 |
| `app/api/audit/route.ts` | **delete.** A browser-callable audit endpoint lets anyone forge audit rows. Server-side auditing replaces it. | Block 2, P8 |
| `lib/client-audit.ts` | delete with the above | Block 2, P8 |
| `lib/mock-store.tsx`, `lib/mock-data.ts` | keep until pages are migrated, then delete | Block 3 |
| `lib/types.ts` | keep. Add `import type { RequestStatus } from '@/types'` and use `toDisplayStatus()` at the boundary. | Block 1, P2 |

---

## 4. Three things to know before writing any code

### 4.1 There are two middleware layers, not one

```
Browser
   │
   ▼
middleware.ts ......... Layer 1 · EDGE · page guards, CSP, correlation id
   │                    Redirects unauthenticated visitors away from /app/*.
   │                    NOT a security boundary — it can be bypassed by
   │                    calling the API directly.
   ▼
app/api/**/route.ts ... wrapped by createHandler()
   │
   ▼
lib/middleware/api/handler.ts ... Layer 2 · NODE · the real boundary
   │   1 context   correlation id, IP hash, user agent, timer
   │   2 headers   security headers on success AND failure
   │   3 limit     rate limiting, before any DB work
   │   4 authn     verify JWT (cookie or Authorization header)
   │   5 authz     role gate; ownership checked in the service
   │   6 validate  Zod over params, query, body
   │   7 handler   ← the only part a route author writes
   │   8 errors    safe client message, detailed internal log
   │   9 audit     one durable row per meaningful action
   ▼
lib/middleware/server/*-service.ts → Supabase
```

A route never re-implements any of steps 1–6 and 8–9. It declares what it needs:

```ts
export const PATCH = createHandler(
  {
    name: 'requests.status',
    auth: 'required',
    roles: ['requester', 'responder', 'dispatcher', 'admin'],
    params: idParamSchema,
    body: statusChangeSchema,
    rateLimit: { limit: 60, windowMs: 60_000, by: 'user' },
    audit: { action: 'request.status_changed', targetType: 'emergency_request' },
  },
  async (ctx) => changeStatus(ctx.params.id, ctx.user, ctx.body),
);
```

If you find yourself writing `if (!token) return 401` inside a route, stop — the pipeline already did it.

### 4.2 Status is stored lowercase and displayed Title Case

The database enum is `'en_route'`. The existing UI in `lib/types.ts` renders `"En route"`. Both are correct in their own layer.

```ts
import { toDisplayStatus, fromDisplayStatus } from '@/lib/middleware/status';

toDisplayStatus('en_route')   // "En route"   ← rendering
fromDisplayStatus('En route') // 'en_route'   ← reading a form
```

**Never store a display string.** This is the single most likely source of "the status update silently did nothing".

### 4.3 The frontend's response shape changes by one level

Old login response:

```json
{ "ok": true, "message": "Login successful.", "user": { ... } }
```

New envelope, identical on **every** endpoint:

```json
{ "ok": true, "data": { "user": { ... }, "accessExpiresAt": 1755500000 }, "requestId": "..." }
```

Errors are equally uniform:

```json
{ "ok": false, "error": { "code": "VALIDATION_FAILED", "message": "Check the form and try again.",
    "details": { "password": ["Include an uppercase letter, a lowercase letter and a number."] } },
  "requestId": "..." }
```

`lib/middleware/client/api.ts` unwraps this, so components see the payload directly and never touch the envelope. It also handles `TOKEN_EXPIRED` by refreshing once and replaying the call, so a session expiring mid-form is invisible to the user.

The `requestId` appears in the response body, the `x-request-id` header, the log lines and the audit row. **Screenshot it when reporting a bug** — it makes any incident traceable end to end. (Block 8, Person 10: this is your test evidence.)

---

## 5. Security issues found in the current LIVE code

These are why the middleware layer exists. Each is fixed by the ported code.

1. **Roles are client-controlled.** `auth-provider.tsx` stores the user object in `localStorage` and pages read `user.role` from it. Edit `localStorage` to `{"role":"admin"}`, reload — the admin screens render. Nothing on the server disagrees, because nothing on the server is asked. → *Fixed: httpOnly cookies, role inside the signed token, verified on every call.*

2. **`/api/audit` accepts anything from anyone.** Any visitor can POST forged audit rows, or simply never send the ones that would incriminate them. An audit log the audited party controls is not an audit log. → *Fixed: auditing moves server-side, into the pipeline; the endpoint is deleted.*

3. **`/api/auth/login` logs identifiers and configuration.** `console.log("Login identifier:", value)` writes the email or phone of every person who signs in into the hosting logs, alongside the Supabase URL and whether the service-role key is set. → *Fixed: structured logging with automatic redaction — `logger.ts` masks emails, phones and anything named `*token*`, `*secret*`, `*password*`.*

4. **No rate limiting anywhere.** Password guessing against `/api/auth/login` is unbounded. → *Fixed: 10 attempts per IP per 5 minutes, plus 8-strike account lockout for 15 minutes.*

5. **Registration discards the emergency contact.** The form collects `emergencyContactName` and `emergencyContactPhone`; the route never writes them. In an emergency app, that is the field that matters most. → *Fixed: written to `emergency_contacts`.*

6. **No password strength rule.** `"a"` is currently a valid password. → *Fixed: 10 chars, mixed case, digit.*

7. **`.env.local` contains a live service-role key** and is in a Desktop folder. That key bypasses Row Level Security entirely — it is full read/write on the whole database.
   **Rotate it** (Supabase → Settings → API → Reset service role key), confirm `.env.local` is gitignored, and check `git log --all -- .env.local` in case it was ever committed. *(Block 1 Person 1 + Block 2 Person 9 — do this before the demo, not after.)*

8. **RLS is enabled on all 24 tables, but no policies were found in `schema.sql`.** With no policy, RLS denies everything — which is why the current code uses the service-role key for ordinary reads, silently disabling the protection. Worth confirming with the backend team whether policies exist outside this file. *(Block 1, Person 4 — cross-team dependency.)*

---

## 6. Assignment against the block plan

Every block already has an owner. This maps the ported files onto them. **The code is written; these tasks are now review, wire-up, and test.**

### Block 1 — Setup & foundation

| Person | Task | Files |
|---|---|---|
| **1** | Env template + document every variable | `.env.example` (done), README section. **Also: rotate the leaked key.** |
| **2** | Agree shared types with frontend + backend | `types/index.ts` (done). Walk both teams through §2 — the field renames are the thing that breaks people. |
| **3** | Confirm request/response shapes | §4.3. Confirm the envelope with frontend **before** anyone writes a `fetch`. |
| **4** | Supabase details, statuses, roles from backend | Statuses and roles are in `types/index.ts`, read from the deployed schema. Confirm they are final, and ask about the RLS policies (§5.8). |
| **5** | Middleware project structure + routing | `lib/middleware/**` (done). Review the layout before Block 2 builds on it. |

### Block 2 — Authentication & security

| Person | Task | Files |
|---|---|---|
| **6** | JWT creation endpoint + verification middleware | `app/api/auth/login`, `logout`, `me`, `refresh`, `register`; `lib/middleware/jwt.ts` |
| **7** | Role guards; test invalid + expired tokens | `roles:` in `handler.ts`. Write the tests — forge a token, tamper with a payload, wait out a 900s expiry (or set `ACCESS_TOKEN_TTL_SECONDS=5` locally). |
| **8** | Test missing tokens; audit login + refresh | Already emitted as `auth.login.success/failed/locked` and `auth.token.refreshed`. Verify rows land in `security_logs`. **Delete `app/api/audit/route.ts` and `lib/client-audit.ts`.** |
| **9** | Startup env validation; password hashing | `instrumentation.ts` + `assertServerEnv()` (done); `lib/middleware/password.ts` — bcrypt cost 10, timing-attack defence via `burnPasswordTime()` |

### Block 3 — Requester interface support

| Person | Task | Files |
|---|---|---|
| **1** | Connect frontend to endpoints | Swap in `auth-provider.replacement.tsx` (§3.1). Migrate `app/app/requester/new/page.tsx` (31 KB — the biggest single job) from `mock-store` to `apiPost('/api/requests', ...)`. |
| **2** | Review and test requester-flow endpoints | `POST /api/requests`, `GET /api/requests`, `GET /api/requests/[id]`. Document anything that surprises you. |

### Block 4 — Location & map integration

| Person | Task | Files |
|---|---|---|
| **3** | GPS capture + manual fallback endpoints | `app/api/requests/[id]/location/route.ts` — one endpoint, `locationMethod` selects the path |
| **4** | Validate lat/long ranges; map integration | `validation.ts` (`latitudeSchema`/`longitudeSchema`) + DB check constraints — validated twice, deliberately. Map helpers in `geo.ts` (`osmEmbedUrl`, `routeLinkUrl`) |
| **5** | Test granted / denied / invalid coordinates | Three cases: `locationMethod:'gps'` with coords; `'manual'` with `addressText`; lat `91` → expect 422 |
| **6** | Log location events; document the endpoints | Audited as `request.location_updated`. **Note:** the audit records *that* a location arrived, never the coordinates — they are personal data. |

### Block 5 — Request API & status

| Person | Task | Files |
|---|---|---|
| **7** | Submission endpoint, payload validation, reference numbers | `app/api/requests/route.ts`; `createRequestSchema`; `reference.ts` (`ER-YYMMDD-XXXX`, ambiguous characters removed so it can be read aloud over a phone) |
| **8** | Store request; status history; confirmation endpoint | `requests-service.ts` → `createRequest()`, `appendHistory()`; `GET /api/requests/[id]` |
| **9** | Restrict users to their own requests; test duplicates + invalid | `assertCanView()`. **Ownership is applied inside the query**, not filtered afterwards — a requester cannot page into other rows. Duplicates: POST twice with the same `idempotencyKey`, expect the same request back, not two. |
| **10** | Test DB write; log creation; document | `audit: { action: 'request.created' }`. Verify the row in `audit_logs`. |

### Block 6 — Responder dashboard API

| Person | Task | Files |
|---|---|---|
| **10** | GET lists (new/active/completed) + single detail | `GET /api/requests?scope=new\|active\|completed\|mine\|all` |
| **11** | Status update, assignment, accept/cancel | `[id]/status`, `[id]/assignments`, `[id]/cancel` |
| **12** | Add notes, close request, record who changed what | `[id]/notes`; close = `PATCH status {status:'closed'}`; `request_status_history` records `changed_by_user_id` + `actor_role` + timestamp on every change |
| **1** | Restrict responder actions; test both directions | `roles:` on each route. Test: responder updates status → requester's tracking page reflects it. Test: requester calls the dispatcher endpoint → 403. |
| **2** | Log status changes; document responder endpoints | `request.status_changed` in `audit_logs` |

### Block 7 — Integration & mobile testing

| Person | Task | Notes |
|---|---|---|
| **3** | End-to-end requester → responder; invalid tokens everywhere | The full loop is: register → submit → dispatcher receives → assign → en route → arrived → close |
| **4** | Duplicate prevention; GPS denied; consistent errors | Every route returns the same envelope — that is the point of `handler.ts`. Any route that doesn't is a bug. |
| **5** | Status transitions; rate limits; CORS | `status.ts` — try `closed → assigned`, expect 409 `STATUS_TRANSITION_INVALID`. Rate limits are live; CORS is same-origin only (no `Access-Control-Allow-Origin` is set — intentional). |
| **6** | ngrok on a physical phone; document all endpoints | `npx ngrok http 3000`, set `ALLOW_INSECURE_COOKIES=1`. `GET /api/health` first — if that fails, nothing else will work. |

### Block 8 — Documentation & handover

| Person | Task |
|---|---|
| **7** | Setup guide + endpoint docs with examples — start from this file |
| **8** | Env variable docs (`.env.example` is already annotated); known limitations (§7) |
| **9** | Deferred features (§7); test accounts — see `MOCK_LOGIN_DETAILS.md`, but real bcrypt hashes are needed now |
| **10** | Test evidence — capture `requestId` values, they tie logs to screenshots; tag v0.1 |
| **11** | Rehearse the demo; handover document |
| **12** | Review all docs; confirm every endpoint is tested |

---

## 7. Known limitations — write these down, don't hide them

1. **Rate limiting is in-process memory.** One Next.js process is assumed. On serverless, each instance keeps its own counter, so the effective limit multiplies by the instance count. Production needs Redis or a Postgres counter table.
2. **CSP allows `'unsafe-inline'` for scripts.** Next.js hydration requires it. Hardening means per-request nonces.
3. **No email or phone verification.** `/api/auth/register` creates accounts as `active`, not `pending`.
4. **No password reset.** `app/forgot-password/page.tsx` is a UI shell; `password_recovery_tokens` exists in the schema but nothing writes to it.
5. **No push or SMS.** `notifications` and `notification_deliveries` exist; nothing delivers.
6. **Live tracking depends on the optional migration** (§2.4).
7. **`middleware.ts` is deprecated in Next 16** — it still works, and the build only warns. Rename to `proxy.ts` when convenient: `npx @next/codemod@canary middleware-to-proxy .`
8. **RLS policies unverified** (§5.8).
9. **Refresh rotation has no reuse detection.** A replayed refresh token fails, but a stolen-then-replayed one does not revoke the whole session family.

---

## 8. Start here, in this order

```bash
# 1. Dependencies
npm install jose@^5.9.6 zod@^3.23.8

# 2. Environment — copy the JWT block from .env.example into .env.local
openssl rand -base64 48        # → JWT_SECRET

# 3. Verify
npx tsc --noEmit               # must be clean
npx next build                 # must compile
npm run dev
curl http://localhost:3000/api/health

# 4. First real call — needs a user with a bcrypt password_hash in Supabase
curl -i -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"you@example.com","password":"YourPassw0rd"}'
# expect: Set-Cookie: live_access=... ; HttpOnly
```

**Merge order — each block depends on the one above it:**

1. Block 1 — types, env, structure *(nothing else compiles first)*
2. Block 2 — auth *(every other route needs a verified token)*
3. Block 5 — request creation *(nothing to dispatch until requests exist)*
4. Block 4 — location *(a request without a location is not actionable)*
5. Block 6 — responder actions
6. Block 3 — frontend wire-up *(last: the API should be stable before pages depend on it)*

Do not start Block 6 before Block 2 is merged. Two people building on an unverified auth contract is the failure mode that costs a week.

---

## 9. Cross-team questions to ask on day one

**Person 4 → backend team**

- Are there RLS policies outside `supabase/schema.sql`? If not, every read runs as service-role and RLS is decorative.
- Is `severity` genuinely required on every request? It is `NOT NULL` with no default, so the emergency button cannot submit without one.
- `request_assignments` needs real `responder_teams` and `vehicles` rows — free-text labels are no longer possible. Who seeds them?
- Confirm bcrypt cost 10 matches what the backend uses, or existing hashes will not verify.

**Person 2 → frontend team**

- The envelope changes from `result.user` to `result.data.user` (§4.3). Use `lib/middleware/client/api.ts` and this never comes up again.
- Status strings are lowercase on the wire (`'en_route'`), Title Case on screen. Use `toDisplayStatus()`.
- `POST /api/requests` requires a client-generated `idempotencyKey` (`crypto.randomUUID()`) — this is what stops a double-tap creating two emergencies.
- `localStorage` is no longer the session. `useAuth()` has the same shape, but `user` is now `PublicUser` from `@/types`, not `MockUser`.
