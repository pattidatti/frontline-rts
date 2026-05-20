import * as THREE from 'three';

interface River {
  mesh: THREE.Mesh;
  update(time: number): void;
  setNightFactor(n: number): void;
}

export function createRiver(width: number): River {
  const geo = new THREE.PlaneGeometry(width, 14, 80, 18);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0.7 },
    uColorShallow: { value: new THREE.Color(0x5fa8c4) },
    uColorDeep: { value: new THREE.Color(0x123a4a) },
    uFoamColor: { value: new THREE.Color(0xc8d8e8) },
    uMoonTint: { value: new THREE.Color(0x6090d8) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vWave;
      void main() {
        vec3 p = position;
        float w =
          sin(p.x * 0.18 + uTime * 1.4) * 0.18 +
          sin(p.x * 0.35 - uTime * 0.9 + p.z * 0.6) * 0.10 +
          sin(p.z * 1.2 + uTime * 2.0) * 0.06;
        p.y += w;
        vWave = w;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec3 dpdx = vec3(1.0, 0.0, 0.0);
        vec3 dpdz = vec3(0.0, 0.0, 1.0);
        // approximate normal from derivatives of wave
        float dwx =
          cos(p.x * 0.18 + uTime * 1.4) * 0.18 * 0.18 +
          cos(p.x * 0.35 - uTime * 0.9 + p.z * 0.6) * 0.10 * 0.35;
        float dwz =
          sin(p.x * 0.35 - uTime * 0.9 + p.z * 0.6) * 0.10 * 0.6 +
          cos(p.z * 1.2 + uTime * 2.0) * 0.06 * 1.2;
        vNormal = normalize(vec3(-dwx, 1.0, -dwz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uColorShallow;
      uniform vec3 uColorDeep;
      uniform vec3 uFoamColor;
      uniform vec3 uMoonTint;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vWave;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0,0.0));
        float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.5);

        // animated caustics-ish pattern
        float c = noise(vWorld.xz * 0.4 + vec2(uTime * 0.5, 0.0));
        c += noise(vWorld.xz * 0.9 - vec2(0.0, uTime * 0.3)) * 0.5;
        c = smoothstep(0.55, 0.95, c);

        vec3 col = mix(uColorDeep, uColorShallow, fres);
        col += uFoamColor * c * 0.35;

        // crest foam where wave is high
        float crest = smoothstep(0.12, 0.22, vWave);
        col = mix(col, uFoamColor, crest * 0.5);

        // night tint
        col = mix(col, col * uMoonTint, uNight * 0.6);

        // specular highlight (warm sun)
        vec3 L = normalize(vec3(0.4, 0.9, 0.3));
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 80.0);
        col += vec3(1.0, 0.85, 0.6) * spec * (1.0 - uNight) * 1.4;
        col += vec3(0.5, 0.7, 1.0) * spec * uNight * 0.9;

        gl_FragColor = vec4(col, 0.92);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.05;
  mesh.receiveShadow = false;

  return {
    mesh,
    update(time: number) { uniforms.uTime.value = time; },
    setNightFactor(n: number) { uniforms.uNight.value = n; },
  };
}
