import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/lib/AuthContext'
import { RepoProvider } from '@/contexts/RepoContext'
import { Header } from '@/components/sections/Header'
import { Footer } from '@/components/sections/Footer'
import { ThemeProvider } from 'next-themes'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitRAG",
  description: "RAG over GitHub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <RepoProvider>
            <div className="min-h-screen pb-16">
              <Header />
              <main className="pt-16">
                <ThemeProvider attribute="class">
                  {children}
                </ThemeProvider>
              </main>
              <Footer />
            </div>
          </RepoProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
