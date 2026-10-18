import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  MathUtils,
  NormalBlending,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector2,
} from "three";

/**
 * particles.ts -- smoke, steam and sparks: soft round points that rise, drift, swell and fade, a fixed pool of them per kind.
 *
 * Each kind is one `Points` mesh over a pool allocated once at its bound;
 * an emitted particle takes the next free slot, and a dead one gives its slot
 * back by swapping the last live one into it, so a frame only walks the live
 * ones and draws them in one call. A point is sized in scene units, scaled by
 * the drawing buffer's height as the renderer draws it, so a puff of smoke
 * keeps its size on any screen. They are idle motion only: a still world
 * emits nothing.
 */

const VERTEX = `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -view.z;
    gl_Position = projectionMatrix * view;
  }`;

const FRAGMENT = `
  uniform float uSoft;
  varying vec4 vColor;
  void main() {
    float edge = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.5 * uSoft, 0.5, edge);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
    #include <colorspace_fragment>
  }`;

const BUFFER = new Vector2();

/** One kind of particle: a pool of soft points, additive (sparks, fire) or not (smoke). */
export class Particles {
  readonly points: Points;
  private count = 0;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private readonly alpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly attributes: readonly BufferAttribute[];

  constructor(
    private readonly capacity: number,
    additive: boolean,
    soft: number,
  ) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.from = new Float32Array(capacity);
    this.to = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(this.position, 3).setUsage(DynamicDrawUsage);
    const color = new BufferAttribute(this.color, 4).setUsage(DynamicDrawUsage);
    const size = new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", position);
    geometry.setAttribute("aColor", color);
    geometry.setAttribute("aSize", size);
    geometry.setDrawRange(0, 0);
    this.attributes = [position, color, size];
    const material = new ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: soft } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    // Note that a point's size is read off the drawing buffer as the renderer draws, the one place a world sees it.
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 40;
      renderer.getDrawingBufferSize(BUFFER);
      const uniform = material.uniforms.uScale;
      if (uniform !== undefined) {
        uniform.value = BUFFER.y / (2 * Math.tan(MathUtils.degToRad(fov) / 2));
      }
    };
  }

  /** Lets go of every particle at once. */
  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    from: number,
    to: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    drag = 0.5,
    gravity = 0,
  ): void {
    if (this.count >= this.capacity) return;
    const at = this.count;
    this.count += 1;
    this.position.set([x, y, z], at * 3);
    this.velocity.set([vx, vy, vz], at * 3);
    this.color.set([r, g, b, alpha], at * 4);
    this.life[at] = life;
    this.age[at] = 0;
    this.from[at] = from;
    this.to[at] = to;
    this.alpha[at] = alpha;
    this.drag[at] = drag;
    this.gravity[at] = gravity;
  }

  /** Ages every live particle by `delta` seconds: it drifts, slows, swells, and fades, and dies at the end of its life. */
  step(delta: number): void {
    for (let at = 0; at < this.count; at += 1) {
      const age = (this.age[at] ?? 0) + delta;
      const life = this.life[at] ?? 1;
      if (age >= life) {
        this.count -= 1;
        this.move(this.count, at);
        at -= 1;
        continue;
      }
      this.age[at] = age;
      const t = age / life;
      const damp = Math.exp(-(this.drag[at] ?? 0) * delta);
      const v = at * 3;
      const vx = (this.velocity[v] ?? 0) * damp;
      const vy = (this.velocity[v + 1] ?? 0) * damp - (this.gravity[at] ?? 0) * delta;
      const vz = (this.velocity[v + 2] ?? 0) * damp;
      this.velocity.set([vx, vy, vz], v);
      let y = (this.position[v + 1] ?? 0) + vy * delta;
      if (y < 0.05) {
        y = 0.05;
        this.velocity[v + 1] = -vy * 0.2;
      }
      this.position.set(
        [(this.position[v] ?? 0) + vx * delta, y, (this.position[v + 2] ?? 0) + vz * delta],
        v,
      );
      this.size[at] =
        (this.from[at] ?? 0) + ((this.to[at] ?? 0) - (this.from[at] ?? 0)) * Math.sqrt(t);
      this.color[at * 4 + 3] = (this.alpha[at] ?? 0) * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.points.geometry.setDrawRange(0, this.count);
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }

  private move(from: number, to: number): void {
    if (from === to) return;
    this.position.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.velocity.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.color.copyWithin(to * 4, from * 4, from * 4 + 4);
    for (const array of [
      this.size,
      this.life,
      this.age,
      this.from,
      this.to,
      this.alpha,
      this.drag,
      this.gravity,
    ]) {
      array[to] = array[from] ?? 0;
    }
  }
}

/**
 * Glows: a soft additive halo round each lamp, for the night. Where the
 * mockup bloomed its lamps, this draws the halo itself: one point per lamp,
 * written once per board, its strength following the night.
 */
export class Glows {
  readonly points: Points;
  private readonly material: ShaderMaterial;

  constructor(private readonly capacity: number) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute("aColor", new BufferAttribute(new Float32Array(capacity * 4), 4));
    geometry.setAttribute("aSize", new BufferAttribute(new Float32Array(capacity), 1));
    geometry.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const fov = camera instanceof PerspectiveCamera ? camera.fov : 40;
      renderer.getDrawingBufferSize(BUFFER);
      const uniform = this.material.uniforms.uScale;
      if (uniform !== undefined)
        uniform.value = BUFFER.y / (2 * Math.tan(MathUtils.degToRad(fov) / 2));
    };
  }

  /** Sets one warm halo of `size` over each of `spots`, up to the bound. */
  place(
    spots: readonly { readonly x: number; readonly y: number; readonly z: number }[],
    size: number,
  ): void {
    const geometry = this.points.geometry;
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("aColor");
    const sizes = geometry.getAttribute("aSize");
    const shown = spots.slice(0, this.capacity);
    shown.forEach((spot, index) => {
      position.setXYZ(index, spot.x, spot.y, spot.z);
      color.setXYZW(index, 1, 0.78, 0.45, 1);
      sizes.setX(index, size);
    });
    geometry.setDrawRange(0, shown.length);
    for (const attribute of [position, color, sizes]) attribute.needsUpdate = true;
  }

  /** How strongly the halos shine: none by day. */
  setStrength(strength: number): void {
    this.points.visible = strength > 0.01;
    const color = this.points.geometry.getAttribute("aColor");
    for (let index = 0; index < color.count; index += 1) color.setW(index, strength * 0.35);
    color.needsUpdate = true;
  }
}
