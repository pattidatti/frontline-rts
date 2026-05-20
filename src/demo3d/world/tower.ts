import * as THREE from 'three';

export type TowerKind = 'stinger' | 'webber' | 'spitter';

interface Tower {
  group: THREE.Group;
  setGlow(n: number): void;
  update(time: number, dt: number): void;
}

const KIND_COLOR: Record<TowerKind, number> = {
  stinger: 0xffd070,
  webber: 0xa080ff,
  spitter: 0x70ff90,
};

export function createTower(kind: TowerKind, side: 'player' | 'ai'): Tower {
  const group = new THREE.Group();
  const accent = KIND_COLOR[kind];

  // pedestal: clay nest base
  const baseColor = side === 'player' ? 0x3a2a1a : 0x6a3a1a;
  const baseMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.9,
    metalness: 0.05,
  });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.0, 2.0, 10), baseMat);
  ped.position.y = 1;
  ped.castShadow = true;
  ped.receiveShadow = true;
  group.add(ped);

  // body
  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.7,
    metalness: 0.1,
  });

  let head: THREE.Mesh | THREE.Group;
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(accent),
    emissiveIntensity: 1.5,
    roughness: 0.2,
    metalness: 0.4,
  });

  if (kind === 'stinger') {
    // tall spike
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 3.4, 8), bodyMat);
    body.position.y = 3.6;
    body.castShadow = true;
    group.add(body);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 8), bodyMat);
    spike.position.y = 6.0;
    spike.castShadow = true;
    group.add(spike);
    head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), orbMat);
    head.position.y = 5.0;
    group.add(head);
  } else if (kind === 'webber') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 2.4, 8), bodyMat);
    body.position.y = 3.2;
    body.castShadow = true;
    group.add(body);
    // crown of small orbs
    const crown = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const o = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), orbMat);
      o.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0);
      crown.add(o);
    }
    crown.position.y = 4.6;
    group.add(crown);
    head = crown;
  } else {
    // spitter
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1.6, 10), bodyMat);
    body.position.y = 2.8;
    body.castShadow = true;
    group.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
    dome.position.y = 3.6;
    dome.castShadow = true;
    group.add(dome);
    head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 14), orbMat);
    head.position.y = 4.4;
    group.add(head);
  }

  const light = new THREE.PointLight(accent, 0, 22, 2);
  light.position.set(0, 5, 0);
  group.add(light);

  // tiny halo (additive sprite)
  const haloGeo = new THREE.RingGeometry(0.8, 1.4, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 4.6;
  group.add(halo);

  let glow = 0.7;
  return {
    group,
    setGlow(n: number) {
      glow = n;
      orbMat.emissiveIntensity = 0.8 + n * 2.2;
      light.intensity = 4 + n * 18;
      haloMat.opacity = 0.15 + n * 0.4;
    },
    update(time: number) {
      head.rotation.y = time * 0.6;
      halo.scale.setScalar(1.0 + Math.sin(time * 2) * 0.06);
      // pulse with glow
      const pulse = 0.5 + Math.sin(time * 3.2) * 0.5;
      orbMat.emissiveIntensity = 0.8 + glow * 2.2 + pulse * 0.4 * glow;
    },
  };
}
