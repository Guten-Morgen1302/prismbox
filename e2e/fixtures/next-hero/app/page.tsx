import { HeroScene } from './HeroScene';

export default function Page() {
  return (
    <main style={{ width: '100vw', height: '100vh', background: '#0a0a0f' }}>
      <h1 style={{ position: 'absolute', top: 20, left: 20, color: '#fff', zIndex: 10, fontFamily: 'sans-serif' }}>
        Prismbox Next.js App Router Hero
      </h1>
      <HeroScene />
    </main>
  );
}
