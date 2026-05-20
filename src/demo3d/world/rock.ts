import * as THREE from 'three';

const rockMat = new THREE.MeshStandardMaterial({
  color: 0x6e6356,
  roughness: 0.95,
  metalness: 0.0,
  flatShading: true,
});
const darkRockMat = new THREE.MeshStandardMaterial({
  color: 0x4a4238,
  roughness: 0.95,
  metalness: 0.0,
  flatShading: true,
});

export function createRock(scale = 1): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  // perturb
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const f = 0.7 + Math.random() * 0.6;
    pos.setX(i, x * f);
    pos.setY(i, y * f * 0.6 + 0.6);
    pos.setZ(i, z * f);
  }
  geo.computeVertexNormals();

  const mat = Math.random() > 0.5 ? rockMat : darkRockMat;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(scale);
  return mesh;
}
