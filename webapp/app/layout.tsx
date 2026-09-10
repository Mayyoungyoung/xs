import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "墨脉 · AI 小说工作台",
  description: "从一句灵感到完整长篇，让 AI 和你一起构建设定、人物、情节与正文。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
