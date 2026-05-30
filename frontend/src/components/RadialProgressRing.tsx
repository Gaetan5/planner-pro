import React, { useEffect, useState } from 'react';
import './RadialProgressRing.css';

interface RadialProgressRingProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  status?: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'AT_RISK' | 'DELIVERED' | 'CLOSED';
}

export const RadialProgressRing: React.FC<RadialProgressRingProps> = ({
  value,
  size = 120,
  strokeWidth = 10,
  status = 'ACTIVE',
}) => {
  const [progress, setProgress] = useState(0);

  // Animation à l'apparition / modification de la valeur
  useEffect(() => {
    const timer = setTimeout(() => {
      setProgress(value);
    }, 100);
    return () => clearTimeout(timer);
  }, [value]);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="radial-progress-ring-container" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="radial-progress-ring-svg">
        <defs>
          {/* Dégradé Indigo/Violet (Actif / Standard) */}
          <linearGradient id="grad-ACTIVE" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
          <linearGradient id="grad-PLANNING" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
          
          {/* Dégradé Vert Émeraude (Terminé) */}
          <linearGradient id="grad-DELIVERED" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id="grad-CLOSED" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          {/* Dégradé Orange Ambre (En Pause) */}
          <linearGradient id="grad-ON_HOLD" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>

          {/* Dégradé Rouge (À Risque) */}
          <linearGradient id="grad-AT_RISK" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f87171" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>

          {/* Filtre de Glow */}
          <filter id={`glow-${status}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Cercle d'arrière-plan (rail) */}
        <circle
          className="radial-progress-ring-bg"
          stroke="rgba(255, 255, 255, 0.05)"
          fill="transparent"
          strokeWidth={strokeWidth}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />

        {/* Cercle de progression avec glow */}
        <circle
          className="radial-progress-ring-bar"
          stroke={`url(#grad-${status})`}
          fill="transparent"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          filter={`url(#glow-${status})`}
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
          }}
        />
      </svg>
      <div className="radial-progress-ring-label">
        <span className="radial-progress-ring-number">{Math.round(progress)}</span>
        <span className="radial-progress-ring-percent">%</span>
      </div>
    </div>
  );
};
