import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Lane } from './lanes';

interface AntOpts {
  count: number;
  baseColor: number;
  legColor: number;
  mandibleColor: number;
  lanes: Lane[];
  /** 'player' marches t=0→1, 'ai' marches t=1→0 */
  side: 'player' | 'ai';
  homePos: { x: number; z: number };
  arenaRadius: number;
}

interface AntState {
  laneIdx: number;
  t: number;
  mode: 'march' | 'idle';
  idleAngle: number;
  idleRadius: number;
  idleTheta: number;
  speed: number;
  laneOffset: number;
  phase: number;
}

export class AntSwarm {
  group = new THREE.Group();
  count: number;
  private ants: AntState[] = [];
  private mesh: THREE.InstancedMesh;
  private mandMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private lanes: Lane[];
  private home: { x: number; z: number };
  private arenaR: number;
  private dir: number;

  constructor(opts: AntOpts) {
    this.count = opts.count;
    this.lanes = opts.lanes;
    this.home = opts.homePos;
    this.arenaR = opts.arenaRadius;
    this.dir = opts.side === 'player' ? 1 : -1;

    const head = new THREE.SphereGeometry(0.55, 12, 10);
    head.translate(0, 0.42, 0.85);
    const thorax = new THREE.SphereGeometry(0.5, 12, 10);
    thorax.translate(0, 0.46, 0.15);
    const abdomen = new THREE.SphereGeometry(0.7, 14, 12);
    abdomen.translate(0, 0.48, -0.75);
    abdomen.scale(0.85, 0.9, 1.2);

    const mandL = new THREE.ConeGeometry(0.1, 0.4, 6);
    mandL.rotateX(Math.PI / 2);
    mandL.translate(-0.22, 0.42, 1.4);
    const mandR = new THREE.ConeGeometry(0.1, 0.4, 6);
    mandR.rotateX(Math.PI / 2);
    mandR.translate(0.22, 0.42, 1.4);

    const bodyGeo = mergeGeometries([head, thorax, abdomen])!;
    const mandGeo = mergeGeometries([mandL, mandR])!;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: opts.baseColor,
      roughness: 0.55,
      metalness: 0.25,
    });
    const mandMat = new THREE.MeshStandardMaterial({
      color: opts.mandibleColor,
      roughness: 0.45,
      metalness: 0.3,
    });

    this.mesh = new THREE.InstancedMesh(bodyGeo, bodyMat, opts.count);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this.mandMesh = new THREE.InstancedMesh(mandGeo, mandMat, opts.count);
    this.mandMesh.castShadow = false;
    this.mandMesh.frustumCulled = false;
    this.group.add(this.mandMesh);

    for (let i = 0; i < opts.count; i++) {
      const startMarching = Math.random() < 0.8;
      this.ants.push({
        laneIdx: Math.floor(Math.random() * opts.lanes.length),
        t: opts.side === 'player' ? Math.random() * 0.5 : 0.5 + Math.random() * 0.5,
        mode: startMarching ? 'march' : 'idle',
        idleAngle: Math.random() * Math.PI * 2,
        idleRadius: 4 + Math.random() * opts.arenaRadius * 0.7,
        idleTheta: Math.random() * 2,
        speed: 0.024 + Math.random() * 0.022,
        laneOffset: (Math.random() - 0.5) * 0.7,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  update(time: number, dt: number) {
    for (let i = 0; i < this.count; i++) {
      const a = this.ants[i];
      let x: number, z: number, yaw: number;

      if (a.mode === 'march') {
        a.t += a.speed * dt * this.dir;
        const reachedEnd = this.dir > 0 ? a.t >= 1 : a.t <= 0;
        if (reachedEnd) {
          a.mode = 'idle';
          a.idleAngle = Math.random() * Math.PI * 2;
          a.idleRadius = 4 + Math.random() * this.arenaR * 0.7;
          a.idleTheta = 0;
          a.t = this.dir > 0 ? 1 : 0;
        }
        const lane = this.lanes[a.laneIdx];
        const p = lane.pointAt(a.t);
        const tan = lane.tangentAt(a.t);
        const w = lane.widthAt(a.t) * 0.45;
        const nx = -tan.y * a.laneOffset * w;
        const nz = tan.x * a.laneOffset * w;
        const wobble = Math.sin(time * 5 + a.phase) * 0.5;
        x = p.x + nx + (-tan.y) * wobble * 0.6;
        z = p.z + nz + (tan.x) * wobble * 0.6;
        yaw = Math.atan2(tan.x * this.dir, tan.y * this.dir);
      } else {
        a.idleTheta += dt * (0.6 + a.phase * 0.05);
        const ang = a.idleAngle + Math.sin(a.idleTheta) * 0.6;
        x = this.home.x + Math.cos(ang) * a.idleRadius;
        z = this.home.z + Math.sin(ang) * a.idleRadius;
        if (Math.random() < 0.0018) {
          a.mode = 'march';
          a.laneIdx = Math.floor(Math.random() * this.lanes.length);
          a.t = this.dir > 0 ? 0 : 1;
          a.laneOffset = (Math.random() - 0.5) * 0.7;
          a.speed = 0.024 + Math.random() * 0.022;
        }
        yaw = Math.atan2(-Math.sin(ang), Math.cos(ang));
      }

      const y = 0.05 + Math.abs(Math.sin(time * 11 + a.phase)) * 0.18;
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0, yaw, Math.sin(time * 12 + a.phase) * 0.1);
      this.dummy.scale.setScalar(1.0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mandMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mandMesh.instanceMatrix.needsUpdate = true;
  }
}
