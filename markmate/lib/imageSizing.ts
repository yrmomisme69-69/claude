// Image sizing rules for Claude vision, copied from Anthropic's reference
// implementation ("Coordinates and bounding boxes" docs page).
//
// We resize every page in the browser to exactly the size Claude would use,
// so the pixel coordinates Claude returns line up 1:1 with our image.
//
// Claude 4.7 and later models (incl. Sonnet 5.5 / Opus 5.5) are on the
// high-resolution tier: long edge <= 2576 px and <= 4784 visual tokens.

export const HIGH_RES = { maxEdge: 2576, maxTokens: 4784 };
export const STANDARD_RES = { maxEdge: 1568, maxTokens: 1568 };

export function countImageTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/** Round half to even (banker's rounding), matching the live API. */
function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The size Claude resizes an image to before padding. Returns [width, height]. */
export function resizedSize(
  width: number,
  height: number,
  maxEdge = HIGH_RES.maxEdge,
  maxTokens = HIGH_RES.maxTokens,
): [number, number] {
  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / 28) * 28 <= maxEdge &&
    Math.ceil(h / 28) * 28 <= maxEdge &&
    countImageTokens(w, h) <= maxTokens;

  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [rh, rw] = resizedSize(height, width, maxEdge, maxTokens);
    return [rw, rh];
  }
  const aspectRatio = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspectRatio), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundTiesToEven(lo / aspectRatio), 1)];
}
