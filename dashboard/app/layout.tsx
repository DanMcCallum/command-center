import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Command Center',
  description: 'Autonomous Claude worker dashboard',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#191919] text-white">
        <Nav />
        <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
