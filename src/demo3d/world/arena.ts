import * as THREE from 'three';

interface ArenaResult {
  group: THREE.Group;
  setNightFactor(n: number): void;
}

/** Circular dirt patch in front of each ant mound, where the lanes converge. */
export function createArena(radius: number): ArenaResult {
  const group = new THREE.Group();

  const geo = new THREE.CircleGeometry(radius, 64);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uNight: { value: 0.7 },
    uDirt: { value: new THREE.Color(0x7a5230) },
    uDirtLight: { value: new THREE.Color(0x9a7240) },
    uDirtDark: { value: new THREE.Color(0x4a2e18) },
    uMoonTint: { value: new THREE.Color(0x7090d0) },
    uRadius: { value: radius },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorld;
      void main() {
        vLocal = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform vec3 uDirt;
      uniform vec3 uDirtLight;
      uniform vec3 uDirtDark;
      uniform vec3 uMoonTint;
      uniform float uRadius;
      varying vec3 vLocal;
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
        float r = length(vLocal.xz) / uRadius;
        float alpha = smoothstep(1.0, 0.82, r);

        vec3 col = mix(uDirtLight, uDirt, smoothstep(0.0, 0.6, r));
        col = mix(col, uDirtDark, smoothstep(0.6, 1.0, r) * 0.7);

        // grain
        float n = noise(vWorld.xz * 0.8);
        col = mix(col, uDirtDark, step(0.78, n) * 0.6);
        float n2 = noise(vWorld.xz * 1.7 + 9.0);
        col += vec3(0.06) * step(0.82, n2);

        col = mix(col, col * uMoonTint, uNight * 0.55);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.5;
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  group.add(mesh);

  return {
    group,
    setNightFactor(n: number) { uniforms.uNight.value = n; },
  };
}
