import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EUDAMED Explorer",
  description: "EU medical-device registrations from the public EUDAMED API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
