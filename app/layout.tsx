import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'תקצירים',
  description: 'תקצירי משחקי כדורגל מהליגות המובילות',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
