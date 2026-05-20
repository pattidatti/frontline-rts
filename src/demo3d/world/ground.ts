import * as THREE from 'three';

interface Ground {
  mesh: THREE.Group;
  update(time: number): void;
  setNightFactor(n: number): void;
  setGrassEnabled(on: boolean): void;
}

export function createGround(width: number, depth: number): Ground {
  const group = new THREE.Group();

  // ----- base terrain with custom shader for grass + dirt blend -----
  const geo = new THREE.PlaneGeometry(width, depth, 200, 140);
  geo.rotateX(-Math.PI / 2);

  // Add gentle elevation noise to vertices
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // suppress around river
    const riverMask = Math.exp(-Math.pow(z / 8, 2));
    const h =
      Math.sin(x * 0.08) * Math.cos(z * 0.06) * 0.6 +
      Math.sin(x * 0.21 + z * 0.13) * 0.3 +
      Math.sin(x * 0.5 + z * 0.7) * 0.12;
    pos.setY(i, h * (1 - riverMask * 0.8));
  }
  geo.computeVertexNormals();

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0.7 },
    uGrass: { value: 1.0 },
    uGrassColor: { value: new THREE.Color(0x4a7a3a) },
    uGrassBladeColor: { value: new THREE.Color(0x6a9a4a) },
    uGrassBottom: { value: new THREE.Color(0x2a4a1a) },
    uDirtColor: { value: new THREE.Color(0x4a3220) },
    uPathColor: { value: new THREE.Color(0x6a5030) },
    uMoonTint: { value: new THREE.Color(0x6080c8) },
    uFogColor: { value: new THREE.Color(0x0c1014) },
    uFogDensity: { value: 0.0042 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    lights: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      uniform float uGrass;
      uniform vec3 uGrassColor;
      uniform vec3 uGrassBladeColor;
      uniform vec3 uGrassBottom;
      uniform vec3 uDirtColor;
      uniform vec3 uPathColor;
      uniform vec3 uMoonTint;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vDist;

      // hash + noise
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 p = vWorldPos;

        // base grass tone with FBM variation
        float n = fbm(p.xz * 0.07);
        float n2 = fbm(p.xz * 0.4 + 17.0);

        vec3 grass = mix(uGrassBottom, uGrassColor, n);
        grass = mix(grass, uGrassBladeColor, smoothstep(0.55, 0.85, n2) * 0.6);

        // dirt patches around the river and on hills
        float riverPath = smoothstep(8.0, 0.0, abs(p.z));
        float dirtN = fbm(p.xz * 0.05 + 5.0);
        float dirt = smoothstep(0.55, 0.85, dirtN);
        vec3 col = mix(grass, uDirtColor, dirt * 0.7);

        // sandy banks of the river
        col = mix(col, uPathColor, riverPath * 0.85);

        // worn lanes between the two bases (vertical strip)
        float lane = exp(-pow((p.x - 0.0) / 6.0, 2.0)) * 0.35;
        col = mix(col, uPathColor, lane * (1.0 - riverPath));

        // soft tuft variation (smooth, not speckle)
        if (uGrass > 0.5) {
          float tuft = smoothstep(0.55, 0.85, fbm(p.xz * 0.5 + 33.0));
          col += (uGrassBladeColor - col) * tuft * 0.22;
        }
        // tiny pebbles (kept sparse)
        float pebble = step(0.92, fbm(p.xz * 2.0 + 7.0));
        col = mix(col, vec3(0.45, 0.4, 0.32), pebble * 0.5 * (1.0 - riverPath));

        // simple lambert-ish with normal
        vec3 L = normalize(vec3(0.4, 0.9, 0.3));
        float ndl = max(dot(normalize(vNormal), L), 0.0);
        float ambient = 0.45;
        vec3 lit = col * (ambient + ndl * 0.75);

        // night-time blue moonlight tint + AO under trees (cheap)
        vec3 night = lit * uMoonTint * 0.55;
        lit = mix(lit, night, uNight);

        // wind shimmer (subtle highlight rolling across)
        float wind = sin((p.x * 0.08 + p.z * 0.05) + uTime * 0.6) * 0.5 + 0.5;
        lit += uGrassBladeColor * wind * 0.03 * (1.0 - dirt) * (1.0 - riverPath);

        // exponential fog
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
        lit = mix(lit, uFogColor, fogFactor);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  group.add(mesh);

  // ----- instanced grass blades scattered (perf-friendly, only near camera) -----
  const bladeGeo = new THREE.PlaneGeometry(0.5, 1.4, 1, 2);
  bladeGeo.translate(0, 0.7, 0);
  const BLADE_COUNT = 4000;
  const bladeMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorBottom: { value: new THREE.Color(0x2a4a1a) },
      uColorTop: { value: new THREE.Color(0x9ad06a) },
      uNight: { value: 0.7 },
      uMoonTint: { value: new THREE.Color(0x6080c8) },
    },
    side: THREE.DoubleSide,
    transparent: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aPhase;
      varying float vY;
      void main() {
        vec3 p = position;
        // sway top vertices
        float sway = sin(uTime * 1.6 + aPhase) * 0.35;
        p.x += sway * p.y * 0.3;
        p.z += cos(uTime * 1.3 + aPhase) * 0.18 * p.y * 0.3;
        vY = p.y / 1.4;
        vec4 wp = instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorBottom;
      uniform vec3 uColorTop;
      uniform float uNight;
      uniform vec3 uMoonTint;
      varying float vY;
      void main() {
        vec3 c = mix(uColorBottom, uColorTop, vY);
        c = mix(c, c * uMoonTint * 0.55, uNight);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });

  const grassMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, BLADE_COUNT);
  const dummy = new THREE.Object3D();
  const phases = new Float32Array(BLADE_COUNT);
  for (let i = 0; i < BLADE_COUNT; i++) {
    const x = (Math.random() - 0.5) * width * 0.95;
    const z = (Math.random() - 0.5) * depth * 0.95;
    // skip river band
    if (Math.abs(z) < 7.5) { i--; continue; }
    const scale = 0.55 + Math.random() * 0.7;
    dummy.position.set(x, 0, z);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.scale.set(scale * 0.6, scale, scale * 0.6);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);
    phases[i] = Math.random() * Math.PI * 2;
  }
  bladeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  grassMesh.instanceMatrix.needsUpdate = true;
  grassMesh.frustumCulled = false;
  group.add(grassMesh);

  return {
    mesh: group,
    update(time: number) {
      uniforms.uTime.value = time;
      bladeMat.uniforms.uTime.value = time;
    },
    setNightFactor(n: number) {
      uniforms.uNight.value = n;
      bladeMat.uniforms.uNight.value = n;
    },
    setGrassEnabled(on: boolean) {
      grassMesh.visible = on;
      uniforms.uGrass.value = on ? 1.0 : 0.0;
    },
  };
}
