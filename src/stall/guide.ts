// Where a held stone will land: a dashed drop line, a ring on the landing spot and a translucent copy of the stone
// resting there. Each line and ring is drawn twice: depth-tested and bright where it is in view, and faint where
// something covers it. Drawing it on top of everything instead would lose depth: a ring behind a bin wall would
// look as if it were in front.
import * as THREE from 'three';
import type { Vec3 } from './stones.ts';

const PASSES = [
  { opacity: 0.95, depthFunc: THREE.LessEqualDepth },
  { opacity: 0.22, depthFunc: THREE.GreaterDepth },
];

export class DropGuide {
  readonly group = new THREE.Group();
  private readonly lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  private readonly lines: THREE.Line[];
  private readonly rings: THREE.Mesh[];
  private readonly ghost: THREE.Mesh;

  constructor() {
    const ring = new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2);
    this.lines = PASSES.map((p) => new THREE.Line(this.lineGeometry, new THREE.LineDashedMaterial({
      dashSize: 0.025, gapSize: 0.018, transparent: true, depthWrite: false, ...p,
    })));
    this.rings = PASSES.map((p) => new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, ...p,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, // not to flicker against the floor it lies on
    })));
    this.ghost = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4, depthWrite: false, flatShading: true }));
    this.group.add(...this.lines, ...this.rings, this.ghost);
    this.group.visible = false;
  }

  /** from: the held stone's centre; to: its centre once landed. The ghost copies the held stone's shape. */
  show(from: Vec3, to: Vec3, radius: number, stone: THREE.Mesh, color: number) {
    this.group.visible = true;
    const bottom = to.y - radius;
    this.lineGeometry.setFromPoints([new THREE.Vector3(from.x, from.y - radius, from.z), new THREE.Vector3(to.x, bottom, to.z)]);
    this.lines[0].computeLineDistances(); // the lines share the geometry, so once is enough
    for (const l of this.lines) (l.material as THREE.LineDashedMaterial).color.setHex(color);
    for (const r of this.rings) {
      r.position.set(to.x, bottom + 0.002, to.z);
      r.scale.setScalar(radius * 1.6);
      (r.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
    this.ghost.geometry = stone.geometry;
    this.ghost.rotation.copy(stone.rotation);
    this.ghost.position.set(to.x, to.y, to.z);
    (this.ghost.material as THREE.MeshStandardMaterial).color.copy((stone.material as THREE.MeshStandardMaterial).color);
  }

  hide() {
    this.group.visible = false;
  }

  /** the landing spot, for placing labels */
  get spot(): THREE.Vector3 {
    return this.rings[0].position;
  }
}
