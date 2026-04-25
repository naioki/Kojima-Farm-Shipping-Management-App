import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "農業DXプラットフォーム",
  description: "地域農業DXプラットフォーム - 出荷管理システム",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "農業DX" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16a34a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
