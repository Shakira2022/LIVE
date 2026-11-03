# LIVE Assistant chatbot

## What was added
- `components/chatbot/live-chatbot.tsx`: floating, responsive chat UI mounted globally from the root layout.
- `app/api/chatbot/route.ts`: validated chatbot endpoint using the existing `createHandler` middleware, optional authentication, IP rate limiting, Ollama generation, and deterministic FAQ fallback.
- `app/layout.tsx`: mounts the chatbot on public pages and authenticated workspace pages.

## Configure local Ollama
The API route uses the existing settings:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:1b-it-q4_K_M
```

Make sure Ollama is running and the configured model has been downloaded. The browser never calls Ollama directly; requests go through `/api/chatbot` on the server. If Ollama is unavailable, FAQ/navigation answers use a built-in fallback.

## Request status and privacy
- The status feature requires a signed-in session.
- Request records are retrieved server-side through the existing `listRequests` service and its role/ownership scoping.
- The chatbot does not accept a user ID from the browser to decide which records to show.
- Unauthenticated users are directed to `/login` for status lookup.

## Safety boundaries
The chatbot never submits, cancels, or changes emergency requests. Immediate-danger and CPR-related prompts receive a deterministic message telling the user to contact local emergency services; the chatbot explicitly says it does not dispatch responders. Keep this as a help feature, not an emergency dispatch channel.

## Verify
1. Start Ollama and ensure the model is available (`ollama list`).
2. Start the app with `npm run dev`.
3. Open the site and use the floating **LIVE Assistant** button.
4. Test FAQs and navigation while signed out.
5. Sign in as a requester and use **Check my request status**; verify only that user's requests appear.
6. Test as dispatcher/responder/admin/auditor and verify results remain constrained by the existing `listRequests` service.
7. Stop Ollama and confirm the FAQ fallback still responds.
8. Confirm urgent safety wording appears for immediate-danger prompts.
