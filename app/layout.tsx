import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { MockStoreProvider } from "@/lib/mock-store";
import { LiveChatbot } from "@/components/chatbot/live-chatbot";

export const metadata: Metadata = {
  title: { default: "LIVE", template: "%s · LIVE" },
  description: "Responsive emergency request and response tracking prototype.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: "#f6f8fb",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <MockStoreProvider>{children}<LiveChatbot /></MockStoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
