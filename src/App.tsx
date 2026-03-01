import { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

function SpectrumWave() {
  const { viewport } = useThree();
  const count = 1024; // Number of bins for the stepped look
  const fillMeshRef = useRef<THREE.InstancedMesh>(null);
  const lineMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const fillMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0a2e3f', transparent: true, opacity: 0.8 }), []);
  const lineMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#00d2ff' }), []);

  useFrame((state) => {
    if (!fillMeshRef.current || !lineMeshRef.current) return;
    const time = state.clock.elapsedTime;
    
    const bottomY = -viewport.height / 2;
    const binWidth = viewport.width / count;
    let lastY: number | null = null;
    
    for (let i = 0; i < count; i++) {
      const normalizedX = i / count;
      
      // Stepped noise floor
      let db = -52 + (Math.random() - 0.5) * 8; 
      
      // Slow moving baseline humps
      db += Math.sin(normalizedX * 15 + time * 2) * 2;
      db += Math.sin(normalizedX * 40 - time * 1.5) * 1.5;
      
      // Simulated peaks matching the reference image
      const peaks = [
        { pos: 0.02, width: 0.001, amp: 15 },
        { pos: 0.06, width: 0.001, amp: 12 },
        { pos: 0.10, width: 0.001, amp: 18 },
        { pos: 0.16, width: 0.0015, amp: 30 },
        { pos: 0.19, width: 0.001, amp: 45 }, // Largest peak
        { pos: 0.22, width: 0.0015, amp: 35 },
        { pos: 0.25, width: 0.001, amp: 25 },
        { pos: 0.27, width: 0.001, amp: 18 },
        { pos: 0.30, width: 0.001, amp: 15 },
        
        { pos: 0.72, width: 0.001, amp: 20 },
        { pos: 0.75, width: 0.001, amp: 25 },
        { pos: 0.78, width: 0.001, amp: 18 },
        { pos: 0.85, width: 0.001, amp: 22 },
        { pos: 0.88, width: 0.001, amp: 20 },
        { pos: 0.95, width: 0.001, amp: 24 },
      ];
      
      for (const peak of peaks) {
        const dist = Math.abs(normalizedX - peak.pos);
        if (dist < peak.width * 4) {
          const envelope = Math.exp(-(dist * dist) / (peak.width * peak.width));
          db += envelope * peak.amp * (0.7 + 0.3 * Math.random());
        }
      }
      
      if (db > 0) db = 0;
      if (db < -75) db = -75;
      
      // Map dB to Y coordinate (-viewport.height/2 to viewport.height/2)
      // Graph shows 0dB at top, -75dB at bottom
      const y = ((db + 75) / 75) * viewport.height - viewport.height / 2; 
      
      const x = (normalizedX - 0.5) * viewport.width;
      
      // 1. Fill
      const fillHeight = Math.max(y - bottomY, 0);
      dummy.position.set(x + binWidth / 2, bottomY + fillHeight / 2, 0);
      dummy.scale.set(binWidth * 1.05, fillHeight, 1);
      dummy.updateMatrix();
      fillMeshRef.current.setMatrixAt(i, dummy.matrix);
      
      // 2. Line (Horizontal step)
      const lineThickness = 0.002 * viewport.height;
      dummy.position.set(x + binWidth / 2, y, 0);
      dummy.scale.set(binWidth * 1.05, lineThickness, 1);
      dummy.updateMatrix();
      lineMeshRef.current.setMatrixAt(i * 2, dummy.matrix);
      
      // 3. Line (Vertical connection to previous step)
      if (lastY !== null) {
        const minY = Math.min(lastY, y);
        const maxY = Math.max(lastY, y);
        const vHeight = maxY - minY;
        dummy.position.set(x, minY + vHeight / 2, 0);
        dummy.scale.set(lineThickness, vHeight + lineThickness, 1);
        dummy.updateMatrix();
        lineMeshRef.current.setMatrixAt(i * 2 + 1, dummy.matrix);
      } else {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        lineMeshRef.current.setMatrixAt(i * 2 + 1, dummy.matrix);
      }
      
      lastY = y;
    }
    
    fillMeshRef.current.instanceMatrix.needsUpdate = true;
    lineMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={fillMeshRef} args={[geometry, fillMaterial, count]} />
      <instancedMesh ref={lineMeshRef} args={[geometry, lineMaterial, count * 2]} />
    </group>
  );
}

export default function App() {
  return (
    <div className="w-full h-screen bg-[#050505] flex items-center justify-center p-4 md:p-8 font-mono select-none">
      <div className="relative w-full max-w-6xl h-[70vh] bg-[#0b0f13] border border-[#1a262b] rounded-lg overflow-hidden shadow-2xl">
        
        {/* Grid Background */}
        <div className="absolute inset-0 flex flex-col justify-between z-0 pointer-events-none">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`h-${i}`} className="w-full h-[1px] bg-[#1a262b] opacity-60" />
          ))}
        </div>
        
        {/* Vertical Grid Lines */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 bottom-0 w-[1px] bg-[#1a262b] opacity-60 left-[16.66%]" />
          <div className="absolute top-0 bottom-0 w-[1px] bg-[#1a262b] opacity-60 left-[33.33%]" />
          <div className="absolute top-0 bottom-0 w-[1px] bg-[#8b9a2d] opacity-80 left-[50%]" />
          <div className="absolute top-0 bottom-0 w-[1px] bg-[#1a262b] opacity-60 left-[66.66%]" />
          <div className="absolute top-0 bottom-0 w-[1px] bg-[#1a262b] opacity-60 left-[83.33%]" />
        </div>

        {/* Y-Axis Labels */}
        <div className="absolute left-4 top-0 bottom-0 flex flex-col justify-between items-start text-[11px] text-[#6b7d85] z-10 pointer-events-none py-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={`yl-${i}`} className="leading-none bg-[#0b0f13] pr-2">
              {i === 0 ? '0dB' : `-${i * 10}`}
            </span>
          ))}
        </div>

        {/* X-Axis Top Labels */}
        <div className="absolute top-4 left-0 right-0 text-[11px] text-[#6b7d85] z-10 pointer-events-none">
          <span className="absolute left-[16.66%] -translate-x-1/2">100kHz</span>
          <span className="absolute left-[33.33%] -translate-x-1/2">50kHz</span>
          <span className="absolute left-[66.66%] -translate-x-1/2">50kHz</span>
          <span className="absolute left-[83.33%] -translate-x-1/2">100kHz</span>
        </div>

        {/* X-Axis Bottom Labels */}
        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end text-[12px] text-[#6b7d85] z-10 pointer-events-none">
          <span>1.088MHz</span>
          <span className="text-white font-medium flex items-center gap-2 text-[13px]">
            <span className="text-[#e2b714] text-base">🖐</span> 1.238MHz
          </span>
          <span>1.387MHz</span>
        </div>

        {/* WebGPU Canvas */}
        <div className="absolute inset-0 z-0">
          <Canvas
            orthographic
            camera={{ position: [0, 0, 5], zoom: 1 }}
            gl={async (props) => {
              const renderer = new WebGPURenderer({ ...(props as any), antialias: true, alpha: true });
              await renderer.init();
              return renderer;
            }}
          >
            <SpectrumWave />
          </Canvas>
        </div>
      </div>
    </div>
  );
}
