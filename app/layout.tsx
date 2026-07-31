import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MirrorFlow 歷程之鏡",
  description: "寫作歷程記錄與回饋研究工具",
  // 研究工具，不對外公開索引
  robots: { index: false, follow: false },
};

// 場域為國中教室的 iPad，固定視窗縮放避免學生誤觸縮放後找不回版面
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
