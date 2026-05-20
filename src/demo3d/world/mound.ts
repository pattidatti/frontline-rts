import * as THREE from 'three';

interface MoundOpts {
  color: number;
  accent: number;
  glow: number;
  scale?: number;
}

interface Mound {
  group: THREE.Group;
  setGlow(n: number): void;
  update(time: number): void;
}

export function createMound(opts: MoundOpts): Mound {
  const group = new THREE.Group();
  const scale = opts.scale ?? 1.0;

  // big lumpy cone (multi-layered)
  const baseGeo = new THREE.ConeGeometry(14, 12, 32, 6, false);
  // perturb vertices for lumpy organic feel
  const pos = baseGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    if (r > 0.1) {
      const theta = Math.atan2(z, x);
      const wob = 1 + Math.sin(theta * 5 + y * 0.5) * 0.06 + Math.cos(theta * 8) * 0.04;
      pos.setX(i, x * wob);
      pos.setZ(i, z * wob);
      pos.setY(i, y + Math.sin(theta * 3) * 0.4);
    }
  }
  baseGeo.computeVertexNormals();

  const baseMat = new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: false,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.castShadow = true;
  base.receiveShadow = true;
  base.position.y = 6;
  group.add(base);

  // smaller secondary lumps around
  for (let i = 0; i < 5; i++) {
    const lumpGeo = new THREE.ConeGeometry(3 + Math.random() * 2, 3 + Math.random() * 2, 12, 1);
    const lump = new THREE.Mesh(lumpGeo, baseMat);
    const a = (i / 5) * Math.PI * 2;
    lump.position.set(Math.cos(a) * 11, 1.5, Math.sin(a) * 9);
    lump.castShadow = true;
    lump.receiveShadow = true;
    group.add(lump);
  }

  // accent ridges (tiny ridged rings)
  const ringGeo = new THREE.TorusGeometry(8, 0.4, 6, 24);
  const ringMat = new THREE.MeshStandardMaterial({
    color: opts.accent,
    roughness: 0.85,
    metalness: 0.1,
    emissive: new THREE.Color(opts.accent),
    emissiveIntensity: 0.0,
  });
  const ring1 = new THREE.Mesh(ringGeo, ringMat);
  ring1.position.y = 8;
  ring1.rotation.x = Math.PI / 2;
  ring1.castShadow = true;
  group.add(ring1);

  // glowing entrance "eye"
  const eyeGeo = new THREE.CircleGeometry(2.4, 24);
  const eyeMat = new THREE.MeshBasicMaterial({ color: opts.glow });
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.set(0, 5.5, 13 * scale);
  group.add(eye);

  // entrance point light
  const eyeLight = new THREE.PointLight(opts.glow, 0, 28, 2.0);
  eyeLight.position.set(0, 5.5, 12 * scale);
  group.add(eyeLight);

  // small flag on top
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.7 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 15;
  pole.castShadow = true;
  group.add(pole);

  const flagGeo = new THREE.PlaneGeometry(3, 1.8, 6, 3);
  const flagMat = new THREE.MeshStandardMaterial({
    color: opts.accent,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(opts.accent),
    emissiveIntensity: 0.0,
  });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(1.5, 17, 0);
  group.add(flag);

  group.scale.setScalar(scale);

  return {
    group,
    setGlow(n: number) {
      eyeMat.color.setHex(opts.glow).multiplyScalar(0.6 + n * 1.8);
      eyeLight.intensity = n * 32;
      ringMat.emissiveIntensity = n * 0.6;
      flagMat.emissiveIntensity = n * 0.25;
    },
    update(time: number) {
      const flagPos = flag.geometry.attributes.position;
      for (let i = 0; i < flagPos.count; i++) {
        const x = flagPos.getX(i);
        const ix = x + 1.5;
        flagPos.setZ(i, Math.sin(time * 4 + ix * 1.5) * 0.18 * ix);
      }
      flagPos.needsUpdate = true;
    },
  };
}
