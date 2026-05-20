import * as THREE from 'three';

/**
 * Uniform Catmull-Rom spline sampler in 2D (XZ plane).
 * Mirrors the game's lane construction (Phaser splineTo through waypoints).
 */
export function sampleCatmullRom(
  waypoints: { x: number; z: number }[],
  sampleCount: number,
): { x: number; z: number }[] {
  // Phantom endpoints so curve passes through first/last
  const pts = [waypoints[0], ...waypoints, waypoints[waypoints.length - 1]];
  const segCount = pts.length - 3;
  const out: { x: number; z: number }[] = [];

  for (let s = 0; s <= sampleCount; s++) {
    const u = (s / sampleCount) * segCount;
    const i = Math.min(Math.floor(u), segCount - 1);
    const t = u - i;
    const p0 = pts[i], p1 = pts[i + 1], p2 = pts[i + 2], p3 = pts[i + 3];

    const t2 = t * t;
    const t3 = t2 * t;
    const x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );
    const z = 0.5 * (
      (2 * p1.z) +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
    );
    out.push({ x, z });
  }
  return out;
}

export function tangentAt(samples: { x: number; z: number }[], i: number): THREE.Vector2 {
  const a = samples[Math.max(0, i - 1)];
  const b = samples[Math.min(samples.length - 1, i + 1)];
  const v = new THREE.Vector2(b.x - a.x, b.z - a.z);
  return v.normalize();
}
