import { useEffect, useState } from 'react';

interface ClockAngles {
  hour: number;
  minute: number;
  second: number;
}

function getClockAngles(now: Date, smooth: boolean): ClockAngles {
  const ms = smooth ? now.getMilliseconds() : 0;
  const sec = now.getSeconds() + ms / 1000;
  const min = now.getMinutes() + sec / 60;
  const hr = (now.getHours() % 12) + min / 60;

  return {
    hour: hr * 30,
    minute: min * 6,
    second: sec * 6,
  };
}

/**
 * Compact nautical analog clock pinned to the top-right corner.
 */
export function AnalogClock() {
  const [angles, setAngles] = useState<ClockAngles>(() =>
    getClockAngles(new Date(), false),
  );

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      const id = window.setInterval(() => {
        setAngles(getClockAngles(new Date(), false));
      }, 1000);
      return () => window.clearInterval(id);
    }

    let rafId = 0;
    const tick = () => {
      setAngles(getClockAngles(new Date(), true));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className="fixed top-5 right-5 z-10 pointer-events-none select-none"
      aria-label="Current local time analog clock"
    >
      <svg
        width="84"
        height="84"
        viewBox="0 0 100 100"
        className="drop-shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
      >
        <defs>
          <linearGradient id="brassBezel" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#dfc082" />
            <stop offset="50%" stopColor="#a87d39" />
            <stop offset="100%" stopColor="#e5c88c" />
          </linearGradient>
        </defs>

        {/* Outer brass bezel */}
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="rgba(9, 16, 24, 0.84)"
          stroke="url(#brassBezel)"
          strokeWidth="2.8"
        />

        {/* Inner dial ring */}
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="rgba(229, 200, 140, 0.2)"
          strokeWidth="0.8"
        />

        {/* 60 minute ticks and 12 hour markers */}
        {Array.from({ length: 60 }, (_, i) => {
          const isHour = i % 5 === 0;
          const angle = i * 6;
          return (
            <line
              key={i}
              x1="50"
              y1={isHour ? 10 : 11.5}
              x2="50"
              y2={isHour ? 16.5 : 14}
              stroke={isHour ? '#e8d5b0' : 'rgba(210, 222, 234, 0.36)'}
              strokeWidth={isHour ? 1.9 : 0.85}
              strokeLinecap="round"
              transform={`rotate(${angle} 50 50)`}
            />
          );
        })}

        {/* Hour hand */}
        <line
          x1="50"
          y1="54"
          x2="50"
          y2="27"
          stroke="#eef3f8"
          strokeWidth="3.2"
          strokeLinecap="round"
          transform={`rotate(${angles.hour} 50 50)`}
        />

        {/* Minute hand */}
        <line
          x1="50"
          y1="56"
          x2="50"
          y2="19"
          stroke="#eef3f8"
          strokeWidth="2.1"
          strokeLinecap="round"
          transform={`rotate(${angles.minute} 50 50)`}
        />

        {/* Second hand */}
        <line
          x1="50"
          y1="59"
          x2="50"
          y2="15"
          stroke="#e06d44"
          strokeWidth="1.15"
          strokeLinecap="round"
          transform={`rotate(${angles.second} 50 50)`}
        />

        {/* Center cap */}
        <circle cx="50" cy="50" r="3" fill="#c99c4a" />
        <circle cx="50" cy="50" r="1.2" fill="#0b141e" />
      </svg>
    </div>
  );
}
