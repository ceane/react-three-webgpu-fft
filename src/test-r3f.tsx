import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';

const App = () => (
  <Canvas gl={async (props) => {
    const renderer = new WebGPURenderer(props as any);
    await renderer.init();
    console.log('Renderer initialized');
    return renderer;
  }}>
    <mesh>
      <boxGeometry />
      <meshBasicMaterial color="red" />
    </mesh>
  </Canvas>
);

console.log('App defined');
