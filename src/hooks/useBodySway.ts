const AMPLITUDE = 2;
const PERIOD = 3000;

export function useBodySway() {
  const tick = (timestamp: number) => {
    return Math.sin((timestamp / PERIOD) * 2 * Math.PI) * AMPLITUDE;
  };

  return tick;
}
