# LIVE Assistant: how it works

LIVE Assistant is a help chatbot built into the LIVE website. It answers questions about using the platform, takes users to the right pages, and shows request status to signed-in users. It adapts to the role of the person using it (requester, dispatcher, responder, admin or auditor). It is a help feature only and is not an emergency dispatch channel.

## What it includes

- `components/chatbot/live-chatbot.tsx`: the floating chat window. It shows role-based quick buttons, tappable suggestion chips, page link buttons, request status cards and a microphone button for voice input.
- `app/api/chatbot/route.ts`: the chatbot endpoint. It validates input, checks who the user is, applies the answer rules, optionally calls a local AI model, and returns a structured reply.
- `app/layout.tsx`: mounts the chatbot once, inside the authentication provider, so it appears on public pages and on every signed-in workspace page.
- `app/app/requester/new/page.tsx`: the New Request form uses the same browser speech recognition for its short description field.

## How a message is handled

1. The user types a message, taps a quick button or chip, or speaks into the microphone.
2. The browser sends the message and the current page path to `/api/chatbot`. It never sends a user ID.
3. The server validates the input and identifies the user from the login session cookie.
4. The server works through its checks in this order, and the first match answers:
   1. **Request status or list questions.** Signed-in users get their requests from the existing `listRequests` service. Visitors are asked to sign in.
   2. **Urgent phrases** such as "not breathing" or "immediate danger". These get a fixed message telling the user to contact local emergency services. The chatbot states that it cannot dispatch responders.
   3. **Questions about the LIVE website** (help, navigation, submitting, passwords, logging in, assigning, audit, users). These are answered by built-in rules that depend on the user's role.
   4. **Everything else.** The question goes to a local Ollama model. If Ollama is not running or fails, the built-in rules answer instead.
5. The reply can include text, page link buttons, suggestion chips and request status cards. The chat window displays them.

## Role-based behaviour

The chatbot reads the role from the server session, not from the browser, so it cannot be changed from the page.

| Role | Quick buttons | What it helps with |
| --- | --- | --- |
| Requester | FAQs, Find a page, Check my request status | Submitting a request, tracking status, history, profile |
| Dispatcher | Latest requests, Assign a responder, Find a page | Reviewing requests, assigning responders, resources |
| Responder | My assignments, Find a page | Assigned requests and history |
| Admin | Manage users, Audit log, Latest requests, Find a page | Users, organisations, audit, settings |
| Auditor | Audit log, Latest requests, Find a page | Audit logs, incidents, security and integration pages |

Each role also gets its own welcome message and its own suggestion chips. Navigation answers name the page the user is on and list only the pages that role can open, each with a button that takes them there. Visitors who are not signed in see links to Login, Register, Forgot Password and Terms and Conditions.

## Middleware and security

LIVE uses two layers of middleware, and the chatbot uses both.

**Layer 1: root middleware (`middleware.ts`).** It runs before every page request and adds a request ID and security headers. These include a Content Security Policy, `X-Content-Type-Options`, a referrer policy and HTTPS enforcement in production. It also redirects visitors away from role pages they are not allowed to open. The Content Security Policy only allows the page to call its own server, which is all the chatbot needs. The `Permissions-Policy` header allows the microphone for this site only, which is what makes voice input work.

**Layer 2: `createHandler` (`lib/middleware/api/handler.ts`).** Every API endpoint is wrapped in it, and the chatbot endpoint is configured as follows:

- `auth: "optional"`: visitors can ask general questions, and the user is identified when signed in.
- `body`: a zod schema that accepts a message of 1 to 600 characters and an optional page path up to 300 characters. Anything else is rejected.
- `rateLimit`: 20 messages per minute per IP address, to prevent abuse and to protect the AI model from overload.

Additional protections built into the chatbot:

- **The server decides who the user is.** The browser sends only the message and page path. It cannot choose whose requests to see.
- **Request data stays scoped.** Status lookups use the existing `listRequests` service, which applies role and ownership rules. The chatbot adds no extra access.
- **No actions.** The chatbot never submits, cancels or changes a request.
- **Safe rendering.** Replies are shown as plain text, so content cannot inject HTML or scripts into the page.
- **Prompt limits.** The AI prompt tells the model not to invent features, phone numbers, records or statuses, not to reveal private information, and not to claim it can dispatch services.
- **Minimal logging.** Only errors are logged. Chat messages are not stored.
- **Passwords.** Replies about passwords and logging in remind users never to share passwords or verification codes in the chat.

## Voice input

The microphone button uses the speech recognition built into the browser (Chrome and Edge). The recognised text appears in the message box, where the user can edit it before sending. No software has to be installed, and no audio is sent to the LIVE server for the chatbot. The button only appears in browsers that support the feature. The New Request form uses the same approach for the short description, with its original recording and transcription method as a fallback for other browsers. The browser vendor's speech service processes the audio, so users should not speak personal details into it. The microphone requires `https` or `localhost`.

## Configure local Ollama

Ollama is optional. The route uses these settings:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:1b-it-q4_K_M
```

Make sure Ollama is running and the model has been downloaded. The browser never calls Ollama directly. Requests go through `/api/chatbot` on the server. If Ollama is unavailable, the built-in answers continue to work. Do not expose an Ollama address to the public internet without authentication.

## Why this design

- **Rules first for website questions.** A small AI model can be wrong about a specific website. Fixed rules give the same correct answer every time, which matters on an emergency platform. The AI is used only for general questions that the rules do not cover.
- **A local model.** Ollama runs on our own machine or server, so there is no third-party AI service, no API key and no per-message cost, and chat text is not sent to an outside provider.
- **Built-in fallback.** The chatbot keeps working if the AI is offline, which is also how it behaves on the hosted app.
- **Reuse of existing middleware.** Using `createHandler` gives the chatbot the same authentication, validation and rate limiting as every other endpoint, with no separate security code to maintain.
- **Role awareness from the server.** Staff and requesters need different help, and taking the role from the session keeps that logic out of the browser.
- **Tappable buttons and chips.** Users can get help with a tap instead of typing, which is faster on a phone and easier for first-time users.
- **Browser voice input.** It needs no extra service and makes the New Request form quicker to fill in when someone is stressed or typing is difficult.
- **A single web component.** The chatbot lives in the Next.js app, so it works in desktop and mobile browsers and carries over unchanged if the site is installed as a web app or wrapped for mobile.

## Request status and privacy

- The status feature requires a signed-in session.
- Request records are retrieved server-side through `listRequests` and its role and ownership scoping.
- The chatbot does not accept a user ID from the browser to decide which records to show.
- Unauthenticated users are directed to `/login` for status lookup.

## Safety boundaries

The chatbot never submits, cancels or changes emergency requests. Immediate-danger and CPR-related prompts receive a fixed message telling the user to contact local emergency services, and the chatbot states that it does not dispatch responders. Keep this as a help feature, not an emergency dispatch channel.

## Limitations

- Ollama runs locally, so the hosted app uses the built-in answers unless Ollama is hosted somewhere reachable and protected.
- The built-in rules cover common questions. Unusual wording falls back to suggestion chips.
- Voice input works in Chrome and Edge and is unreliable on iPhone.
- The rate limit is held in memory, so it resets on serverless hosting.

## Verify

1. Start the app with `npm run dev`.
2. Open the site and select the floating **LIVE Assistant** button.
3. Signed out, test greetings, help, navigation and the login and password questions.
4. Sign in as a requester and use **Check my request status**. Confirm only that user's requests appear.
5. Sign in as a dispatcher, responder, admin and auditor. Confirm the quick buttons, welcome message and page lists match each role.
6. As a dispatcher, ask "How do I submit a request?" and confirm the answer explains that requests are submitted by requesters.
7. Confirm each role only sees the requests the `listRequests` service allows for it.
8. Send more than 20 messages in one minute and confirm the rate limit responds.
9. Stop Ollama and confirm the built-in answers still respond.
10. Send an urgent phrase and confirm the emergency services message appears.
11. Tap the microphone in Chrome, speak, and confirm the text appears in the message box.
