import { LEG_GEOMETRIES, segmentMat, setaeMat } from '@/src/client/rig/legGeometry';
import { Group, LineSegments, Mesh, Vector3 } from 'three';
import { BONES, type MountSpec } from '@/src/shared/config';
import {
  ballGeo,
  ballShell,
  clawGeo,
  clawShell,
  inkSolidMat,
  growShell,
  jointMat,
} from '@/src/client/rig/parts';

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
    readonly mount: Mesh,
    readonly index: number,
  ) {
    for (const [section, bone] of BONES.entries()) {
      const group = new Group();
      const { shell, setae } = LEG_GEOMETRIES[section];
      const mesh = new Mesh(shell, segmentMat);
      mesh.name = ['coxa-segment', 'femur-segment', 'tibia-segment', 'tarsus-segment'][section];
      mesh.add(new Mesh(growShell(shell, 0.035, true), inkSolidMat));
      const hairs = new LineSegments(setae, setaeMat);
      hairs.name = 'leg-setae';
      mesh.add(hairs);
      group.add(mesh);
      rig.add(group);
      this.bones.push(group);

      const joint = new Mesh(ballGeo, jointMat);
      const radius = bone.radius * [0.46, 0.41, 0.5, 0.48][section];
      joint.scale.set(radius, radius * 0.85, radius);
      joint.add(new Mesh(ballShell, inkSolidMat));
      rig.add(joint);
      this.joints.push(joint);
    }

    for (const sign of [-1, 1]) {
      const mesh = new Mesh(clawGeo, jointMat);
      mesh.position.x = sign * 0.0035;
      mesh.rotation.y = sign * 0.18;
      mesh.add(new Mesh(clawShell, inkSolidMat));
      this.claw.add(mesh);
    }
    // A small pretarsus joins the two hooks; there is no ball at the contact point.
    const tip = new Mesh(ballGeo, jointMat);
    tip.name = 'pretarsus';
    tip.position.z = 0.005;
    tip.scale.set(0.007, 0.005, 0.012);
    tip.add(new Mesh(ballShell, inkSolidMat));
    this.claw.add(tip);
    rig.add(this.claw);
  }
}
