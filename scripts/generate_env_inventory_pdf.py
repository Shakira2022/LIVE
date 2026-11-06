from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

OUT = Path("output/pdf/live-environment-inventory-sanitized.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleCenter", parent=styles["Title"], alignment=TA_CENTER, textColor=colors.HexColor("#123B5D"), spaceAfter=10))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], textColor=colors.HexColor("#123B5D"), spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontSize=8.5, leading=11))
styles.add(ParagraphStyle(name="Mono", parent=styles["Code"], fontName="Courier", fontSize=7.5, leading=9.5, backColor=colors.HexColor("#F3F6F8"), borderPadding=5))
styles.add(ParagraphStyle(name="TableCell", parent=styles["BodyText"], fontSize=7.2, leading=8.4, spaceAfter=0))
styles.add(ParagraphStyle(name="TableHead", parent=styles["BodyText"], fontSize=7.2, leading=8.4, textColor=colors.white, fontName="Helvetica-Bold", spaceAfter=0))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#607080"))
    canvas.drawString(18 * mm, 10 * mm, "LIVE environment inventory - sanitized; no secret values included")
    canvas.drawRightString(192 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()

def table(rows, widths):
    wrapped = []
    for row_index, row in enumerate(rows):
        style = styles["TableHead"] if row_index == 0 else styles["TableCell"]
        wrapped.append([Paragraph(str(cell).replace("&", "&amp;"), style) for cell in row])
    t = Table(wrapped, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123B5D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#B8C5CF")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F8FA")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t

story = []
story += [Paragraph("LIVE Environment Inventory", styles["TitleCenter"]),
          Paragraph("Sanitized project structure and environment-variable reference", styles["Heading2"]),
          Spacer(1, 4),
          Paragraph("This document intentionally excludes live credentials and secret values. Use the accompanying text templates and your approved secret manager to populate local or deployment environments.", styles["BodyText"]),
          Spacer(1, 8)]

story += [Paragraph("Security boundary", styles["Section"]),
          Paragraph("The repository contains sensitive values in local-only files such as <font name='Courier'>.env.local</font> and <font name='Courier'>TURN-Server/.env</font>. Do not copy those values into documents, tickets, chat, source control, or frontend bundles. Rotate any credential that has already been exposed outside its intended secret store.", styles["BodyText"])]

story += [Paragraph("Project structure", styles["Section"]),
          Paragraph("<font name='Courier'>app/</font> - Next.js routes for public pages and requester, dispatcher, responder, admin, and auditor workflows.<br/><font name='Courier'>components/</font> - authentication, dashboard, layout, maps, requests, and reusable UI components.<br/><font name='Courier'>lib/</font> - shared types, routing, utilities, mock data/store, and Supabase clients.<br/><font name='Courier'>supabase/</font> - schema and database migrations, including the active-assignment constraint migration.<br/><font name='Courier'>TURN-Server/</font> - optional Coturn Docker deployment and its environment template.<br/><font name='Courier'>docs/</font> - setup and operational documentation.<br/><font name='Courier'>scripts/</font> - local utility scripts, including this PDF generator.", styles["BodyText"])]

docker_rows = [["Docker item", "Details"]]
docker_rows += [
    ("Service", "coturn - optional TURN relay for WebRTC calls"),
    ("Image", "coturn/coturn:latest"),
    ("Compose file", "TURN-Server/docker-compose.yml"),
    ("Required host software", "Docker Desktop or Docker Engine with Docker Compose"),
    ("Published ports", "3478 TCP/UDP; TURN_MIN_PORT-TURN_MAX_PORT UDP (default 49152-49200)"),
    ("Required env", "TURN_USERNAME, TURN_PASSWORD, TURN_REALM, TURN_MIN_PORT, TURN_MAX_PORT"),
]
story += [Paragraph("Docker installation and services", styles["Section"]), table(docker_rows, [48*mm, 126*mm]),
          Spacer(1, 6), Paragraph("Run from the repository root:", styles["Small"]),
          Paragraph("<font name='Courier'>Copy-Item TURN-Server/.env.example TURN-Server/.env<br/>docker compose --env-file TURN-Server/.env -f TURN-Server/docker-compose.yml up -d<br/>docker compose --env-file TURN-Server/.env -f TURN-Server/docker-compose.yml ps<br/>docker compose --env-file TURN-Server/.env -f TURN-Server/docker-compose.yml down</font>", styles["Mono"]),
          Paragraph("The current Docker configuration installs and runs Coturn only. It does not containerize the Next.js app or Supabase; those are configured separately in this repository. Replace the image tag with a pinned version for production after testing.", styles["Small"])]

story += [Paragraph("What the TURN server does", styles["Section"]),
          Paragraph("WebRTC tries to connect two callers directly. If NAT, a firewall, or different networks prevent a direct connection, the TURN server relays the audio and video traffic between them. Coturn is the relay service used here. It is a fallback path, not a replacement for the application, Supabase, or the browser WebRTC code.", styles["BodyText"]),
          Paragraph("To get it working: (1) run Docker on a reachable host, (2) set a strong TURN username and password plus a reachable TURN realm or hostname, (3) allow TCP/UDP 3478 and UDP 49152-49200 through the host firewall and router, (4) start the Compose service, and (5) add the TURN URL and credentials to the app's WebRTC iceServers configuration. The current repository contains the server setup, but the app is not yet connected to TURN automatically, so step 5 is still required before calls will use it.", styles["BodyText"]),
          Paragraph("For local testing on one computer or the same Wi-Fi network, TURN may not be necessary. For production, use a public DNS name or IP, TLS where appropriate, and short-lived TURN credentials instead of a permanent frontend password.", styles["Small"])]

story += [PageBreak(), Paragraph("Install and start the TURN server", styles["Section"]),
          Paragraph("Step 1 - Install Docker Desktop. On Windows, download it from https://www.docker.com/products/docker-desktop/ and run the installer with the default settings. Restart Windows if requested, open Docker Desktop, and wait until it reports that Docker is running. Then verify the installation in PowerShell:", styles["BodyText"]),
          Spacer(1, 4),
          Paragraph("<font name='Courier'>docker --version<br/>docker compose version</font>", styles["Mono"]),
          Paragraph("Step 2 - Get the project. Clone the repository or open the folder downloaded from GitHub, then open PowerShell in the project root. The project root is the folder containing <font name='Courier'>package.json</font> and <font name='Courier'>TURN-Server</font>.", styles["BodyText"]),
          Paragraph("Step 3 - Create the TURN environment file and fill in the values from your secret manager:", styles["BodyText"]),
          Spacer(1, 4),
          Paragraph("<font name='Courier'>Copy-Item TURN-Server/.env.example TURN-Server/.env<br/>notepad TURN-Server/.env</font>", styles["Mono"]),
          Paragraph("Set TURN_USERNAME, TURN_PASSWORD, TURN_REALM, TURN_MIN_PORT, and TURN_MAX_PORT. Do not commit this file or paste its secrets into the PDF.", styles["Small"]),
          Paragraph("Step 4 - Allow the network ports. On the TURN host and router, allow 3478 TCP and UDP plus the UDP relay range configured by TURN_MIN_PORT and TURN_MAX_PORT. For the included example, that range is 49152-49200. A public DNS name or reachable public IP is required for callers on other networks.", styles["BodyText"]),
          Paragraph("Step 5 - Start Coturn and check it:", styles["BodyText"]),
          Spacer(1, 4),
          Paragraph("<font name='Courier'>docker compose --env-file TURN-Server/.env -f TURN-Server/docker-compose.yml up -d<br/>docker compose --env-file TURN-Server/.env -f TURN-Server/docker-compose.yml ps<br/>docker compose --env-file TURN-Server/.env -f TURN-Server/docker-compose.yml logs -f coturn</font>", styles["Mono"]),
          Paragraph("Step 6 - Connect the app. Add the TURN server URL, username, and short-lived credential to the application's WebRTC <font name='Courier'>iceServers</font> list. Restart the Next.js app after changing environment variables, then test a call from two different networks. If the container is running but calls do not relay, check the public hostname, firewall/router forwarding, and the relay port range.", styles["BodyText"])]

story += [PageBreak()]
project_rows = [["Variable", "Scope / purpose", "Value in this document"]]
project_vars = [
    ("NEXT_PUBLIC_SUPABASE_URL", "Browser + server Supabase project URL", "[REDACTED]"),
    ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Browser Supabase public key", "[REDACTED]"),
    ("SUPABASE_SERVICE_ROLE_KEY", "Server-only Supabase privileged key", "[REDACTED]"),
    ("JWT_SECRET / JWT_ISSUER / JWT_AUDIENCE", "Server token signing and validation", "[REDACTED]"),
    ("ACCESS_TOKEN_TTL_SECONDS / REFRESH_TOKEN_TTL_SECONDS", "Token lifetimes", "[REDACTED]"),
    ("NODE_ENV / LOG_LEVEL / ALLOW_INSECURE_COOKIES", "Runtime behavior and logging", "[REDACTED]"),
    ("ROUTING_MAX_RADIUS_KM / RATE_LIMIT_ENABLED", "Routing and rate-limit controls", "[REDACTED]"),
    ("NEXT_PUBLIC_MAP_* / NEXT_PUBLIC_ROUTE_LINK_PROVIDER", "Browser map and route configuration", "[REDACTED]"),
    ("NEXT_PUBLIC_TRACKING_* / NEXT_PUBLIC_POLL_INTERVAL_MS", "Browser tracking intervals", "[REDACTED]"),
    ("GEMINI_API_KEY / GEMINI_MODEL", "Optional requester AI", "[REDACTED]"),
    ("OLLAMA_BASE_URL / OLLAMA_MODEL", "Optional local AI", "[REDACTED]"),
    ("GMAIL_USER / GMAIL_APP_PASSWORD", "Mail / notification integration", "[REDACTED]"),
    ("NEXT_PUBLIC_TURN_URL / NEXT_PUBLIC_TURN_USERNAME / NEXT_PUBLIC_TURN_CREDENTIAL", "Optional WebRTC TURN client settings", "[REDACTED]"),
]
project_rows += project_vars
story += [Paragraph("Main project environment", styles["Section"]), table(project_rows, [58*mm, 78*mm, 38*mm])]

turn_rows = [["Variable", "Used by", "Value"]]
turn_rows += [
    ("TURN_USERNAME", "Coturn long-term credential username", "[REDACTED]"),
    ("TURN_PASSWORD", "Coturn long-term credential password", "[REDACTED]"),
    ("TURN_REALM", "Coturn realm / reachable host identity", "[REDACTED]"),
    ("TURN_MIN_PORT / TURN_MAX_PORT", "UDP relay port range", "[REDACTED]"),
]
story += [PageBreak(), Paragraph("TURN server environment", styles["Section"]), table(turn_rows, [58*mm, 78*mm, 38*mm]), Spacer(1, 8),
          Paragraph("<font name='Courier'>TURN-Server/docker-compose.yml</font> passes these values to Coturn and publishes 3478 TCP/UDP plus the configured relay UDP range. Keep the TURN password server-side and prefer short-lived credentials for production.", styles["Small"])]

story += [Paragraph("Operational notes", styles["Section"]),
          Paragraph("1. Copy <font name='Courier'>docs/env.project.template.txt</font> to the appropriate local/deployment environment file and populate it from the secret manager.<br/>2. Copy <font name='Courier'>docs/env.turn-server.template.txt</font> to <font name='Courier'>TURN-Server/.env</font> only on the TURN host.<br/>3. Confirm secret files are ignored by Git before committing.<br/>4. Never place server-only keys in variables prefixed <font name='Courier'>NEXT_PUBLIC_</font>.<br/>5. If credentials were shared accidentally, revoke and rotate them at the provider before continuing.", styles["BodyText"]),
          Spacer(1, 10), Paragraph("Generated companion files", styles["Section"]),
          Paragraph("The repository now includes sanitized, copy-ready templates for the main project and TURN server. They preserve variable names and deployment intent but contain placeholders instead of live credentials.", styles["BodyText"])]

doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=16*mm, bottomMargin=18*mm, title="LIVE Environment Inventory - Sanitized")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
