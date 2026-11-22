import { ChevronDown, ChevronUp, CloudLightning, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  SimulationTelemetry,
  WeatherControlMode,
  WiperMode,
} from '../simulation/types';

interface SimulationControlsProps {
  telemetry: SimulationTelemetry;
  onSelectMode: (mode: WeatherControlMode) => void;
  onWindSpeedChange: (speed: number) => void;
  onWindAngleChange: (deg: number) => void;
  onCloudCoverageChange: (coverage: number) => void;
  onCloudDarknessChange: (darkness: number) => void;
  onSpawnStormAhead: () => void;
  onResetAuto: () => void;
  onWiperModeChange: (mode: WiperMode) => void;
  onWiperSpeedChange: (speed: number) => void;
}

type DockTab = 'weather' | 'wipers';

const WEATHER_OPTIONS: Array<{ mode: WeatherControlMode; label: string }> = [
  { mode: 'AUTO', label: 'Auto' },
  { mode: 'CALM_OCEAN', label: 'Calm' },
  { mode: 'STRONG_WIND', label: 'Strong Wind' },
  { mode: 'ROUGH_SEAS', label: 'Rough Seas' },
  { mode: 'SEVERE_THUNDERSTORM', label: 'Storm' },
  { mode: 'STORM_RECOVERY', label: 'Recovery' },
];

const WIPER_OPTIONS: Array<{ mode: WiperMode; label: string }> = [
  { mode: 'AUTO', label: 'Auto (Rain & Spray)' },
  { mode: 'ON', label: 'On' },
  { mode: 'OFF', label: 'Off' },
];

/**
 * Minimal top-left page title and collapsible tabbed bottom control dock
 * for weather/wind/clouds, Storm Ahead, and windshield wiper controls.
 */
export function SimulationControls({
  telemetry,
  onSelectMode,
  onWindSpeedChange,
  onWindAngleChange,
  onCloudCoverageChange,
  onCloudDarknessChange,
  onSpawnStormAhead,
  onResetAuto,
  onWiperModeChange,
  onWiperSpeedChange,
}: SimulationControlsProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<DockTab>('weather');

  return (
    <>
      {/* Top-left minimal title */}
      <header className="fixed top-5 left-6 z-10 pointer-events-none select-none">
        <h1
          className="text-xl sm:text-2xl font-medium tracking-tight text-slate-100 drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Oops! How did you get here?
        </h1>
      </header>

      {/* Bottom-center collapsible control dock */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(920px,95vw)] flex flex-col items-center pointer-events-none">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            setCollapsed((c) => !c);
          }}
          className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-[#0a121c]/88 hover:bg-[#101c2b] border border-white/15 border-b-0 rounded-t-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? 'Show Controls' : 'Hide Controls'}</span>
        </button>

        {!collapsed && (
          <section
            aria-label="Bridge simulation controls"
            className="pointer-events-auto w-full bg-[#0a121c]/88 border border-white/15 rounded-xl px-4 py-3 shadow-[0_12px_36px_rgba(0,0,0,0.45)] text-slate-100 flex flex-col gap-3"
          >
            {/* Dock Tab Switcher + Storm Ahead Primary Action */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
              <div
                className="flex items-center gap-1 p-1 bg-black/30 rounded-lg"
                role="tablist"
                aria-label="Control categories"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'weather'}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setActiveTab('weather');
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    activeTab === 'weather'
                      ? 'bg-slate-100 text-slate-950'
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  Weather &amp; Wind
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'wipers'}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setActiveTab('wipers');
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    activeTab === 'wipers'
                      ? 'bg-slate-100 text-slate-950'
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  Wipers
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {telemetry.hasOverrides && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onResetAuto();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/8 hover:bg-white/15 border border-white/12 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Auto</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onSpawnStormAhead();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-amber-300 hover:bg-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
                >
                  <CloudLightning className="w-3.5 h-3.5" />
                  <span>
                    {telemetry.stormActive
                      ? `Storm Ahead (${telemetry.stormDistance}m)`
                      : 'Storm Ahead'}
                  </span>
                </button>
              </div>
            </div>

            {activeTab === 'weather' ? (
              <>
                {/* Weather Mode Selector */}
                <div
                  className="flex items-center gap-1 p-1 bg-black/30 rounded-lg overflow-x-auto max-w-full self-start"
                  role="group"
                  aria-label="Weather mode"
                >
                  {WEATHER_OPTIONS.map((opt) => {
                    const isActive = telemetry.mode === opt.mode;
                    return (
                      <button
                        key={opt.mode}
                        type="button"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          onSelectMode(opt.mode);
                        }}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                          isActive
                            ? 'bg-slate-100 text-slate-950'
                            : 'text-slate-300 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Wind & Cloud Sliders */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap">Wind Speed</span>
                      <span className="font-mono tabular-nums text-slate-100">
                        {telemetry.windSpeed.toFixed(1)} m/s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={32}
                      step={0.5}
                      value={telemetry.windSpeed}
                      onChange={(e) => onWindSpeedChange(parseFloat(e.target.value))}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-full accent-amber-300 cursor-pointer h-1.5"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap">Wind Bearing</span>
                      <span className="font-mono tabular-nums text-slate-100">
                        {Math.round(telemetry.windAngleDeg)}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={Math.round(telemetry.windAngleDeg)}
                      onChange={(e) => onWindAngleChange(parseFloat(e.target.value))}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-full accent-amber-300 cursor-pointer h-1.5"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap">Cloud Cover</span>
                      <span className="font-mono tabular-nums text-slate-100">
                        {Math.round(telemetry.cloudCoverage * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={telemetry.cloudCoverage}
                      onChange={(e) => onCloudCoverageChange(parseFloat(e.target.value))}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-full accent-amber-300 cursor-pointer h-1.5"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-slate-300">
                    <div className="flex items-center justify-between gap-2">
                      <span className="whitespace-nowrap">Cloud Density</span>
                      <span className="font-mono tabular-nums text-slate-100">
                        {Math.round(telemetry.cloudDarkness * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={telemetry.cloudDarkness}
                      onChange={(e) => onCloudDarknessChange(parseFloat(e.target.value))}
                      onPointerUp={(e) => e.currentTarget.blur()}
                      className="w-full accent-amber-300 cursor-pointer h-1.5"
                    />
                  </label>
                </div>
              </>
            ) : (
              /* Wipers Tab */
              <div className="flex flex-wrap items-center justify-between gap-4 py-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <div
                    className="flex items-center gap-1 p-1 bg-black/30 rounded-lg"
                    role="group"
                    aria-label="Windshield wiper mode"
                  >
                    {WIPER_OPTIONS.map((opt) => {
                      const isActive = telemetry.wiperMode === opt.mode;
                      return (
                        <button
                          key={opt.mode}
                          type="button"
                          onClick={(e) => {
                            e.currentTarget.blur();
                            onWiperModeChange(opt.mode);
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                            isActive
                              ? 'bg-slate-100 text-slate-950'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {telemetry.wiperActive ? 'Sweeping' : 'Parked at sill'}
                  </span>
                </div>

                <label className="flex flex-col gap-1 text-xs text-slate-300 min-w-[210px] flex-1 max-w-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="whitespace-nowrap">Wiper Speed</span>
                    <span className="font-mono tabular-nums text-slate-100">
                      {telemetry.wiperSpeed.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={2.5}
                    step={0.1}
                    value={telemetry.wiperSpeed}
                    onChange={(e) => onWiperSpeedChange(parseFloat(e.target.value))}
                    onPointerUp={(e) => e.currentTarget.blur()}
                    className="w-full accent-amber-300 cursor-pointer h-1.5"
                  />
                </label>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
