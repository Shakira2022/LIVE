import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { MockStoreProvider } from "@/lib/mock-store";
import { MobileKeyboardManager } from "@/components/layout/mobile-keyboard-manager";
import { DisplayThemeInitializer } from "@/components/layout/display-theme-initializer";
import { OfflineBanner } from "@/components/feedback/offline-banner";

export const metadata: Metadata = {
  title: { default: "LIVE", template: "%s · LIVE" },
  description: "Responsive emergency request and response tracking prototype.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f6f8fb",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DisplayThemeInitializer />
        <MobileKeyboardManager />
        <OfflineBanner />
        <AuthProvider>
          <MockStoreProvider>{children}</MockStoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
