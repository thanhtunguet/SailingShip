/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnalogClock } from './components/AnalogClock';
import { SimulationControls } from './components/SimulationControls';
import { SimulationManager } from './simulation/SimulationManager';
import {
  SimulationTelemetry,
  WeatherControlMode,
  WiperMode,
} from './simulation/types';

const INITIAL_TELEMETRY: SimulationTelemetry = {
  mode: 'AUTO',
  currentState: 'CALM_OCEAN',
  windSpeed: 5.5,
  windAngleDeg: 26,
  cloudCoverage: 0.32,
  cloudDarkness: 0.08,
  stormActive: false,
  stormDistance: 0,
  hasOverrides: false,
  wiperMode: 'AUTO',
  wiperSpeed: 1.0,
  wiperActive: false,
};

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<SimulationManager | null>(null);
  const [telemetry, setTelemetry] = useState<SimulationTelemetry>(INITIAL_TELEMETRY);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const simulation = new SimulationManager(container);
    simRef.current = simulation;
    setTelemetry(simulation.getTelemetry());

    const timer = window.setInterval(() => {
      if (simRef.current) {
        setTelemetry(simRef.current.getTelemetry());
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
      simulation.dispose();
      simRef.current = null;
    };
  }, []);

  const handleSelectMode = useCallback((mode: WeatherControlMode) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setWeatherMode(mode);
    setTelemetry(sim.getTelemetry());
  }, []);

  const handleWindSpeedChange = useCallback((speed: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setWindSpeed(speed);
    setTelemetry((prev) => ({ ...prev, windSpeed: speed, hasOverrides: true }));
  }, []);

  const handleWindAngleChange = useCallback((deg: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setWindAngleDeg(deg);
    setTelemetry((prev) => ({ ...prev, windAngleDeg: deg, hasOverrides: true }));
  }, []);

  const handleCloudCoverageChange = useCallback((coverage: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setCloudCoverage(coverage);
    setTelemetry((prev) => ({ ...prev, cloudCoverage: coverage, hasOverrides: true }));
  }, []);

  const handleCloudDarknessChange = useCallback((darkness: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setCloudDarkness(darkness);
    setTelemetry((prev) => ({ ...prev, cloudDarkness: darkness, hasOverrides: true }));
  }, []);

  const handleSpawnStormAhead = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.spawnStormAhead();
    setTelemetry(sim.getTelemetry());
  }, []);

  const handleResetAuto = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.clearWeatherOverrides();
    setTelemetry(sim.getTelemetry());
  }, []);

  const handleWiperModeChange = useCallback((mode: WiperMode) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setWiperMode(mode);
    setTelemetry((prev) => ({ ...prev, wiperMode: mode }));
  }, []);

  const handleWiperSpeedChange = useCallback((speed: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setWiperSpeed(speed);
    setTelemetry((prev) => ({ ...prev, wiperSpeed: speed }));
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#07111a]">
      <div
        ref={containerRef}
        className="w-full h-full"
        aria-label="First-person ocean ship simulation"
      />
      <AnalogClock />
      <SimulationControls
        telemetry={telemetry}
        onSelectMode={handleSelectMode}
        onWindSpeedChange={handleWindSpeedChange}
        onWindAngleChange={handleWindAngleChange}
        onCloudCoverageChange={handleCloudCoverageChange}
        onCloudDarknessChange={handleCloudDarknessChange}
        onSpawnStormAhead={handleSpawnStormAhead}
        onResetAuto={handleResetAuto}
        onWiperModeChange={handleWiperModeChange}
        onWiperSpeedChange={handleWiperSpeedChange}
      />
    </main>
  );
}
