# LIVE TURN Server

This folder contains an optional Coturn TURN server for LIVE WebRTC calls.

It is intentionally not connected to the application yet. The existing app will continue using its current STUN configuration until TURN is explicitly enabled.

## What this provides

Coturn can relay WebRTC audio when two browsers cannot maintain a direct connection because of NAT, firewalls, or different networks.

## Requirements

- Docker Desktop
- A reachable host for calls between different networks
- Firewall/router access to the TURN ports

For local testing on the same computer or Wi-Fi, TURN may not be needed.

## Start locally for testing

Copy `.env.example` to `.env`, replace the development password, then run:

```powershell
docker compose up -d
```

This starts Coturn only. It does not change the Next.js app.

To stop it:

```powershell
docker compose down
```

## Network ports

- `3478/udp` and `3478/tcp`: TURN connections
- `49152-49200/udp`: relayed media ports

For use outside the local network, these ports must also be allowed through the computer firewall and forwarded by the router. The host needs a public IP or reachable DNS name.

## Enabling it in the app later

When the server is ready, add its URL and credentials to the app's environment configuration and add the TURN entry to the WebRTC `iceServers` list in `components/calls/call-provider.tsx`.

Do not commit real TURN passwords. Production deployments should use short-lived TURN credentials rather than a permanent frontend password.
