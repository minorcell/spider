import { Object3D, Quaternion, Vector3 } from 'three';

/** Fixed-step poses are sampled once, then presented between those two samples. */
export class PoseInterpolation {
  readonly #poses;

  constructor(nodes: readonly Object3D[]) {
    this.#poses = nodes.map((node) => ({
      node,
      from: { p: new Vector3(), q: new Quaternion(), s: new Vector3() },
      to: { p: new Vector3(), q: new Quaternion(), s: new Vector3() },
    }));
    this.reset();
  }

  reset(): void {
    for (const { node, from, to } of this.#poses) {
      from.p.copy(node.position);
      to.p.copy(node.position);
      from.q.copy(node.quaternion);
      to.q.copy(node.quaternion);
      from.s.copy(node.scale);
      to.s.copy(node.scale);
    }
  }

  step(update: () => void): void {
    // Presentation never becomes the starting point of the next simulation pose.
    for (const { node, from, to } of this.#poses) {
      node.position.copy(to.p);
      node.quaternion.copy(to.q);
      node.scale.copy(to.s);
      from.p.copy(to.p);
      from.q.copy(to.q);
      from.s.copy(to.s);
    }
    update();
    for (const { node, to } of this.#poses) {
      to.p.copy(node.position);
      to.q.copy(node.quaternion);
      to.s.copy(node.scale);
    }
  }

  present(alpha: number): void {
    for (const { node, from, to } of this.#poses) {
      node.position.lerpVectors(from.p, to.p, alpha);
      node.quaternion.slerpQuaternions(from.q, to.q, alpha);
      node.scale.lerpVectors(from.s, to.s, alpha);
    }
  }
}
