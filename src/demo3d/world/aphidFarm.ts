import * as THREE from 'three';

const leafMat = new THREE.MeshStandardMaterial({
  color: 0x3a7a2a,
  roughness: 0.7,
  metalness: 0.05,
  side: THREE.DoubleSide,
});
const stemMat = new THREE.MeshStandardMaterial({
  color: 0x4a3a18,
  roughness: 0.9,
});
const aphidMat = new THREE.MeshStandardMaterial({
  color: 0x88dd66,
  roughness: 0.4,
  metalness: 0.1,
  emissive: new THREE.Color(0x336622),
  emissiveIntensity: 0.25,
});

export function createAphidFarm(): THREE.Group {
  const group = new THREE.Group();

  // stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 3, 6), stemMat);
  stem.position.y = 1.5;
  stem.castShadow = true;
  group.add(stem);

  // leaves
  for (let i = 0; i < 5; i++) {
    const leafGeo = new THREE.PlaneGeometry(2.4, 1.2, 1, 1);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.6, 2.2 + Math.sin(i) * 0.3, Math.sin(a) * 0.6);
    leaf.rotation.y = a;
    leaf.rotation.z = -0.4 - Math.random() * 0.2;
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }

  // aphids (small green spheres clustered on leaves)
  for (let i = 0; i < 8; i++) {
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), aphidMat);
    const ang = Math.random() * Math.PI * 2;
    const r = 0.8 + Math.random() * 0.9;
    a.position.set(Math.cos(ang) * r, 1.8 + Math.random() * 0.8, Math.sin(ang) * r);
    group.add(a);
  }

  return group;
}
