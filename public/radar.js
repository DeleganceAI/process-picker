import { renderRadarSvg } from './radar-svg.mjs';

export function radar(dimensions, series, title = 'Process radar') {
  const svg = renderRadarSvg(dimensions, series, title);
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
}
