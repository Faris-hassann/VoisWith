import type { Metadata } from "next";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppProviders } from "@/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebTest AI",
  description: "AI-assisted functional website testing console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>
          <div className="flex min-h-screen">
            <AppSidebar />
            <div className="min-w-0 flex-1">
              <AppHeader />
              <main className="mx-auto max-w-7xl p-4 lg:p-6">{children}</main>
            </div>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
