import * as THREE from 'three';

const trunkMat = new THREE.MeshStandardMaterial({
  color: 0x3a2410,
  roughness: 0.9,
  metalness: 0.0,
});
const foliageMat = new THREE.MeshStandardMaterial({
  color: 0x2a4a1a,
  roughness: 0.85,
  metalness: 0.0,
  flatShading: true,
});

export function createTree(scale = 1): THREE.Group {
  const group = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.5, 4, 8),
    trunkMat
  );
  trunk.position.y = 2;
  trunk.castShadow = true;
  group.add(trunk);

  // stacked cones — stylized pine
  const layers = [
    { y: 3.8, r: 2.2, h: 2.8 },
    { y: 5.4, r: 1.6, h: 2.2 },
    { y: 6.8, r: 1.1, h: 1.8 },
  ];
  layers.forEach((l, i) => {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(l.r, l.h, 8 + i * 2),
      foliageMat
    );
    cone.position.y = l.y;
    cone.castShadow = true;
    cone.receiveShadow = true;
    // slight rotation per layer for variation
    cone.rotation.y = i * 0.3 + Math.random() * 0.5;
    group.add(cone);
  });

  group.scale.setScalar(scale);
  return group;
}
