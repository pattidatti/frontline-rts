// Geometri-hjelpere for terreng-kollisjon og waypoint-routing (T1-B/T1-C).
// Holdes utenfor GameScene.ts for lesbarhet og enklere enhetstesting.

export interface Vec2 { x: number; y: number; }

/** Ray-casting point-in-polygon. Polygon må være en sekvens av Vec2 (lukkes automatisk). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > p.y) !== (yj > p.y) &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Skjærer linjestykket a→b linjestykket c→d? Klassisk CCW-basert test. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const ccw = (p: Vec2, q: Vec2, r: Vec2) =>
    (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

/** Krysser linjestykket fra a→b noen av segmentene i polylinjen? */
export function segmentCrossesPolyline(a: Vec2, b: Vec2, line: Vec2[]): boolean {
  for (let i = 0; i < line.length - 1; i++) {
    if (segmentsIntersect(a, b, line[i], line[i + 1])) return true;
  }
  return false;
}
