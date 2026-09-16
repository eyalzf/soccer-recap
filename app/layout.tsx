import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'תקצירים',
  description: 'תקצירי משחקי כדורגל מהליגות המובילות',
};

export const viewport: Viewport = {
  themeColor: '#0d1526',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
