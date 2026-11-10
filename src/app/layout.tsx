import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KNOC Discovery & Framing",
  description: "석유정보 분석 경험을 계승하는 에너지 안보 업무바통",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip" href="#main">본문으로</a>
        {children}
      </body>
    </html>
  );
}
