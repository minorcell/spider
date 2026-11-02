import { Group, LineSegments, Mesh, Vector3 } from 'three';
import { BONES, type MountSpec } from '../config.js';
import {
  ballGeo,
  ballShell,
  clawGeo,
  clawShell,
  inkMat,
  inkSolidMat,
  spiderMat,
  tubeCrest,
  tubeGeo,
  tubeShell,
} from './parts.js';

export class Leg {
  readonly plant = new Vector3();
  readonly foot = new Vector3();
  readonly swingFrom = new Vector3();
  readonly swingTo = new Vector3();
  readonly bones: Group[] = [];
  readonly joints: Mesh[] = [];
  readonly claw = new Group();
  lifted = false;

  constructor(
    rig: Group,
    readonly spec: MountSpec,
    /** The shoulder ball: its world matrix is all posing needs from the body. */
    readonly mount: Mesh,
    readonly index: number,
  ) {
    for (const bone of BONES) {
      const group = new Group();
      const mesh = new Mesh(tubeGeo, spiderMat);
      mesh.add(new Mesh(tubeShell, inkSolidMat));
      mesh.add(new LineSegments(tubeCrest, inkMat));
      group.add(mesh);
      rig.add(group);
      this.bones.push(group);

      const joint = new Mesh(ballGeo, spiderMat);
      joint.scale.setScalar(bone.radius * 1.35);
      joint.add(new Mesh(ballShell, inkSolidMat));
      rig.add(joint);
      this.joints.push(joint);
    }

    for (const sign of [-1, 1]) {
      const mesh = new Mesh(clawGeo, spiderMat);
      mesh.position.x = sign * 0.004;
      mesh.rotation.y = sign * 0.28;
      mesh.add(new Mesh(clawShell, inkSolidMat));
      this.claw.add(mesh);
    }
    const knuckle = new Mesh(ballGeo, spiderMat);
    knuckle.scale.setScalar(BONES[3].radius * 1.15);
    knuckle.add(new Mesh(ballShell, inkSolidMat));
    this.claw.add(knuckle);
    rig.add(this.claw);
  }
}
