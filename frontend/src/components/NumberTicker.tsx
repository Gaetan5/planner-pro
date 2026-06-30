import React, { useEffect, useState } from 'react';

interface NumberTickerProps {
  value: number;
  duration?: number; // en ms
  suffix?: string;
  className?: string;
}

export const NumberTicker: React.FC<NumberTickerProps> = ({
  value,
  duration = 1000,
  suffix = '',
  className = '',
}) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = Math.round(value);
    if (start === end) {
      setCount(end);
      return;
    }

    const totalSteps = 40;
    const stepTime = Math.max(Math.floor(duration / totalSteps), 10);
    const increment = (end - start) / totalSteps;

    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      const nextValue = Math.min(start + increment * currentStep, end);
      setCount(Math.round(nextValue));

      if (currentStep >= totalSteps || nextValue >= end) {
        setCount(end);
        clearInterval(timer);
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [value, duration]);

  return (
    <span className={className}>
      {count}
      {suffix}
    </span>
  );
};
