import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../../frontend/shared/landing-base.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://vertu.com"
  ),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
