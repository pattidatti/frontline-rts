import * as THREE from 'three';

interface Fireflies {
  points: THREE.Points;
  update(time: number, dt: number): void;
  setIntensity(n: number): void;
}

export function createFireflies(count: number, world: { width: number; depth: number }): Fireflies {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * world.width * 0.9;
    positions[i * 3 + 1] = 1.5 + Math.random() * 7;
    positions[i * 3 + 2] = (Math.random() - 0.5) * world.depth * 0.9;
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.5 + Math.random() * 1.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0.85 },
    uColor: { value: new THREE.Color(0xffe480) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSpeed;
      uniform float uTime;
      varying float vFlick;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.7 * aSpeed + aPhase) * 1.3;
        p.y += sin(uTime * 1.2 * aSpeed + aPhase * 2.0) * 0.9;
        p.z += cos(uTime * 0.6 * aSpeed + aPhase) * 1.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFlick = 0.5 + 0.5 * sin(uTime * 4.0 * aSpeed + aPhase);
        gl_PointSize = (140.0 / -mv.z) * (0.6 + vFlick * 0.7);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying float vFlick;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float alpha = smoothstep(0.5, 0.0, d);
        alpha *= alpha;
        vec3 col = uColor * (0.8 + vFlick * 1.2);
        gl_FragColor = vec4(col, alpha * uIntensity);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  return {
    points,
    update(time: number) { uniforms.uTime.value = time; },
    setIntensity(n: number) { uniforms.uIntensity.value = n; },
  };
}
