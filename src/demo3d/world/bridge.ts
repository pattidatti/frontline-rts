import * as THREE from 'three';

export function createBridge(): THREE.Group {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x6a4a2a,
    roughness: 0.85,
    metalness: 0.05,
  });
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x3a2818,
    roughness: 0.9,
  });

  // planks
  for (let i = 0; i < 9; i++) {
    const g = new THREE.BoxGeometry(2.0, 0.3, 1.4);
    const m = new THREE.Mesh(g, woodMat);
    m.position.set(0, 0.45, -8 + i * 2);
    m.rotation.y = (Math.random() - 0.5) * 0.06;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // side beams
  for (const sign of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 20), darkWoodMat);
    beam.position.set(sign * 1.1, 0.6, 0);
    beam.castShadow = true;
    beam.receiveShadow = true;
    group.add(beam);
    // posts
    for (const z of [-9, -3, 3, 9]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), darkWoodMat);
      post.position.set(sign * 1.1, 1.1, z);
      post.castShadow = true;
      group.add(post);
    }
  }

  // small lantern on each end
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xfff0a0,
    emissive: new THREE.Color(0xffb050),
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });
  for (const z of [-9.5, 9.5]) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), lanternMat);
    lantern.position.set(1.1, 2.2, z);
    group.add(lantern);
    const lLight = new THREE.PointLight(0xffb050, 6, 14, 2);
    lLight.position.copy(lantern.position);
    group.add(lLight);
  }

  return group;
}
