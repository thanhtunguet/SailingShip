/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { SimulationManager } from './simulation/SimulationManager';

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const simulation = new SimulationManager(container);
    return () => {
      simulation.dispose();
    };
  }, []);

  return (
    <main className="w-screen h-screen overflow-hidden bg-[#07111a]">
      <div
        ref={containerRef}
        className="w-full h-full"
        aria-label="First-person ocean ship simulation"
      />
    </main>
  );
}
