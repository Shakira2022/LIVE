import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

const appUrl = process.env.LIVE_MOBILE_SERVER_URL?.trim();

if (appUrl) {
  const parsedUrl = new URL(appUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("LIVE_MOBILE_SERVER_URL must use HTTPS (HTTP is allowed for local development only).");
  }
}

const config: CapacitorConfig = {
  appId: "org.live.response.mobile",
  appName: "LIVE",
  webDir: "www",
  ...(appUrl
    ? {
        server: {
          url: appUrl,
          cleartext: appUrl.startsWith("http://"),
        },
      }
    : {}),
};

export default config;
