# next-hero

A minimal Next.js App Router project with React 19 and React Three Fiber 9.

Used as an end-to-end fixture for Prismbox in Next.js App Router mode:
- `app/layout.tsx`: Root layout (Server Component - left untouched by Prismbox)
- `app/page.tsx`: Page component (Server Component - left untouched by Prismbox)
- `app/HeroScene.tsx`: 3D Hero scene (Client Component with `'use client'` and `<Canvas>` - instrumented by Prismbox at dev time)
