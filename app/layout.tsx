import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pairwise - 1:1 Scheduler",
  description: "Schedule 1:1 meetings at your retreat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="pt-1 pb-9 text-center text-xs text-stone-400">
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSdRxsASHdxG31Hc2iU-K0sOD-zvHHN80vCCJjio0IKfDFaBPw/viewform?usp=header"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-stone-600 hover:underline"
          >
            Report a bug
          </a>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
