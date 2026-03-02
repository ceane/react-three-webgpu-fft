import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Settings2, RotateCcw, Pause, Play } from 'lucide-react';

const MIN_FREQ = 0.009; // 9 kHz
const MAX_FREQ = 5.0;   // 5 MHz
const BASE_BW = 3.2;    // 3.2 MHz sample rate (max window)
const COUNT = 1024;

const CMAP = [
  [0,0,32], [0,0,145], [30,144,255], [255,255,255], [255,255,0], [254,109,22], [255,0,0]
];

function getColor(v: number) {
  const idx = Math.max(0, Math.min(1, v)) * (CMAP.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  if (i >= CMAP.length - 1) return CMAP[CMAP.length - 1];
  const c1 = CMAP[i], c2 = CMAP[i+1];
  return [c1[0] + (c2[0]-c1[0])*f, c1[1] + (c2[1]-c1[1])*f, c1[2] + (c2[2]-c1[2])*f];
}

function getSignal(f: number, t: number) {
  let db = -85 + (Math.random() - 0.5) * 8;
  db += Math.sin(f * 30 + t * 2) * 2;
  db += Math.sin(f * 100 - t * 1.5) * 1.5;
  
  const peaks = [
    [0.1, 0.005, 20], [0.5, 0.01, 30], [1.088, 0.002, 45], [1.238, 0.005, 50],
    [1.387, 0.002, 40], [2.5, 0.05, 25], [3.8, 0.01, 35], [4.2, 0.008, 42]
  ];
  
  for (const [pf, pw, pa] of peaks) {
    const d = Math.abs(f - pf);
    if (d < pw * 4) {
      db += Math.exp(-(d * d) / (pw * pw)) * pa * (0.7 + 0.3 * Math.random());
    }
  }
  return Math.min(0, Math.max(-120, db));
}

function SpectrumWave({ stateRef, sharedFftData, rawFftData }: { stateRef: any, sharedFftData: any, rawFftData: any }) {
  const { viewport } = useThree();
  const fillMeshRef = useRef<THREE.InstancedMesh>(null);
  const lineMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const fillMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0a2e3f', transparent: true, opacity: 0.8 }), []);
  const lineMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#00d2ff' }), []);

  useFrame((state) => {
    if (!fillMeshRef.current || !lineMeshRef.current) return;
    const { zoom, centerFreq, minDb, maxDb, avgEnabled, fftSmoothEnabled, isPaused } = stateRef.current;
    const time = state.clock.elapsedTime;
    
    if (isPaused) return;

    const bw = BASE_BW / zoom;
    const startF = centerFreq - bw / 2;
    const bottomY = -viewport.height / 2;
    const binWidth = viewport.width / COUNT;
    let lastY: number | null = null;
    
    // 1. Compute Raw & Average
    for (let i = 0; i < COUNT; i++) {
      const f = startF + (i / COUNT) * bw;
      let db = getSignal(f, time);
      
      if (avgEnabled) {
        rawFftData.current[i] = rawFftData.current[i] * 0.8 + db * 0.2;
      } else {
        rawFftData.current[i] = db;
      }
    }

    // 2. Apply FFT Smoothing & Render
    for (let i = 0; i < COUNT; i++) {
      let db = rawFftData.current[i];
      if (fftSmoothEnabled) {
        const prev = i > 0 ? rawFftData.current[i - 1] : db;
        const next = i < COUNT - 1 ? rawFftData.current[i + 1] : db;
        db = (prev + db + next) / 3;
      }
      sharedFftData.current[i] = db;

      if (db > maxDb) db = maxDb;
      if (db < minDb) db = minDb;
      
      const dbRange = maxDb - minDb;
      const y = ((db - minDb) / dbRange) * viewport.height - viewport.height / 2; 
      const normalizedX = i / COUNT;
      const x = (normalizedX - 0.5) * viewport.width;
      
      const fillHeight = Math.max(y - bottomY, 0);
      dummy.position.set(x + binWidth / 2, bottomY + fillHeight / 2, 0);
      dummy.scale.set(binWidth * 1.05, fillHeight, 1);
      dummy.updateMatrix();
      fillMeshRef.current.setMatrixAt(i, dummy.matrix);
      
      const lineThickness = 0.002 * viewport.height;
      dummy.position.set(x + binWidth / 2, y, 0);
      dummy.scale.set(binWidth * 1.05, lineThickness, 1);
      dummy.updateMatrix();
      lineMeshRef.current.setMatrixAt(i * 2, dummy.matrix);
      
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
      <instancedMesh ref={fillMeshRef} args={[geometry, fillMaterial, COUNT]} />
      <instancedMesh ref={lineMeshRef} args={[geometry, lineMaterial, COUNT * 2]} />
    </group>
  );
}

function Waterfall({ stateRef, sharedFftData }: { stateRef: any, sharedFftData: any }) {
  const { viewport } = useThree();
  const height = 512;
  
  const wfData = useMemo(() => new Uint8Array(COUNT * height * 4), []);
  const wfTexture = useMemo(() => {
    const tex = new THREE.DataTexture(wfData, COUNT, height, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }, [wfData]);

  useFrame(() => {
    const { minDb, maxDb, wfSmoothEnabled, isPaused } = stateRef.current;
    
    if (isPaused) return;

    const filter = wfSmoothEnabled ? THREE.LinearFilter : THREE.NearestFilter;
    if (wfTexture.magFilter !== filter) {
      wfTexture.magFilter = filter;
      wfTexture.minFilter = filter;
      wfTexture.needsUpdate = true;
    }

    // Shift data down (copy rows 1..511 to rows 0..510)
    wfData.copyWithin(0, COUNT * 4, COUNT * height * 4);
    
    // Write new row to top (row 511)
    const topRowOffset = COUNT * (height - 1) * 4;
    const dbRange = maxDb - minDb;
    
    for (let i = 0; i < COUNT; i++) {
      const db = sharedFftData.current[i];
      const normDb = Math.max(0, Math.min(1, (db - minDb) / dbRange));
      const color = getColor(normDb);
      
      const idx = topRowOffset + i * 4;
      wfData[idx] = color[0];
      wfData[idx + 1] = color[1];
      wfData[idx + 2] = color[2];
      wfData[idx + 3] = 255;
    }
    
    wfTexture.needsUpdate = true;
  });

  return (
    <mesh>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <meshBasicMaterial map={wfTexture} />
    </mesh>
  );
}

export default function App() {
  const [zoom, setZoom] = useState(1);
  const [centerFreq, setCenterFreq] = useState(2.5);
  const [minDb, setMinDb] = useState(-100);
  const [maxDb, setMaxDb] = useState(0);
  
  const [avgEnabled, setAvgEnabled] = useState(false);
  const [fftSmoothEnabled, setFftSmoothEnabled] = useState(false);
  const [wfSmoothEnabled, setWfSmoothEnabled] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  
  const stateRef = useRef({ zoom, centerFreq, minDb, maxDb, avgEnabled, fftSmoothEnabled, wfSmoothEnabled, isPaused });
  const vfoTrackRef = useRef<HTMLDivElement>(null);
  
  const sharedFftData = useRef(new Float32Array(COUNT).fill(-120));
  const rawFftData = useRef(new Float32Array(COUNT).fill(-120));

  useEffect(() => {
    stateRef.current = { zoom, centerFreq, minDb, maxDb, avgEnabled, fftSmoothEnabled, wfSmoothEnabled, isPaused };
  }, [zoom, centerFreq, minDb, maxDb, avgEnabled, fftSmoothEnabled, wfSmoothEnabled, isPaused]);

  const bw = BASE_BW / zoom;
  const startF = centerFreq - bw / 2;
  const endF = centerFreq + bw / 2;

  const handleVfoDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!vfoTrackRef.current) return;
    const track = vfoTrackRef.current;
    
    const updateFreq = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const totalSpan = MAX_FREQ - MIN_FREQ;
      let newCenter = MIN_FREQ + ratio * totalSpan;
      
      const halfBw = (BASE_BW / stateRef.current.zoom) / 2;
      newCenter = Math.max(MIN_FREQ + halfBw, Math.min(MAX_FREQ - halfBw, newCenter));
      setCenterFreq(newCenter);
    };

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    updateFreq(clientX);

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      updateFreq(cx);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setCenterFreq(f => Math.max(MIN_FREQ + bw/2, f - 0.05));
      } else if (e.key === 'ArrowRight') {
        setCenterFreq(f => Math.min(MAX_FREQ - bw/2, f + 0.05));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bw]);

  const formatFreq = (f: number) => f >= 1 ? `${f.toFixed(3)}MHz` : `${(f * 1000).toFixed(0)}kHz`;

  const getTicks = () => {
    const step = bw > 2 ? 0.5 : bw > 0.5 ? 0.1 : bw > 0.1 ? 0.05 : 0.01;
    const ticks = [];
    const firstTick = Math.ceil(startF / step) * step;
    for (let f = firstTick; f < endF; f += step) {
      // Prevent collision with center and edges
      const distToCenter = Math.abs(f - centerFreq);
      const distToStart = Math.abs(f - startF);
      const distToEnd = Math.abs(f - endF);
      
      // Minimum distance ratio to prevent text overlap
      const minRatio = 0.08; 
      
      if (distToCenter > bw * minRatio && distToStart > bw * minRatio && distToEnd > bw * minRatio) {
        ticks.push(f);
      }
    }
    return ticks;
  };

  const totalSpan = MAX_FREQ - MIN_FREQ;
  const thumbWidthPct = (bw / totalSpan) * 100;
  const thumbLeftPct = ((startF - MIN_FREQ) / totalSpan) * 100;

  const resetView = () => {
    setZoom(1);
    setMinDb(-100);
    setMaxDb(0);
    setCenterFreq(2.5);
  };

  const ToggleBtn = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors w-full ${
        active 
          ? 'bg-[#2a2a2a] border-[#555] text-white' 
          : 'bg-[#111] border-[#222] text-[#888] hover:bg-[#1a1a1a]'
      }`}
    >
      <span className="text-[10px] w-3">{active ? '▶' : '▷'}</span>
      <span className="font-medium tracking-wider">{label}</span>
    </button>
  );

  return (
    <div className="w-full h-screen bg-[#050505] flex flex-col font-mono select-none text-[#6b7d85] text-[11px] overflow-hidden">
      
      {/* Top: Spectrum Analyzer */}
      <div className="relative h-[45vh] w-full border-b border-[#1a262b]">
        {/* Grid Lines */}
        <div className="absolute inset-0 flex flex-col justify-between z-0 pointer-events-none">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`h-${i}`} className="w-full h-[1px] bg-[#1a262b] opacity-60" />
          ))}
        </div>
        
        {/* Y-Axis Labels */}
        <div className="absolute left-2 top-0 bottom-0 flex flex-col justify-between items-start z-10 pointer-events-none py-1">
          {Array.from({ length: 6 }).map((_, i) => {
            const db = maxDb - i * ((maxDb - minDb) / 5);
            return <span key={`yl-${i}`} className="bg-[#050505] pr-1">{db.toFixed(0)}dB</span>;
          })}
        </div>

        {/* Dynamic Ticks (Lines only, labels moved to VFO) */}
        {getTicks().map(f => {
          const leftPct = ((f - startF) / bw) * 100;
          return (
            <div key={f} className="absolute top-0 bottom-0 w-[1px] bg-[#1a262b] opacity-60 z-0 pointer-events-none" style={{ left: `${leftPct}%` }} />
          );
        })}

        {/* Center Line */}
        <div className="absolute top-0 bottom-0 w-[1px] bg-[#8b9a2d] opacity-80 left-[50%] z-0 pointer-events-none" />

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
            <SpectrumWave stateRef={stateRef} sharedFftData={sharedFftData} rawFftData={rawFftData} />
          </Canvas>
        </div>

        {/* Top Controls (Pause & Settings) */}
        <div className="absolute right-4 top-4 z-30 flex gap-2">
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className={`p-2 border rounded transition-colors backdrop-blur-sm ${
              isPaused 
                ? 'bg-[#e2b714]/20 border-[#e2b714] text-[#e2b714]' 
                : 'bg-[#0b0f13]/80 border-[#1a262b] text-[#6b7d85] hover:text-white'
            }`}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button 
            onClick={() => setControlsOpen(!controlsOpen)}
            className="p-2 bg-[#0b0f13]/80 border border-[#1a262b] rounded text-[#6b7d85] hover:text-white transition-colors backdrop-blur-sm"
          >
            <Settings2 size={16} />
          </button>
        </div>

        {/* Sliders & Toggles Overlay */}
        {controlsOpen && (
          <div className="absolute right-4 top-14 z-20 bg-[#0b0f13]/90 p-4 rounded-lg border border-[#1a262b] backdrop-blur-md flex flex-col gap-6 shadow-2xl">
            <div className="flex gap-6 justify-center">
              <div className="flex flex-col items-center gap-2">
                <span>Zoom</span>
                <input 
                  type="range" min="0" max="100" 
                  value={(Math.log10(zoom) / Math.log10(100)) * 100}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    const newZoom = Math.pow(10, (val / 100) * 2);
                    const newBw = BASE_BW / newZoom;
                    setCenterFreq(f => Math.max(MIN_FREQ + newBw/2, Math.min(MAX_FREQ - newBw/2, f)));
                    setZoom(newZoom);
                  }}
                  className="h-32 appearance-none bg-[#1a262b] w-2 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#00d2ff] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                />
                <span>{zoom.toFixed(1)}x</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span>Max</span>
                <input 
                  type="range" min="-80" max="0" value={maxDb}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val > minDb + 10) setMaxDb(val);
                  }}
                  className="h-32 appearance-none bg-[#1a262b] w-2 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#00d2ff] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                />
              </div>
              <div className="flex flex-col items-center gap-2">
                <span>Min</span>
                <input 
                  type="range" min="-120" max="-20" value={minDb}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val < maxDb - 10) setMinDb(val);
                  }}
                  className="h-32 appearance-none bg-[#1a262b] w-2 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#00d2ff] [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-[#1a262b]">
              <ToggleBtn label="AVG" active={avgEnabled} onClick={() => setAvgEnabled(!avgEnabled)} />
              <ToggleBtn label="FFT" active={fftSmoothEnabled} onClick={() => setFftSmoothEnabled(!fftSmoothEnabled)} />
              <ToggleBtn label="WF" active={wfSmoothEnabled} onClick={() => setWfSmoothEnabled(!wfSmoothEnabled)} />
              
              <button 
                onClick={resetView}
                className="mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[#1a262b] bg-[#111] text-[#888] hover:bg-[#1a1a1a] hover:text-white transition-colors"
              >
                <RotateCcw size={14} />
                <span className="font-medium tracking-wider">RESET</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Middle: VFO & Axis */}
      <div className="h-[70px] bg-[#0b0f13] flex flex-col justify-center px-4 gap-2 border-b border-[#1a262b] shrink-0 relative">
        <div className="absolute left-4 bottom-8 text-[12px]">{formatFreq(startF)}</div>
        
        {/* Dynamic Tick Labels */}
        {getTicks().map(f => {
          const leftPct = ((f - startF) / bw) * 100;
          return (
            <div key={f} className="absolute bottom-8 text-[12px] text-[#4a5a63] -translate-x-1/2" style={{ left: `${leftPct}%` }}>
              {formatFreq(f)}
            </div>
          );
        })}
        
        {/* Absolutely centered frequency to prevent jumping */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-8 text-white font-medium flex items-center gap-2 text-[13px] bg-[#0b0f13] px-2 z-10">
          <span className="text-[#e2b714] text-base">○</span> {formatFreq(centerFreq)}
        </div>
        
        <div className="absolute right-4 bottom-8 text-[12px]">{formatFreq(endF)}</div>
        
        {/* VFO Track */}
        <div 
          ref={vfoTrackRef}
          onMouseDown={handleVfoDrag}
          onTouchStart={handleVfoDrag}
          className="w-full h-6 bg-[#1a262b] rounded-md relative cursor-pointer overflow-hidden mt-6"
        >
          <div 
            className="absolute top-0 bottom-0 bg-[#3B3B3B] rounded-md border border-[#5e5e5e] transition-none"
            style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }}
          >
            <div className="absolute left-1/2 top-1 bottom-1 w-[2px] -translate-x-1/2 bg-[#8b9a2d] opacity-50" />
          </div>
        </div>
      </div>

      {/* Bottom: Waterfall (Now WebGPU) */}
      <div className="flex-1 relative w-full">
        <Canvas
          orthographic
          camera={{ position: [0, 0, 5], zoom: 1 }}
          gl={async (props) => {
            const renderer = new WebGPURenderer({ ...(props as any), antialias: false, alpha: false });
            await renderer.init();
            return renderer;
          }}
        >
          <Waterfall stateRef={stateRef} sharedFftData={sharedFftData} />
        </Canvas>
      </div>

    </div>
  );
}
