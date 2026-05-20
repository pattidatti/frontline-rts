import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface AntOpts {
  count: number;
  baseColor: number;
  legColor: number;
  mandibleColor: number;
  homeZ: number;
  enemyZ: number;
  spread: number;
}

interface AntState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  goal: 'march' | 'return';
  phase: number;
  speed: number;
}

export class AntSwarm {
  group = new THREE.Group();
  count: number;
  private ants: AntState[] = [];
  private mesh: THREE.InstancedMesh;
  private legMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private homeZ: number;
  private enemyZ: number;
  private mandibleMat: THREE.MeshStandardMaterial;

  constructor(opts: AntOpts) {
    this.count = opts.count;
    this.homeZ = opts.homeZ;
    this.enemyZ = opts.enemyZ;

    // ant body = three spheres merged
    const head = new THREE.SphereGeometry(0.35, 12, 10);
    head.translate(0, 0.4, 0.6);
    const thorax = new THREE.SphereGeometry(0.32, 12, 10);
    thorax.translate(0, 0.42, 0.1);
    const abdomen = new THREE.SphereGeometry(0.45, 14, 12);
    abdomen.translate(0, 0.42, -0.55);
    abdomen.scale(0.85, 0.9, 1.2);

    // mandibles (small cones in front of head)
    const mandL = new THREE.ConeGeometry(0.07, 0.28, 6);
    mandL.rotateX(Math.PI / 2);
    mandL.translate(-0.15, 0.42, 1.0);
    const mandR = new THREE.ConeGeometry(0.07, 0.28, 6);
    mandR.rotateX(Math.PI / 2);
    mandR.translate(0.15, 0.42, 1.0);

    const bodyGeo = mergeGeometries([head, thorax, abdomen])!;
    const mandGeo = mergeGeometries([mandL, mandR])!;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: opts.baseColor,
      roughness: 0.55,
      metalness: 0.25,
    });
    this.mandibleMat = new THREE.MeshStandardMaterial({
      color: opts.mandibleColor,
      roughness: 0.45,
      metalness: 0.3,
    });

    this.mesh = new THREE.InstancedMesh(bodyGeo, bodyMat, opts.count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // mandibles as second instanced mesh sharing transforms
    this.legMesh = new THREE.InstancedMesh(mandGeo, this.mandibleMat, opts.count);
    this.legMesh.castShadow = false;
    this.legMesh.frustumCulled = false;
    this.group.add(this.legMesh);

    // initialize ants near the home mound
    for (let i = 0; i < opts.count; i++) {
      const a = (Math.random() - 0.5) * Math.PI * 1.4;
      const r = 5 + Math.random() * 12;
      this.ants.push({
        x: Math.cos(a) * r * opts.spread,
        z: opts.homeZ + Math.sin(a) * r * 0.6,
        vx: 0,
        vz: 0,
        phase: Math.random() * Math.PI * 2,
        goal: Math.random() < 0.6 ? 'march' : 'return',
        speed: 4 + Math.random() * 3,
      });
    }
  }

  update(time: number, dt: number) {
    const dir = this.enemyZ < this.homeZ ? -1 : 1;
    for (let i = 0; i < this.count; i++) {
      const a = this.ants[i];

      // pick a moving target along the corridor
      const targetZ = a.goal === 'march' ? this.enemyZ + dir * 6 : this.homeZ - dir * 6;
      const dx = -a.x * 0.05; // gentle attraction toward central corridor
      let dz = (targetZ - a.z);

      // river crossing — funnel ants through bridges at x = ±44
      if ((a.z < 8 && a.z > -8)) {
        const bridgeX = a.x < 0 ? -44 : 44;
        const lane = (bridgeX - a.x) * 0.6;
        a.vx += lane * dt;
      } else {
        a.vx += dx * dt * 4;
      }

      a.vz += Math.sign(dz) * dt * a.speed * 2;
      // damping
      a.vx *= 0.94;
      a.vz *= 0.94;
      // clamp speed
      const sp = Math.hypot(a.vx, a.vz);
      const maxSp = a.speed;
      if (sp > maxSp) {
        a.vx = (a.vx / sp) * maxSp;
        a.vz = (a.vz / sp) * maxSp;
      }
      // little wobble
      const wob = Math.sin(time * 4 + a.phase) * 0.6;
      a.vx += -Math.sin(Math.atan2(a.vz, a.vx)) * wob * dt;

      a.x += a.vx * dt;
      a.z += a.vz * dt;

      // switch goal when near target
      if (a.goal === 'march' && Math.abs(a.z - this.enemyZ) < 18) {
        if (Math.random() < 0.02) a.goal = 'return';
      } else if (a.goal === 'return' && Math.abs(a.z - this.homeZ) < 18) {
        if (Math.random() < 0.02) a.goal = 'march';
      }

      // bouncing little vertical bob
      const y = 0.05 + Math.abs(Math.sin(time * 9 + a.phase)) * 0.12;
      const yaw = Math.atan2(a.vx, a.vz);

      this.dummy.position.set(a.x, y, a.z);
      this.dummy.rotation.set(0, yaw, Math.sin(time * 10 + a.phase) * 0.08);
      this.dummy.scale.setScalar(1.0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.legMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.legMesh.instanceMatrix.needsUpdate = true;
  }
}
