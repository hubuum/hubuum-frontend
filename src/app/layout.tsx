import type { Metadata } from "next";
import type { ReactNode } from "react";

import { QueryProvider } from "@/components/query-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hubuum Console",
  description: "Frontend console for the Hubuum REST application."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script src="/theme-init.js" />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
