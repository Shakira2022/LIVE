# LIVE mobile app

This is one Android app for both **requesters** and **responders**. It opens the existing LIVE application, so account sign-in, role-based screens, APIs, and data remain in the existing system. A person's account determines which role screens they see; there are no separate role-specific app builds.

## Connect it to LIVE

The backend stays in this existing project and runs on your computer. From the repository root, start it with `npm run dev`, or use `npm run build` followed by `npm run start`. Next.js listens on the network by default, so an Android device can reach it while the server is running.

Copy `.env.example` to `.env` and set `LIVE_MOBILE_SERVER_URL` for the device you will install on. In PowerShell, run `Copy-Item .env.example .env`, then edit `.env`:

- Android Emulator: `http://10.0.2.2:3000`.
- Physical Android phone: `http://<computer-wi-fi-ip>:3000` (both devices on the same Wi-Fi, and allow the port through Windows Firewall).

The app connects to that running server; it does not start Node.js or the backend on the phone. After changing `.env`, run `npm run android:sync` again before building so the URL is copied into the Android app.

The Android native project has already been generated in `mobile/android`. From this directory, sync it and open it in Android Studio:

```sh
npm install
npm run android:sync
npm run android:open
```

In Android Studio, build the debug APK and install it on a connected phone. The Android SDK and Java/Gradle toolchain must be installed. This workspace does not currently have those tools, so an APK cannot be built here yet. The native shell requests microphone permission for the existing voice input and calling features.

If the Android platform is ever recreated, run `npm run android:add` once before syncing.

## Current boundary

The existing LIVE site is a Next.js server-rendered app with API routes; it cannot be copied into a standalone Capacitor bundle as-is. This shell connects to the running LIVE server. Capacitor documents `server.url` for live reload/development; before publishing through an app store, replace this remote-server shell with a bundled mobile client that calls the existing APIs.

Use HTTPS for production. Voice capture through the existing browser `getUserMedia()` API requires a secure context; a plain HTTP LAN address may therefore prevent microphone access even though the Android app declares microphone permission. For reliable voice on a physical phone, use a trusted HTTPS address for the running server or add a native speech bridge. This project does not change the web app, database, or authentication behavior.
