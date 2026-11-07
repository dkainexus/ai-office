import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Office 后台 · DK Global Group",
  description: "AI Office 的管理后台：预算、金库、模型路由",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
