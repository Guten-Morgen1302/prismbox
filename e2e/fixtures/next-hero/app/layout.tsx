import type { ReactNode } from 'react';

export const metadata = {
  title: 'Next Hero - Prismbox E2E',
  description: 'A Next.js App Router landing page with 3D R3F Canvas',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, overflow: 'hidden' }}>{children}</body>
    </html>
  );
}
