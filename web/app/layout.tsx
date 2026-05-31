import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LINE返信管理",
  description: "LINEメッセージを分析し、返信ドラフトを生成する管理画面（モック）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
