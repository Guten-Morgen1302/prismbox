'use client';

import { Canvas } from '@react-three/fiber';

export function HeroScene() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshStandardMaterial color="#6366f1" roughness={0.3} metalness={0.2} />
      </mesh>
    </Canvas>
  );
}
