import * as THREE from 'three';
import { sampleCatmullRom, tangentAt } from './spline';

export interface LaneDef {
  id: number;
  label: string;
  baseWidth: number;
  waypoints: { x: number; z: number }[];
}

export interface Lane {
  id: number;
  samples: { x: number; z: number }[];
  /** width function in world units */
  widthAt(t: number): number;
  /** position at param t in [0,1] */
  pointAt(t: number): { x: number; z: number };
  /** unit tangent at param t (toward east) */
  tangentAt(t: number): THREE.Vector2;
  /** total approximate length */
  length: number;
}

const SAMPLES_PER_LANE = 96;

export function buildLane(def: LaneDef): Lane {
  const samples = sampleCatmullRom(def.waypoints, SAMPLES_PER_LANE);
  let length = 0;
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dz = samples[i].z - samples[i - 1].z;
    length += Math.hypot(dx, dz);
  }

  const widthAt = (t: number) => {
    const tt = Math.min(1, Math.max(0, t));
    // mirror game: wider at ends (near arena), slight wobble through middle
    const endTaper = 1.0 + 0.25 * (1 - Math.sin(tt * Math.PI));
    const wobble = 1.0 + 0.12 * Math.sin(tt * Math.PI * 6 + def.id * 1.7);
    return def.baseWidth * endTaper * wobble;
  };
  const pointAt = (t: number) => {
    const tt = Math.min(1, Math.max(0, t));
    const u = tt * (samples.length - 1);
    const i = Math.min(Math.floor(u), samples.length - 2);
    const f = u - i;
    return {
      x: samples[i].x + (samples[i + 1].x - samples[i].x) * f,
      z: samples[i].z + (samples[i + 1].z - samples[i].z) * f,
    };
  };
  const tan = (t: number) => {
    const tt = Math.min(1, Math.max(0, t));
    const i = Math.min(samples.length - 2, Math.floor(tt * (samples.length - 1)));
    return tangentAt(samples, i);
  };

  return { id: def.id, samples, widthAt, pointAt, tangentAt: tan, length };
}

interface LaneMesh {
  group: THREE.Group;
  update(time: number): void;
  setNightFactor(n: number): void;
}

/** Build a ribbon mesh for a lane — variable-width strip along the spline. */
export function buildLaneMesh(lane: Lane): LaneMesh {
  const group = new THREE.Group();
  const n = lane.samples.length;
  // 2 vertices per sample (left + right)
  const verts = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = lane.widthAt(t) * 0.5;
    const s = lane.samples[i];
    const tan = tangentAt(lane.samples, i);
    const nx = -tan.y; // perpendicular in XZ
    const nz = tan.x;

    const lx = s.x + nx * w;
    const lz = s.z + nz * w;
    const rx = s.x - nx * w;
    const rz = s.z - nz * w;

    verts[i * 6 + 0] = lx;  verts[i * 6 + 1] = 0.5;  verts[i * 6 + 2] = lz;
    verts[i * 6 + 3] = rx;  verts[i * 6 + 4] = 0.5;  verts[i * 6 + 5] = rz;

    uvs[i * 4 + 0] = 0;  uvs[i * 4 + 1] = t;
    uvs[i * 4 + 2] = 1;  uvs[i * 4 + 3] = t;

    if (i < n - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0.7 },
    uDirt: { value: new THREE.Color(0x7a5230) },
    uDirtLight: { value: new THREE.Color(0x9a7240) },
    uDirtDark: { value: new THREE.Color(0x4a2e18) },
    uMoonTint: { value: new THREE.Color(0x7090d0) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uDirt;
      uniform vec3 uDirtLight;
      uniform vec3 uDirtDark;
      uniform vec3 uMoonTint;
      varying vec2 vUv;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0,0.0));
        float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }

      void main() {
        // u: 0=left edge, 1=right edge ; v: 0=west, 1=east
        float edge = abs(vUv.x - 0.5) * 2.0;
        // soft outer edge (fades to transparent at very edge for seamless blend)
        float alpha = smoothstep(1.0, 0.85, edge);

        // center lighter, edge darker
        vec3 col = mix(uDirtLight, uDirt, smoothstep(0.0, 0.55, edge));
        col = mix(col, uDirtDark, smoothstep(0.55, 1.0, edge) * 0.85);

        // pebble noise
        float n = noise(vWorld.xz * 0.7);
        col = mix(col, uDirtDark, step(0.78, n) * 0.6);
        float n2 = noise(vWorld.xz * 2.0 + 5.0);
        col += vec3(0.06) * step(0.82, n2);

        // ground bump shading
        vec3 L = normalize(vec3(0.4, 0.9, 0.3));
        col *= 0.85 + 0.15 * L.y;

        // night tint
        col = mix(col, col * uMoonTint, uNight * 0.55);

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  group.add(mesh);

  return {
    group,
    update(time: number) { uniforms.uTime.value = time; },
    setNightFactor(n: number) { uniforms.uNight.value = n; },
  };
}
