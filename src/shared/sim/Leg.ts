import { Group, LineSegments, Mesh, Vector3 } from 'three';
import { BONES, type MountSpec } from '../config.js';
import {
  ballEdges,
  ballGeo,
  clawEdges,
  clawGeo,
  inkMat,
  spiderMat,
  tubeEdges,
  tubeGeo,
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
      mesh.add(new LineSegments(tubeEdges, inkMat));
      group.add(mesh);
      rig.add(group);
      this.bones.push(group);

      const joint = new Mesh(ballGeo, spiderMat);
      joint.scale.setScalar(bone.radius * 1.35);
      joint.add(new LineSegments(ballEdges, inkMat));
      rig.add(joint);
      this.joints.push(joint);
    }

    for (const sign of [-1, 1]) {
      const mesh = new Mesh(clawGeo, spiderMat);
      mesh.position.x = sign * 0.03;
      mesh.rotation.y = sign * 0.35;
      mesh.add(new LineSegments(clawEdges, inkMat));
      this.claw.add(mesh);
    }
    rig.add(this.claw);
  }
}
