import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "声優クイズ",
  description: "根据线索猜出今天的声优",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: 浏览器插件（如 Trancy）会向 <html> 注入属性，属外部因素
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
