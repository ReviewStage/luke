import { ZONE_LAYER, type ZoneEdge, type ZoneView } from "@luke/ui/factory-world";
import {
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  type Vector3,
} from "three";
import {
  basisFromY,
  basisFromZ,
  between,
  box,
  clamp,
  clean,
  cylinder,
  hashOf,
  merged,
  NO_ZONE,
  Parts,
  radial,
  ring,
  seeded,
  sphere,
  TAU,
  tangent,
  torusPatch,
  translation,
  v3,
} from "./kit";
import { SHADER_OUTPUT, type StationMaterials, type StationUniforms } from "./materials";

/**
 * station.ts -- the station built from a repository's zones: the core at its heart, the domain on spokes, the surface around the outer ring, and the tooling up and down the spine.
 *
 * Each layer has its own architecture, the mockup's: the core is the
 * station's heart, the zone most depended on a glowing data sphere, the
 * next the reactor ring around it, the next a gimbal turning about it, and
 * the rest drums up and down the spine; the domain's zones are modules on
 * the spokes, longer as they hold more; the surface's zones are segments of
 * the outer ring, each an arc as long as its footprint, dressed with domes,
 * dishes, docks, arrays, fins or antennae chosen by its path; and tooling
 * stands as masts above and below. Every size reads `footprint`.
 *
 * Note that a domain or surface zone stands where the view's layout puts
 * it: its spoke, or its segment's middle, at the angle of its layout `x`
 * and `y`, and only pushed aside where it would overlap a neighbour. So the
 * same path lands in the same place every time, a zone that comes or goes
 * nudges no more than its neighbours, and the bare frame of the outer ring
 * runs where no surface zone stands. The core and tooling have no angle
 * here: they are the heart and the spine, placed by rank.
 *
 * Every zone's parts merge into one mesh per material, with the zone's
 * column carried per vertex (`kit.ts`), so the station is a dozen draw calls
 * however many zones it has. Beside them each zone gets a pick proxy, a
 * close shell that draws nothing, and a glow shell, merged, that lights
 * where the zone's signals say. A `ZoneBody` is what the rest of the world
 * builds on: where a zone stands, where on its hull an agent works, where a
 * shipped light sits, and where a conduit leaves it.
 */

/** The outer ring's radius. */
const RING_RADIUS = 40;
/** Where the spokes leave the hub. */
const HUB_RADIUS = 12.4;
/** Where the first domain module on a spoke begins. */
const MODULE_START = 14;
/** The outer ring's bare frame, where no surface zone stands. */
const FRAME_TUBE = 0.9;
/** The gap between two outer ring segments, in radians. */
const SEGMENT_GAP = 0.012;
/** The reactor ring's radius. */
const REACTOR_RADIUS = 8.6;
/** How far a spine drum or mast stands off the heart, up or down. */
const SPINE_START = 6.4;
/** How many navigation light sites each zone keeps for its shipped work. */
const SPOTS_PER_ZONE = 40;

/** What a zone is built as. */
const ZONE_SHAPE = {
  SPHERE: "sphere",
  REACTOR: "reactor",
  GIMBAL: "gimbal",
  DRUM: "drum",
  MAST: "mast",
  MODULE: "module",
  SEGMENT: "segment",
} as const;

type ZoneShape = (typeof ZONE_SHAPE)[keyof typeof ZONE_SHAPE];

/** How an outer ring segment is dressed, chosen by its path. */
const SEGMENT_DRESS = {
  DOMES: "domes",
  DOME: "dome",
  HAB: "hab",
  DISH: "dish",
  SOLAR: "solar",
  DOCK: "dock",
  BEACON: "beacon",
  RADIATOR: "radiator",
  ANTENNA: "antenna",
} as const;

type SegmentDress = (typeof SEGMENT_DRESS)[keyof typeof SEGMENT_DRESS];

/** The dressings a segment is drawn from, domes the commonest, as on the mockup's ring. */
const DRESS_CHOICES: readonly SegmentDress[] = [
  SEGMENT_DRESS.DOMES,
  SEGMENT_DRESS.DOMES,
  SEGMENT_DRESS.DOMES,
  SEGMENT_DRESS.HAB,
  SEGMENT_DRESS.DISH,
  SEGMENT_DRESS.SOLAR,
  SEGMENT_DRESS.DOCK,
  SEGMENT_DRESS.BEACON,
  SEGMENT_DRESS.RADIATOR,
  SEGMENT_DRESS.ANTENNA,
  SEGMENT_DRESS.DOME,
];

/** Each layer's accent, the core's pale and the rest a steel blue, as the mockup's seams are. */
const LAYER_ACCENT = {
  [ZONE_LAYER.CORE]: "#cfe8ff",
  [ZONE_LAYER.DOMAIN]: "#7f8ea6",
  [ZONE_LAYER.SURFACE]: "#7f8ea6",
  [ZONE_LAYER.TOOLING]: "#7f8ea6",
} as const;

/** A point on a zone's hull, and the hull's outward normal there. */
interface HullPoint {
  readonly point: Vector3;
  readonly normal: Vector3;
}

/** Where an agent works on a zone: the foot of its build, and the way the build grows. */
export interface WorkSite {
  readonly point: Vector3;
  readonly direction: Vector3;
}

/** One zone as the station built it. */
export interface ZoneBody {
  /** Its column in the zone signals (`materials.ts`). */
  readonly index: number;
  readonly zone: ZoneView;
  readonly shape: ZoneShape;
  readonly center: Vector3;
  /** About how far across it is. */
  readonly size: number;
  /** The radius of its hull where a breach can open: a tube's, or a sphere's. */
  readonly hullRadius: number;
  readonly accent: Color;
  /** A point on its hull, `along` from 0 to 1 and `around` in radians. */
  readonly surface: (along: number, around: number) => HullPoint;
  /** Where the `k`th of `n` agents working on it builds. */
  readonly site: (k: number, n: number) => WorkSite;
  /** Where its shipped work's lights sit, in order. */
  readonly spots: readonly HullPoint[];
  /** Where a conduit to `toward` leaves it. */
  readonly port: (toward: Vector3) => Vector3;
  /** Whether it turns with the gimbal, so what stands on it would drift. */
  readonly turning: boolean;
  /** Lays `point` onto its hull, `lift` above it: how a scorch mark follows the hull's curve. */
  readonly project: (point: Vector3, lift: number) => Vector3;
}

/** Lays a point onto a tube about the circle of `major` round the spine. */
function ontoRing(major: number, minor: number): (point: Vector3, lift: number) => Vector3 {
  return (point, lift) => {
    const centre = radial(Math.atan2(point.z, point.x)).multiplyScalar(major);
    return point
      .sub(centre)
      .normalize()
      .multiplyScalar(minor + lift)
      .add(centre);
  };
}

/** Leaves a point where it is, for a hull too small or too square to follow. */
function inPlace(point: Vector3): Vector3 {
  return point;
}

/** The built station. */
export interface Station {
  /** Everything the station draws, in station space. */
  readonly root: Group;
  readonly bodies: ReadonlyMap<string, ZoneBody>;
  /** Each zone's pick proxy, by path. */
  readonly proxies: ReadonlyMap<string, Mesh>;
  /** The group that turns about the heart, where a core zone is the gimbal. */
  readonly gimbal: Group;
  /** The data sphere's heart, which turns its own shader. */
  readonly heart: Mesh | undefined;
  /** The zone everything else is placed on where it names none: the heart's, or the first. */
  readonly fallback: ZoneBody | undefined;
  /** Lets go of every geometry the station built; its materials are the world's. */
  readonly dispose: () => void;
}

/** What a zone builder adds to: its parts, its seeded randomness, its column. */
interface Builder {
  readonly parts: Parts;
  readonly random: () => number;
  readonly index: number;
  readonly materials: StationMaterials;
  readonly uniforms: StationUniforms;
  /** The materials only this station uses, which it lets go of with its geometry. */
  readonly owned: ShaderMaterial[];
}

/** What a builder answers, beside its parts: the body, and its pick and glow shells. */
interface Built {
  readonly body: ZoneBody;
  readonly proxy: BufferGeometry;
  readonly shell: BufferGeometry;
}

/** The angle of a zone's place on the layout's floor. */
function angleOf(zone: ZoneView): number {
  return Math.atan2(zone.y, zone.x);
}

/**
 * Where each of `items` stands on a circle: at its own angle, unless that
 * would overlap a neighbour, in which case the two are pushed apart, each
 * half the overlap, until none overlaps by more than a hair. Widths are
 * radians; where they cannot all fit round the circle, each is shrunk alike
 * first, and `fit` says by how much.
 */
function spreadOnCircle(
  items: readonly { readonly angle: number; readonly width: number }[],
  gap: number,
) {
  const total = items.reduce((sum, item) => sum + item.width + gap, 0);
  const fit = total > TAU ? TAU / total : 1;
  const order = items
    .map((_, index) => index)
    .sort((left, right) => (items[left]?.angle ?? 0) - (items[right]?.angle ?? 0));
  const centres = items.map((item) => item.angle);
  for (let pass = 0; pass < 200 && order.length > 1; pass += 1) {
    let moved = false;
    order.forEach((index, rank) => {
      const next = order[(rank + 1) % order.length] ?? index;
      const here = centres[index] ?? 0;
      const there = (centres[next] ?? 0) + (rank === order.length - 1 ? TAU : 0);
      const needed =
        (((items[index]?.width ?? 0) + (items[next]?.width ?? 0)) / 2) * fit + gap * fit;
      const overlap = needed - (there - here);
      if (overlap <= 1e-4) return;
      moved = true;
      centres[index] = here - overlap / 2;
      centres[next] = (centres[next] ?? 0) + overlap / 2;
    });
    if (!moved) break;
  }
  return { centres, fit };
}

/** Small boxes, cans, foil and whips scattered over a hull, `count` of them where `place` says. */
function greebles(builder: Builder, count: number, place: (u: number) => HullPoint): void {
  const { parts, random, index, materials } = builder;
  for (let n = 0; n < count; n += 1) {
    const { point, normal } = place(random());
    const matrix = basisFromY(normal, point);
    const kind = random();
    if (kind < 0.45) {
      parts.add(
        materials.dark,
        box(between(random, 0.3, 1.1), between(random, 0.15, 0.45), between(random, 0.3, 1.1)),
        matrix,
        index,
      );
    } else if (kind < 0.7) {
      const radius = between(random, 0.15, 0.4);
      parts.add(
        materials.hull,
        cylinder(radius, radius, between(random, 0.2, 0.7), 10),
        matrix,
        index,
      );
    } else if (kind < 0.85) {
      parts.add(
        materials.foil,
        box(between(random, 0.5, 1.3), 0.25, between(random, 0.5, 1)),
        matrix,
        index,
      );
    } else {
      const length = between(random, 1, 2.6);
      parts.add(
        materials.dark,
        cylinder(0.04, 0.04, length, 5),
        matrix.multiply(translation(0, length / 2, 0)),
        index,
      );
    }
  }
}

function spotsOf(random: () => number, place: (u: number) => HullPoint): HullPoint[] {
  return Array.from({ length: SPOTS_PER_ZONE }, () => place(random()));
}

/** A parabolic dish's profile, `diameter` across and `depth` deep for its width. */
function dishProfile(radius: number, depth: number, steps: number): Vector2[] {
  return Array.from({ length: steps + 1 }, (_, step) => {
    const x = (radius * step) / steps;
    return new Vector2(x, x * x * depth);
  });
}

/** The heart: an armoured sphere around a glowing core of data. */
function buildSphere(
  builder: Builder,
  zone: ZoneView,
  heart: Group,
): Built & { radius: number; mesh: Mesh } {
  const { parts, random, index, materials } = builder;
  const radius = 3.4 + 2.2 * zone.footprint;
  const mesh = new Mesh(new SphereGeometry(radius * 0.9, 64, 32), heartMaterial(builder));
  heart.add(mesh);
  const bands: readonly [number, number][] = [
    [0, 0.33],
    [0.42, 0.62],
    [0.78, 0.98],
    [1.17, 1.37],
    [1.47, 1.65],
    [1.82, 2.12],
    [2.22, 2.6],
    [2.72, Math.PI],
  ];
  for (const [from, to] of bands)
    parts.add(materials.hull, sphere(radius, 48, 8, [0, TAU], [from, to - from]), undefined, index);
  for (let k = 0; k < 8; k += 1) {
    const turn = new Matrix4()
      .makeRotationY((k * Math.PI) / 8)
      .multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    parts.add(materials.dark, new TorusGeometry(radius + 0.06, 0.12, 5, 48, Math.PI), turn, index);
  }
  parts.add(
    materials.accent,
    ring(radius + 0.15, 0.08, 6, 64),
    new Matrix4().makeRotationX(Math.PI / 2),
    index,
  );
  const surface = (along: number, elevation: number): HullPoint => {
    const angle = along * TAU;
    const normal = v3(
      Math.cos(angle) * Math.cos(elevation),
      Math.sin(elevation),
      Math.sin(angle) * Math.cos(elevation),
    );
    return { point: normal.clone().multiplyScalar(radius), normal };
  };
  const body: ZoneBody = {
    index,
    zone,
    shape: ZONE_SHAPE.SPHERE,
    center: v3(),
    size: radius * 2.2,
    hullRadius: radius,
    accent: new Color(LAYER_ACCENT[zone.layer]),
    surface,
    site: (k, n) => {
      const { point, normal } = surface(0.064 + k / Math.max(n, 3), 0.95);
      return {
        point,
        direction: normal
          .clone()
          .add(v3(0, 0.35, 0))
          .normalize(),
      };
    },
    spots: spotsOf(random, () => {
      const normal = v3(
        between(random, -1, 1),
        between(random, 0.1, 0.9),
        between(random, -1, 1),
      ).normalize();
      return { point: normal.clone().multiplyScalar(radius + 0.1), normal };
    }),
    port: (toward) => {
      const direction = toward.lengthSq() < 1e-3 ? v3(0, 1, 0) : toward.clone().normalize();
      return direction.multiplyScalar(radius * 0.95);
    },
    turning: false,
    project: (point, lift) => point.normalize().multiplyScalar(radius + lift),
  };
  return {
    body,
    radius,
    mesh,
    proxy: new SphereGeometry(radius * 1.04, 24, 12),
    shell: new SphereGeometry(radius * 1.15, 32, 16),
  };
}

/** The data sphere's glowing core: rows of bits streaming around it. */
function heartMaterial(builder: Builder): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: { uTime: builder.uniforms.uTime, uColor: { value: new Color(0xa8dcff) } },
    vertexShader: /* glsl */ `
varying vec3 vPoint; varying vec3 vNormal; varying vec3 vView;
void main() {
  vPoint = position;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -view.xyz;
  gl_Position = projectionMatrix * view;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform vec3 uColor;
varying vec3 vPoint; varying vec3 vNormal; varying vec3 vView;
float bitHash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec3 p = normalize(vPoint);
  float latitude = asin(p.y), longitude = atan(p.z, p.x);
  float row = floor(latitude * 18.0);
  float speed = (bitHash(row) - 0.5) * 1.6;
  float cell = fract((longitude + uTime * speed) * 9.0 + bitHash(row * 3.1));
  float bit = step(0.55, bitHash(floor((longitude + uTime * speed) * 9.0) + row * 17.0));
  float line = smoothstep(0.42, 0.5, abs(fract(latitude * 18.0) - 0.5));
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
  vec3 color = uColor * (0.35 + bit * smoothstep(0.0, 0.25, cell) * smoothstep(1.0, 0.6, cell) * 2.4) * (1.0 - line * 0.8) + uColor * rim * 1.2;
  gl_FragColor = vec4(color * 1.4, 1.0);
  ${SHADER_OUTPUT}
}`,
  });
  builder.owned.push(material);
  return material;
}

/** The reactor: a ring of plasma about the heart, braced to it. */
function buildReactor(builder: Builder, zone: ZoneView, heartRadius: number, plasma: Group): Built {
  const { parts, random, index, materials } = builder;
  const minor = 0.9 + 2 * zone.footprint;
  parts.add(
    materials.hull,
    torusPatch(REACTOR_RADIUS, minor, [0, TAU], [-Math.PI, Math.PI], [96, 24]),
    undefined,
    index,
  );
  parts.add(
    materials.window,
    torusPatch(REACTOR_RADIUS, minor + 0.02, [0, TAU], [-0.35, 0.35], [96, 4]),
    undefined,
    index,
  );
  plasma.add(
    new Mesh(
      torusPatch(REACTOR_RADIUS, minor + 0.03, [0, TAU], [Math.PI - 0.5, Math.PI + 0.5], [128, 6]),
      plasmaMaterial(builder),
    ),
  );
  for (let k = 0; k < 12; k += 1) {
    const angle = (k * TAU) / 12;
    const at = basisFromZ(tangent(angle), undefined, radial(angle).multiplyScalar(REACTOR_RADIUS));
    parts.add(materials.foil, ring(minor + 0.25, 0.32, 8, 32), at, index);
    parts.add(materials.accent, ring(minor + 0.6, 0.06, 6, 32), at, index);
  }
  for (let k = 0; k < 6; k += 1) {
    const angle = (k * TAU) / 6 + 0.26;
    const outer = radial(angle).multiplyScalar(REACTOR_RADIUS - minor);
    const inner = radial(angle).multiplyScalar(heartRadius);
    parts.add(
      materials.dark,
      cylinder(0.16, 0.16, outer.distanceTo(inner), 6),
      basisFromY(outer.clone().sub(inner), outer.clone().add(inner).multiplyScalar(0.5)),
      index,
    );
  }
  const surface = (along: number, around: number): HullPoint => {
    const out = radial(along * TAU);
    const normal = out
      .clone()
      .multiplyScalar(Math.cos(around))
      .add(v3(0, Math.sin(around), 0));
    return { point: out.multiplyScalar(REACTOR_RADIUS).addScaledVector(normal, minor), normal };
  };
  greebles(builder, 40, (u) => surface(u, between(random, 0.6, 2.2)));
  return {
    body: {
      index,
      zone,
      shape: ZONE_SHAPE.REACTOR,
      center: v3(0, 0.01, 0),
      size: REACTOR_RADIUS * 2.4,
      hullRadius: minor,
      accent: new Color(LAYER_ACCENT[zone.layer]),
      surface,
      site: (k, n) => {
        const { point, normal } = surface((0.52 + (k * TAU) / Math.max(n, 3)) / TAU, 1.2);
        return {
          point,
          direction: normal
            .clone()
            .add(v3(0, 0.6, 0))
            .normalize(),
        };
      },
      spots: spotsOf(random, (u) => surface(u, between(random, -1.4, 1.4))),
      port: (toward) =>
        radial(Math.atan2(toward.z, toward.x))
          .multiplyScalar(REACTOR_RADIUS)
          .add(v3(0, minor * 0.8, 0)),
      turning: false,
      project: ontoRing(REACTOR_RADIUS, minor),
    },
    proxy: torusPatch(REACTOR_RADIUS, minor + 0.25, [0, TAU], [-Math.PI, Math.PI], [64, 12]),
    shell: torusPatch(REACTOR_RADIUS, minor * 1.3 + 0.4, [0, TAU], [-Math.PI, Math.PI], [64, 12]),
  };
}

/** The reactor's plasma, waves running round it. */
function plasmaMaterial(builder: Builder): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: { uTime: builder.uniforms.uTime },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float a = vUv.x * 6.0 / 8.6;
  float wave = 0.5 + 0.5 * sin(a * 12.0 - uTime * 3.0) * sin(a * 5.0 + uTime * 1.3);
  vec3 color = mix(vec3(0.55, 0.75, 1.0), vec3(0.9, 0.96, 1.0), wave) * (1.1 + 1.8 * wave);
  gl_FragColor = vec4(color, 1.0);
  ${SHADER_OUTPUT}
}`,
  });
  builder.owned.push(material);
  return material;
}

/** The gimbal: a ring standing about the heart, turning. */
function buildGimbal(builder: Builder, zone: ZoneView, heartRadius: number, gimbal: Group): Built {
  const { random, index, materials } = builder;
  const radius = heartRadius + 1.25;
  const minor = 0.28 + 0.5 * zone.footprint;
  // Note that the gimbal turns, so its parts merge apart from the still station, under the group that turns.
  const parts = new Parts();
  parts.add(materials.dark, ring(radius, minor, 10, 96), undefined, index);
  parts.add(materials.accent, ring(radius, minor + 0.04, 6, 96).scale(1, 1, 0.3), undefined, index);
  for (let k = 0; k < 8; k += 1) {
    parts.add(
      materials.foil,
      box(0.7, 0.7, 0.9),
      translation(Math.cos((k * TAU) / 8) * radius, Math.sin((k * TAU) / 8) * radius, 0),
      index,
    );
  }
  parts.build(gimbal);
  const surface = (along: number): HullPoint => {
    const angle = along * TAU;
    const normal = v3(Math.cos(angle), Math.sin(angle), 0);
    return { point: normal.clone().multiplyScalar(radius + minor), normal };
  };
  return {
    body: {
      index,
      zone,
      shape: ZONE_SHAPE.GIMBAL,
      center: v3(0, radius, 0),
      size: radius * 2,
      hullRadius: minor,
      accent: new Color(LAYER_ACCENT[zone.layer]),
      surface,
      site: () => ({ point: v3(0, radius + minor, 0), direction: v3(0.4, 1, 0.3).normalize() }),
      // Note that its lights sit near its crown, which turns least out of place.
      spots: spotsOf(random, (u) => surface(0.18 + u * 0.14)),
      port: () => v3(0, radius + minor, 0),
      turning: true,
      project: inPlace,
    },
    proxy: new TorusGeometry(radius, minor + 0.3, 8, 48),
    shell: new TorusGeometry(radius, minor + 0.9, 8, 64),
  };
}

/** A drum on the spine, centred at `y`. */
function buildDrum(
  builder: Builder,
  zone: ZoneView,
  y: number,
  radius: number,
  height: number,
): Built {
  const { parts, random, index, materials } = builder;
  const at = translation(0, y, 0);
  parts.add(materials.hull, cylinder(radius, radius, height, 32), at, index);
  parts.add(
    materials.window,
    cylinder(radius + 0.02, radius + 0.02, height * 0.36, 32, true),
    at,
    index,
  );
  for (const side of [-1, 1]) {
    parts.add(
      materials.dark,
      ring(radius + 0.1, 0.16, 8, 40),
      translation(0, y + (side * height) / 2, 0).multiply(new Matrix4().makeRotationX(Math.PI / 2)),
      index,
    );
    parts.add(
      materials.accent,
      ring(radius + 0.22, 0.05, 6, 40),
      translation(0, y + side * (height / 2 - 0.3), 0).multiply(
        new Matrix4().makeRotationX(Math.PI / 2),
      ),
      index,
    );
  }
  for (let k = 0; k < 4; k += 1) {
    const angle = (k * TAU) / 4 + 0.4;
    parts.add(
      materials.radiator,
      box(2.2, height * 0.8, 0.06),
      basisFromZ(
        tangent(angle),
        undefined,
        radial(angle)
          .multiplyScalar(radius + 1.2)
          .add(v3(0, y, 0)),
      ),
      index,
    );
  }
  const surface = (along: number, rise: number): HullPoint => {
    const normal = radial(along * TAU);
    return {
      point: normal
        .clone()
        .multiplyScalar(radius)
        .add(v3(0, y + clamp(rise, -1, 1) * height * 0.45, 0)),
      normal,
    };
  };
  return {
    body: {
      index,
      zone,
      shape: ZONE_SHAPE.DRUM,
      center: v3(0, y, 0),
      size: radius * 3,
      hullRadius: Math.min(radius, height / 2),
      accent: new Color(LAYER_ACCENT[zone.layer]),
      surface,
      site: (k, n) => {
        const angle = 0.26 + (k * TAU) / Math.max(n, 2);
        return {
          point: radial(angle)
            .multiplyScalar(radius)
            .add(v3(0, y, 0)),
          direction: radial(angle)
            .add(v3(0, y > 0 ? 0.5 : -0.5, 0))
            .normalize(),
        };
      },
      spots: spotsOf(random, (u) => surface(u, between(random, -1, 1))),
      port: () => v3(0, y, 0),
      turning: false,
      project: (point, lift) => {
        const centre = v3(0, point.y, 0);
        return point
          .sub(centre)
          .normalize()
          .multiplyScalar(radius + lift)
          .add(centre);
      },
    },
    proxy: new CylinderGeometry(radius + 0.2, radius + 0.2, height + 0.4, 24).translate(0, y, 0),
    shell: new CylinderGeometry(
      radius * 1.35 + 0.3,
      radius * 1.35 + 0.3,
      height + 1.2,
      24,
    ).translate(0, y, 0),
  };
}

/** Four posts braced every 1.4 units: a mast's open truss, from `from` up `height`. */
function trussColumn(builder: Builder, from: number, height: number): void {
  const { parts, index, materials } = builder;
  const half = 0.7;
  for (const [x, z] of [
    [half, half],
    [-half, half],
    [half, -half],
    [-half, -half],
  ] as const) {
    parts.add(
      materials.dark,
      cylinder(0.07, 0.07, height, 5),
      translation(x, from + height / 2, z),
      index,
    );
  }
  for (let y = from + 0.7; y < from + height; y += 1.4) {
    for (const z of [half, -half])
      parts.add(materials.dark, box(2 * half, 0.06, 0.06), translation(0, y, z), index);
    for (const x of [half, -half])
      parts.add(materials.dark, box(0.06, 0.06, 2 * half), translation(x, y, 0), index);
  }
}

/** A mast on the spine: up, a comms mast with dishes and arrays; down, fins, and engines where it is the last. */
function buildMast(
  builder: Builder,
  zone: ZoneView,
  from: number,
  height: number,
  up: boolean,
  last: boolean,
): Built {
  const { parts, random, index, materials } = builder;
  const bottom = up ? from : from - height;
  trussColumn(builder, bottom, height);
  const middle = bottom + height / 2;
  if (up) {
    for (let k = 0; k < 3; k += 1) {
      const y = bottom + height * (0.35 + 0.25 * k);
      const angle = k * 2.1;
      parts.add(
        materials.white,
        new LatheGeometry(dishProfile(1.4, 0.4 / 1.4, 10), 24),
        basisFromY(
          radial(angle).add(v3(0, 0.5, 0)),
          radial(angle)
            .multiplyScalar(1.6)
            .add(v3(0, y, 0)),
        ),
        index,
      );
    }
    for (const side of [-1, 1]) {
      const y = bottom + height * 0.82;
      parts.add(
        materials.dark,
        cylinder(0.1, 0.1, 10, 6),
        translation(0, y, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2)),
        index,
      );
      parts.add(materials.solar, box(8, 0.06, 3.2), translation(side * 6.2, y, 0), index);
    }
    if (last)
      parts.add(
        materials.accent,
        sphere(0.35, 12, 8),
        translation(0, bottom + height + 0.6, 0),
        index,
      );
  } else {
    for (let k = 0; k < 4; k += 1) {
      const angle = (k * TAU) / 4 + Math.PI / 4;
      parts.add(
        materials.radiator,
        box(4.2, height * 0.6, 0.07),
        basisFromZ(
          tangent(angle),
          undefined,
          radial(angle)
            .multiplyScalar(2.9)
            .add(v3(0, from - height * 0.45, 0)),
        ),
        index,
      );
    }
    if (last) {
      const bell = [
        new Vector2(0.3, 0),
        new Vector2(0.55, -0.6),
        new Vector2(0.95, -1.6),
        new Vector2(1, -1.7),
      ];
      for (let k = 0; k < 3; k += 1) {
        const at = radial((k * TAU) / 3)
          .multiplyScalar(1.3)
          .add(v3(0, bottom - 1.1, 0));
        parts.add(
          materials.dark,
          new LatheGeometry(bell, 24),
          translation(at.x, at.y, at.z),
          index,
        );
      }
      parts.add(
        materials.foil,
        cylinder(2.2, 2.2, 1.2, 24),
        translation(0, bottom - 0.2, 0),
        index,
      );
    }
  }
  const surface = (along: number, rise: number): HullPoint => {
    const normal = radial(along * TAU);
    return {
      point: normal
        .clone()
        .multiplyScalar(0.9)
        .add(v3(0, middle + clamp(rise, -1, 1) * height * 0.45, 0)),
      normal,
    };
  };
  return {
    body: {
      index,
      zone,
      shape: ZONE_SHAPE.MAST,
      center: v3(0, middle, 0),
      size: height,
      hullRadius: 0.9,
      accent: new Color(LAYER_ACCENT[zone.layer]),
      surface,
      site: (k, n) => {
        const angle = (k * TAU) / Math.max(n, 2) + 1;
        return {
          point: radial(angle)
            .multiplyScalar(0.9)
            .add(v3(0, middle, 0)),
          direction: radial(angle)
            .add(v3(0, up ? 0.6 : -0.6, 0))
            .normalize(),
        };
      },
      spots: spotsOf(random, (u) => surface(u, between(random, -1, 1))),
      port: () => v3(0, middle, 0),
      turning: false,
      project: inPlace,
    },
    proxy: new CylinderGeometry(1.2, 1.2, height, 12).translate(0, middle, 0),
    shell: new CylinderGeometry(3, 3, height + 1, 16).translate(0, middle, 0),
  };
}

/** A corridor along a spoke at `angle`, from `from` out to `to`, with its rails and its accent line. */
function corridor(builder: Builder, angle: number, from: number, to: number, radius: number): void {
  const { parts, index, materials } = builder;
  if (to - from < 0.2) return;
  const out = radial(angle);
  const middle = out.clone().multiplyScalar((from + to) / 2);
  parts.add(
    materials.hull,
    cylinder(radius, radius, to - from, 14, true),
    basisFromY(out, middle),
    index,
  );
  for (const side of [-1, 1]) {
    parts.add(
      materials.dark,
      box(0.14, 0.14, to - from),
      basisFromZ(out, undefined, middle.clone().add(v3(0, side * (radius + 0.35), 0))),
      index,
    );
  }
  for (let x = from + 1.2; x < to - 0.6; x += 2.2) {
    parts.add(
      materials.dark,
      ring(radius + 0.05, 0.07, 5, 18),
      basisFromZ(out, undefined, out.clone().multiplyScalar(x)),
      index,
    );
  }
  parts.add(
    materials.accent,
    box(0.05, 0.05, to - from),
    basisFromZ(out, undefined, middle.clone().addScaledVector(tangent(angle), radius + 0.02)),
    index,
  );
}

/** A domain module on the spoke at `angle`, from `from` out `length`, with radiators or an array as `alternate` says. */
function buildModule(
  builder: Builder,
  zone: ZoneView,
  angle: number,
  from: number,
  length: number,
  radius: number,
  alternate: boolean,
): Built {
  const { parts, random, index, materials } = builder;
  const out = radial(angle);
  const side = tangent(angle);
  const to = from + length;
  const middle = (from + to) / 2;
  const center = out.clone().multiplyScalar(middle);
  const axis = basisFromY(out, center);
  parts.add(materials.hull, cylinder(radius, radius, length, 28, true), axis, index);
  parts.add(
    materials.window,
    cylinder(radius + 0.02, radius + 0.02, length - 0.6, 28, true, Math.PI / 2 - 0.45, 0.9),
    axis,
    index,
  );
  parts.add(
    materials.window,
    cylinder(radius + 0.02, radius + 0.02, length - 0.6, 28, true, (3 * Math.PI) / 2 - 0.45, 0.9),
    axis,
    index,
  );
  for (const [end, material] of [
    [from, materials.hull],
    [to, materials.foil],
  ] as const) {
    const cap = basisFromY(
      end === from ? out.clone().negate() : out,
      out.clone().multiplyScalar(end),
    );
    parts.add(
      material,
      sphere(radius, 28, 10, [0, TAU], [0, Math.PI / 2]),
      cap.multiply(new Matrix4().makeScale(1, 0.45, 1)),
      index,
    );
    parts.add(
      materials.dark,
      ring(radius + 0.12, 0.2, 8, 36),
      basisFromZ(out, undefined, out.clone().multiplyScalar(end)),
      index,
    );
    parts.add(
      materials.accent,
      ring(radius + 0.25, 0.06, 6, 36),
      basisFromZ(out, undefined, out.clone().multiplyScalar(end + (end === from ? 0.45 : -0.45))),
      index,
    );
  }
  const ribs = Math.floor(length / 2.4);
  for (let k = 1; k < ribs; k += 1) {
    parts.add(
      materials.dark,
      ring(radius + 0.04, 0.09, 6, 32),
      basisFromZ(out, undefined, out.clone().multiplyScalar(from + (length * k) / ribs)),
      index,
    );
  }
  if (alternate) {
    for (const up of [1, -1]) {
      const at = center.clone().add(v3(0, up * (radius + 2.2), 0));
      parts.add(
        materials.radiator,
        box(0.07, 3.6, length * 0.55),
        basisFromZ(out, undefined, at),
        index,
      );
      parts.add(
        materials.dark,
        cylinder(0.09, 0.09, 4.6, 5),
        translation(at.x, at.y - up * 0.5, at.z),
        index,
      );
    }
  } else {
    const at = out
      .clone()
      .multiplyScalar(to - 1.2)
      .add(v3(0, radius + 0.6, 0));
    parts.add(materials.dark, cylinder(0.08, 0.08, 1.4, 5), translation(at.x, at.y, at.z), index);
    for (const across of [-1, 1]) {
      parts.add(
        materials.solar,
        box(4.2, 0.05, 1.6),
        basisFromZ(
          out,
          undefined,
          at
            .clone()
            .add(v3(0, 0.7, 0))
            .addScaledVector(side, across * 2.4),
        ),
        index,
      );
    }
  }
  const surface = (along: number, around: number): HullPoint => {
    const normal = side
      .clone()
      .multiplyScalar(Math.cos(around))
      .add(v3(0, Math.sin(around), 0));
    return {
      point: out
        .clone()
        .multiplyScalar(from + length * (0.08 + 0.84 * clamp(along, 0, 1)))
        .addScaledVector(normal, radius),
      normal,
    };
  };
  greebles(builder, Math.ceil(length * 1.2), (u) => surface(u, between(random, 0.7, 2.4)));
  return {
    body: {
      index,
      zone,
      shape: ZONE_SHAPE.MODULE,
      center,
      size: length * 0.8 + radius,
      hullRadius: radius,
      accent: new Color(LAYER_ACCENT[zone.layer]),
      surface,
      site: (k, n) => {
        const up = k % 2 === 0 ? 1 : -1;
        const { point } = surface((k + 0.5) / n, (up * Math.PI) / 2);
        return {
          point,
          direction: v3(0, up, 0)
            .addScaledVector(side, k % 4 < 2 ? 0.35 : -0.35)
            .normalize(),
        };
      },
      spots: spotsOf(random, (u) => surface(u, between(random, -Math.PI, Math.PI))),
      port: () => center.clone(),
      turning: false,
      project: (point, lift) => {
        const centre = out.clone().multiplyScalar(point.dot(out));
        return point
          .sub(centre)
          .normalize()
          .multiplyScalar(radius + lift)
          .add(centre);
      },
    },
    proxy: new CylinderGeometry(radius + 0.2, radius + 0.2, length + 0.6, 16).applyMatrix4(axis),
    shell: new CylinderGeometry(
      radius * 1.35 + 0.4,
      radius * 1.35 + 0.4,
      length + 1.6,
      24,
    ).applyMatrix4(axis),
  };
}

/** A segment's dressing, by its `dress`. */
function dressSegment(
  builder: Builder,
  zone: ZoneView,
  dress: SegmentDress,
  arc: readonly [number, number],
  minor: number,
): void {
  const { parts, index, materials } = builder;
  const [t0, t1] = arc;
  const length = (t1 - t0) * RING_RADIUS;
  const middle = (t0 + t1) / 2;
  const at = (angle: number, around: number, lift = 0) => {
    const out = radial(angle);
    const normal = out
      .clone()
      .multiplyScalar(Math.cos(around))
      .add(v3(0, Math.sin(around), 0));
    return {
      point: out
        .clone()
        .multiplyScalar(RING_RADIUS)
        .addScaledVector(normal, minor + lift),
      normal,
      out,
    };
  };
  switch (dress) {
    case SEGMENT_DRESS.DOMES:
    case SEGMENT_DRESS.DOME: {
      const count = dress === SEGMENT_DRESS.DOME ? 1 : Math.max(1, Math.round(length / 8));
      for (let k = 0; k < count; k += 1) {
        const angle = t0 + ((t1 - t0) * (k + 0.5)) / count;
        const radius = clamp(minor * 0.75, 1.2, Math.min(2.4, length / 2.4));
        const { point, normal } = at(angle, 1.25, -0.25);
        const base = basisFromY(normal, point);
        const lifted = base.clone().multiply(translation(0, 0.2, 0));
        parts.add(materials.dark, cylinder(radius + 0.25, radius + 0.4, 0.5, 32), base, index);
        parts.add(
          materials.window,
          sphere(radius * 0.96, 32, 12, [0, TAU], [0, Math.PI / 2]),
          lifted,
          index,
        );
        parts.add(
          materials.glass,
          sphere(radius, 32, 12, [0, TAU], [0, Math.PI / 2]),
          lifted,
          index,
        );
        for (let rib = 0; rib < 6; rib += 1) {
          parts.add(
            materials.dark,
            new TorusGeometry(radius + 0.02, 0.04, 4, 24, Math.PI),
            lifted.clone().multiply(new Matrix4().makeRotationY((rib * Math.PI) / 6)),
            index,
          );
        }
      }
      return;
    }
    case SEGMENT_DRESS.HAB: {
      for (const around of [1, -1]) {
        parts.add(
          materials.window,
          torusPatch(
            RING_RADIUS,
            minor + 0.03,
            [t0 + 0.01, t1 - 0.01],
            [around - 0.18, around + 0.18],
            [Math.max(2, Math.ceil(length)), 3],
          ),
          undefined,
          index,
        );
      }
      const count = Math.round(length / 7);
      for (let k = 0; k < count; k += 1) {
        const { point, normal } = at(t0 + ((t1 - t0) * (k + 0.5)) / count, Math.PI / 2, -0.1);
        parts.add(materials.hull, box(2.2, 1, 2.6), basisFromY(normal, point), index);
        parts.add(
          materials.window,
          box(2.24, 0.4, 2.64),
          basisFromY(normal, point.clone().addScaledVector(normal, 0.25)),
          index,
        );
      }
      return;
    }
    case SEGMENT_DRESS.DISH: {
      const { point, normal, out } = at(middle, 0.35);
      const radius = 3.2 + 4 * zone.footprint;
      parts.add(
        materials.dark,
        cylinder(0.35, 0.5, 3.2, 12),
        basisFromY(normal, point).multiply(translation(0, 1.6, 0)),
        index,
      );
      const facing = out
        .clone()
        .multiplyScalar(0.7)
        .add(v3(0, 0.75, 0))
        .normalize();
      const dish = basisFromY(facing, point.clone().addScaledVector(normal, 3.4));
      parts.add(
        materials.white,
        new LatheGeometry(dishProfile(radius, 1 / (4 * radius * 0.45), 16), 48),
        dish,
        index,
      );
      parts.add(
        materials.dark,
        ring(radius, 0.12, 6, 48),
        dish
          .clone()
          .multiply(translation(0, radius / 1.8, 0))
          .multiply(new Matrix4().makeRotationX(Math.PI / 2)),
        index,
      );
      const tip = v3(0, radius * 1.05, 0);
      for (let k = 0; k < 3; k += 1) {
        const angle = (k * TAU) / 3;
        const foot = v3(
          Math.cos(angle) * radius * 0.8,
          radius * 0.33,
          Math.sin(angle) * radius * 0.8,
        );
        parts.add(
          materials.dark,
          cylinder(0.05, 0.05, foot.distanceTo(tip), 5),
          dish
            .clone()
            .multiply(basisFromY(tip.clone().sub(foot), foot.clone().add(tip).multiplyScalar(0.5))),
          index,
        );
      }
      parts.add(
        materials.foil,
        cylinder(0.35, 0.2, 0.9, 12),
        dish.clone().multiply(translation(0, radius * 1.05, 0)),
        index,
      );
      return;
    }
    case SEGMENT_DRESS.SOLAR: {
      const count = Math.max(2, Math.round(length / 9));
      for (let k = 0; k < count; k += 1) {
        const angle = t0 + ((t1 - t0) * (k + 0.5)) / count;
        for (const up of [1, -1]) {
          const { point } = at(angle, (up * Math.PI) / 2);
          const span = 9 + 6 * zone.footprint;
          const width = 3.4;
          parts.add(
            materials.dark,
            cylinder(0.12, 0.12, span + 1.5, 6),
            translation(point.x, point.y + up * (span / 2 + 0.75), point.z),
            index,
          );
          for (const across of [-1, 1]) {
            const center = point
              .clone()
              .add(v3(0, up * (span / 2 + 1.2), 0))
              .addScaledVector(tangent(angle), across * (width / 2 + 0.25));
            const panel = basisFromZ(radial(angle), undefined, center);
            parts.add(materials.solar, box(width, span, 0.06), panel, index);
            parts.add(
              materials.dark,
              box(width + 0.1, 0.12, 0.12),
              panel.clone().multiply(translation(0, span / 2, 0)),
              index,
            );
          }
        }
      }
      return;
    }
    case SEGMENT_DRESS.DOCK: {
      const { point, out } = at(middle, 0, -0.3);
      const width = 2.6 + 5 * zone.footprint;
      const depth = 3.5;
      const dock = basisFromZ(out, undefined, point.clone().addScaledVector(out, depth / 2));
      parts.add(materials.hull, box(width, width * 0.7, depth), dock, index);
      parts.add(
        materials.accent,
        box(width * 0.8, width * 0.5, 0.05),
        dock.clone().multiply(translation(0, 0, depth / 2 + 0.01)),
        index,
      );
      for (const up of [1, -1]) {
        parts.add(
          materials.dark,
          box(width + 0.3, 0.2, depth + 0.2),
          dock.clone().multiply(translation(0, up * width * 0.35, 0)),
          index,
        );
      }
      const shuttle = dock.clone().multiply(translation(0, width * 0.35 + 0.9, 0.3));
      parts.add(
        materials.white,
        new CapsuleGeometry(0.55, 2.2, 6, 14),
        shuttle.clone().multiply(new Matrix4().makeRotationX(Math.PI / 2)),
        index,
      );
      parts.add(
        materials.dark,
        box(3, 0.08, 1),
        shuttle.clone().multiply(translation(0, -0.2, -0.6)),
        index,
      );
      parts.add(
        materials.window,
        box(0.8, 0.25, 0.4),
        shuttle.clone().multiply(translation(0, 0.3, 1.2)),
        index,
      );
      return;
    }
    case SEGMENT_DRESS.BEACON: {
      const { point } = at(middle, Math.PI / 2);
      parts.add(
        materials.dark,
        cylinder(0.15, 0.3, 4, 8),
        translation(point.x, point.y + 2, point.z),
        index,
      );
      parts.add(
        materials.accent,
        sphere(0.45, 16, 12),
        translation(point.x, point.y + 4.3, point.z),
        index,
      );
      return;
    }
    case SEGMENT_DRESS.RADIATOR: {
      const count = Math.max(2, Math.round(length / 6));
      for (let k = 0; k < count; k += 1) {
        const angle = t0 + ((t1 - t0) * (k + 0.5)) / count;
        for (const up of [1, -1]) {
          const { point } = at(angle, (up * Math.PI) / 2);
          const fin = basisFromZ(tangent(angle), undefined, point.clone().add(v3(0, up * 3.4, 0)));
          parts.add(materials.radiator, box(0.08, 6, 3.2), fin, index);
          parts.add(materials.dark, cylinder(0.1, 0.1, 6.4, 5), fin, index);
        }
      }
      return;
    }
    case SEGMENT_DRESS.ANTENNA: {
      for (let k = 0; k < 4; k += 1) {
        const { point, normal } = at(t0 + (t1 - t0) * (0.15 + (0.7 * k) / 3), 0.6 + 0.4 * (k % 2));
        const length = 2.5 + (k % 2) * 2.5;
        parts.add(
          materials.dark,
          cylinder(0.06, 0.1, length, 6),
          basisFromY(normal, point.clone().addScaledVector(normal, length / 2)),
          index,
        );
        const dish = basisFromY(
          normal
            .clone()
            .add(v3(0, 0.6, 0))
            .normalize(),
          point.clone().addScaledVector(normal, length),
        );
        parts.add(materials.white, new LatheGeometry(dishProfile(0.9, 0.5, 8), 20), dish, index);
      }
      return;
    }
  }
}

/** A segment of the outer ring, from angle `t0` to `t1`, its tube as thick as its footprint. */
function buildSegment(builder: Builder, zone: ZoneView, arc: readonly [number, number]): Built {
  const { parts, random, index, materials } = builder;
  const [t0, t1] = arc;
  const minor = 1.5 + 1.7 * zone.footprint;
  const length = (t1 - t0) * RING_RADIUS;
  const middle = (t0 + t1) / 2;
  const steps = Math.max(6, Math.ceil(length / 0.9));
  parts.add(
    materials.hull,
    torusPatch(RING_RADIUS, minor, arc, [-Math.PI, Math.PI], [steps, 22]),
    undefined,
    index,
  );
  const inset: readonly [number, number] = [t0 + 0.004, t1 - 0.004];
  parts.add(
    materials.window,
    torusPatch(RING_RADIUS, minor + 0.02, inset, [-0.42, 0.42], [steps, 6]),
    undefined,
    index,
  );
  parts.add(
    materials.window,
    torusPatch(RING_RADIUS, minor + 0.02, inset, [Math.PI - 0.3, Math.PI + 0.3], [steps, 6]),
    undefined,
    index,
  );
  for (const end of [t0, t1]) {
    const collar = basisFromZ(tangent(end), undefined, radial(end).multiplyScalar(RING_RADIUS));
    parts.add(materials.dark, ring(minor + 0.18, 0.26, 10, 40), collar, index);
    parts.add(
      materials.accent,
      ring(minor + 0.3, 0.07, 6, 40),
      collar.clone().multiply(translation(0, 0, end === t0 ? 0.35 : -0.35)),
      index,
    );
    parts.add(
      materials.dark,
      new CircleGeometry(minor, 24),
      collar.clone().multiply(new Matrix4().makeRotationY(end === t0 ? Math.PI : 0)),
      index,
    );
  }
  const ribs = Math.floor(length / 3.2);
  for (let k = 1; k < ribs; k += 1) {
    const angle = t0 + ((t1 - t0) * k) / ribs;
    parts.add(
      materials.dark,
      ring(minor + 0.05, 0.1, 6, 36),
      basisFromZ(tangent(angle), undefined, radial(angle).multiplyScalar(RING_RADIUS)),
      index,
    );
  }
  const surface = (along: number, around: number): HullPoint => {
    const out = radial(t0 + (t1 - t0) * (0.06 + 0.88 * clamp(along, 0, 1)));
    const normal = out
      .clone()
      .multiplyScalar(Math.cos(around))
      .add(v3(0, Math.sin(around), 0));
    return { point: out.multiplyScalar(RING_RADIUS).addScaledVector(normal, minor), normal };
  };
  greebles(builder, Math.ceil(length * 0.7), (u) => surface(u, between(random, 0.7, 2.3)));
  greebles(builder, Math.ceil(length * 0.3), (u) => surface(u, between(random, -2.3, -0.7)));
  const dress = DRESS_CHOICES[hashOf(zone.path) % DRESS_CHOICES.length] ?? SEGMENT_DRESS.DOMES;
  dressSegment(builder, zone, dress, arc, minor);
  return {
    body: {
      index,
      zone,
      shape: ZONE_SHAPE.SEGMENT,
      center: radial(middle).multiplyScalar(RING_RADIUS),
      size: Math.max(length * 0.5, minor * 2.5),
      hullRadius: minor,
      accent: new Color(LAYER_ACCENT[zone.layer]),
      surface,
      site: (k, n) => {
        const angle = t0 + ((t1 - t0) * (k + 0.5)) / n;
        const out = radial(angle);
        const face = k % 3;
        const direction =
          face === 0
            ? out.clone()
            : v3(0, face === 1 ? 1 : -1, 0)
                .addScaledVector(out, 0.45)
                .normalize();
        const normal = face === 0 ? out : v3(0, face === 1 ? 1 : -1, 0);
        return {
          point: out
            .clone()
            .multiplyScalar(RING_RADIUS)
            .addScaledVector(normal, minor + 0.1),
          direction,
        };
      },
      spots: spotsOf(random, (u) => surface(u, between(random, -1.3, 1.3))),
      port: () => radial(middle).multiplyScalar(RING_RADIUS),
      turning: false,
      project: ontoRing(RING_RADIUS, minor),
    },
    proxy: torusPatch(
      RING_RADIUS,
      minor + 0.25,
      arc,
      [-Math.PI, Math.PI],
      [Math.max(4, Math.ceil(length / 2)), 10],
    ),
    shell: torusPatch(RING_RADIUS, minor * 1.28 + 0.5, arc, [-Math.PI, Math.PI], [steps, 14]),
  };
}

/** The core zones in the order they take the heart's places: the most depended on first. */
function heartOrder(zones: readonly ZoneView[]): ZoneView[] {
  return [...zones].sort(
    (left, right) =>
      right.transitiveDependents - left.transitiveDependents ||
      right.footprint - left.footprint ||
      (left.path < right.path ? -1 : 1),
  );
}

/** The outer ring's arcs: each surface zone's centred at its own angle, as long as its footprint, overlaps pushed apart. */
function segmentArcs(zones: readonly ZoneView[]): { zone: ZoneView; arc: [number, number] }[] {
  const widths = zones.map((zone) => (4 + 30 * zone.footprint) / RING_RADIUS);
  const { centres, fit } = spreadOnCircle(
    zones.map((zone, index) => ({ angle: angleOf(zone), width: widths[index] ?? 0 })),
    SEGMENT_GAP,
  );
  return zones
    .map((zone, index) => {
      const centre = centres[index] ?? angleOf(zone);
      const half = ((widths[index] ?? 0) * fit) / 2;
      const arc: [number, number] = [centre - half, centre + half];
      return { zone, arc };
    })
    .sort((left, right) => left.arc[0] - right.arc[0]);
}

/** The domain's spokes: one per zone, at its own angle, overlaps pushed apart; crowded, every module is narrowed alike. */
function spokesOf(
  zones: readonly ZoneView[],
): { angle: number; zone: ZoneView; narrowing: number }[] {
  const { centres, fit } = spreadOnCircle(
    zones.map((zone) => ({
      angle: angleOf(zone),
      width: (2 * (1.05 + 1.35 * zone.footprint) + 1) / MODULE_START,
    })),
    0.02,
  );
  return zones.map((zone, index) => ({
    angle: centres[index] ?? angleOf(zone),
    zone,
    narrowing: fit,
  }));
}

/** The outer ring's tube radius at `angle`: a segment's, or the bare frame's between them. */
function ringTubeAt(
  arcs: readonly { zone: ZoneView; arc: [number, number] }[],
  angle: number,
): number {
  for (const { zone, arc } of arcs) {
    const offset = (((angle - arc[0]) % TAU) + TAU) % TAU;
    if (offset <= arc[1] - arc[0]) return 1.5 + 1.7 * zone.footprint;
  }
  return FRAME_TUBE;
}

/** The bare frame of the outer ring from `from` to `to`, where no surface zone stands: a thinner tube, ribbed. */
function frameArc(parts: Parts, materials: StationMaterials, from: number, to: number): void {
  const length = (to - from) * RING_RADIUS;
  parts.add(
    materials.hull,
    torusPatch(
      RING_RADIUS,
      FRAME_TUBE,
      [from, to],
      [-Math.PI, Math.PI],
      [Math.max(3, Math.ceil(length / 1.2)), 14],
    ),
  );
  const ribs = Math.max(1, Math.floor(length / 3));
  for (let k = 0; k <= ribs; k += 1) {
    const angle = from + ((to - from) * k) / ribs;
    parts.add(
      materials.dark,
      ring(FRAME_TUBE + 0.08, 0.1, 6, 28),
      basisFromZ(tangent(angle), undefined, radial(angle).multiplyScalar(RING_RADIUS)),
    );
  }
}

/** The conduits between zones, one tube each from the zone depended on to the one depending on it, merged. */
function conduitsOf(
  edges: readonly ZoneEdge[],
  bodies: ReadonlyMap<string, ZoneBody>,
): BufferGeometry | undefined {
  const tubes: BufferGeometry[] = [];
  let flip = 0;
  for (const edge of edges) {
    const dependent = bodies.get(edge.from);
    const dependency = bodies.get(edge.to);
    if (dependent === undefined || dependency === undefined || dependent === dependency) continue;
    const start = dependency.port(dependent.center);
    const end = dependent.port(dependency.center);
    const distance = start.distanceTo(end);
    if (distance < 0.5) continue;
    flip += 1;
    const lift = (flip % 2 === 1 ? 1 : -1) * (2 + distance * 0.18);
    const curve = new CatmullRomCurve3(
      [
        start,
        start
          .clone()
          .lerp(end, 0.3)
          .add(v3(0, lift, 0)),
        start
          .clone()
          .lerp(end, 0.7)
          .add(v3(0, lift, 0)),
        end,
      ],
      false,
      "centripetal",
    );
    const length = curve.getLength();
    const tube = clean(
      new TubeGeometry(curve, Math.max(4, Math.ceil(length / 1.6)), 0.11, 5, false),
    );
    const count = tube.getAttribute("position").count;
    tube.setAttribute(
      "aFrom",
      new Float32BufferAttribute(new Float32Array(count).fill(dependent.index), 1),
    );
    tube.setAttribute(
      "aTo",
      new Float32BufferAttribute(new Float32Array(count).fill(dependency.index), 1),
    );
    tube.setAttribute(
      "aLength",
      new Float32BufferAttribute(new Float32Array(count).fill(length), 1),
    );
    tubes.push(tube);
  }
  return tubes.length === 0 ? undefined : merged(tubes);
}

/** Whether two views would build the same station: the same zones, in the same layers, rings, places and sizes. */
export function sameStation(left: readonly ZoneView[], right: readonly ZoneView[]): boolean {
  return (
    left.length === right.length &&
    left.every((zone, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        zone.path === other.path &&
        zone.layer === other.layer &&
        zone.transitiveDependents === other.transitiveDependents &&
        zone.footprint === other.footprint &&
        zone.x === other.x &&
        zone.y === other.y
      );
    })
  );
}

/** Builds the station for `zones`, the first `MAX_ZONES` of a view, joined by `edges`. */
export function buildStation(
  zones: readonly ZoneView[],
  edges: readonly ZoneEdge[],
  materials: StationMaterials,
  uniforms: StationUniforms,
): Station {
  const root = new Group();
  const gimbal = new Group();
  const plasma = new Group();
  root.add(gimbal, plasma);
  const parts = new Parts();
  const bodies = new Map<string, ZoneBody>();
  const proxies = new Map<string, Mesh>();
  const shells: BufferGeometry[] = [];
  const proxyMaterial = new MeshBasicMaterial({ visible: false });
  const owned: ShaderMaterial[] = [];
  const indexOf = new Map(zones.map((zone, index) => [zone.path, index]));
  const builderOf = (zone: ZoneView): Builder => ({
    parts,
    random: seeded(hashOf(zone.path)),
    index: indexOf.get(zone.path) ?? NO_ZONE,
    materials,
    uniforms,
    owned,
  });
  const keep = ({ body, proxy, shell }: Built, parent: Group = root) => {
    bodies.set(body.zone.path, body);
    const mesh = new Mesh(proxy, proxyMaterial);
    mesh.userData.zone = body.zone.path;
    parent.add(mesh);
    proxies.set(body.zone.path, mesh);
    const glow = clean(shell);
    glow.setAttribute(
      "aZone",
      new Float32BufferAttribute(
        new Float32Array(glow.getAttribute("position").count).fill(body.index),
        1,
      ),
    );
    if (parent === root) shells.push(glow);
    else {
      const turning = new Mesh(glow, materials.glow);
      turning.renderOrder = 5;
      parent.add(turning);
    }
  };
  const byLayer = (layer: ZoneView["layer"]) => zones.filter((zone) => zone.layer === layer);

  // Note that the core takes the heart's places by rank: the sphere, the reactor, the gimbal, then drums up and down the spine.
  const core = heartOrder(byLayer(ZONE_LAYER.CORE));
  let heartRadius = 0.85;
  let heart: Mesh | undefined;
  let up = SPINE_START;
  let down = -SPINE_START;
  core.forEach((zone, rank) => {
    const builder = builderOf(zone);
    if (rank === 0) {
      const built = buildSphere(builder, zone, root);
      heartRadius = built.radius;
      heart = built.mesh;
      keep(built);
    } else if (rank === 1) keep(buildReactor(builder, zone, heartRadius, plasma));
    else if (rank === 2) keep(buildGimbal(builder, zone, heartRadius, gimbal), gimbal);
    else {
      const radius = 1.4 + 2.4 * zone.footprint;
      const height = 1.8 + 2.6 * zone.footprint;
      const above = rank % 2 === 1;
      const y = above ? up + height / 2 : down - height / 2;
      if (above) up += height + 1.6;
      else down -= height + 1.6;
      keep(buildDrum(builder, zone, y, radius, height));
    }
  });

  const spineTop = Math.max(up, 14.6);
  const spineBottom = Math.min(down, -11);

  // Note that tooling stands as masts, the first up and the next down, each further out along the spine.
  byLayer(ZONE_LAYER.TOOLING)
    .sort((left, right) => right.footprint - left.footprint || (left.path < right.path ? -1 : 1))
    .forEach((zone, rank, tooling) => {
      const above = rank % 2 === 0;
      const height = (rank < 2 ? 9 : 5) + (rank < 2 ? 8 : 6) * zone.footprint;
      const from = above ? Math.max(up, 14.6) + 0.4 : Math.min(down, -11);
      const last = tooling.slice(rank + 1).every((_, later) => (rank + 1 + later) % 2 !== rank % 2);
      keep(buildMast(builderOf(zone), zone, from, height, above, last));
      if (above) up = from + height + 0.4;
      else down = from - height - 0.4;
    });
  const spine = new Parts();
  spine.add(
    materials.dark,
    cylinder(0.85, 0.85, spineTop - spineBottom, 16),
    translation(0, (spineTop + spineBottom) / 2, 0),
  );
  for (let y = Math.ceil(spineBottom); y <= spineTop; y += 2) {
    spine.add(
      materials.dark,
      ring(0.95, 0.08, 5, 20),
      translation(0, y, 0).multiply(new Matrix4().makeRotationX(Math.PI / 2)),
    );
  }

  // Note that each surface zone is a segment at its own place on the outer ring, and the bare frame runs between them.
  const arcs = segmentArcs(byLayer(ZONE_LAYER.SURFACE));
  for (const { zone, arc } of arcs) keep(buildSegment(builderOf(zone), zone, arc));
  if (arcs.length === 0) frameArc(spine, materials, 0, TAU);
  arcs.forEach(({ arc }, index) => {
    const next = arcs[(index + 1) % arcs.length];
    if (next === undefined) return;
    const start = arc[1];
    const end = next.arc[0] + (index === arcs.length - 1 ? TAU : 0);
    if (end - start > SEGMENT_GAP * 1.5) {
      frameArc(spine, materials, start, end);
      return;
    }
    const minor = Math.min(ringTubeAt(arcs, start - 0.001), ringTubeAt(arcs, end + 0.001)) * 0.62;
    spine.add(
      materials.dark,
      torusPatch(RING_RADIUS, minor, [start - 0.004, end + 0.004], [-Math.PI, Math.PI], [3, 16]),
    );
    for (const share of [0.3, 0.7]) {
      const angle = start + (end - start) * share;
      spine.add(
        materials.dark,
        ring(minor + 0.1, 0.07, 5, 24),
        basisFromZ(tangent(angle), undefined, radial(angle).multiplyScalar(RING_RADIUS)),
      );
    }
  });

  // Note that each domain zone is a module on a spoke of its own, at its own angle, joined to the hub and the ring by corridors.
  spokesOf(byLayer(ZONE_LAYER.DOMAIN)).forEach(({ angle, zone, narrowing }, spoke) => {
    const end = RING_RADIUS - ringTubeAt(arcs, angle) + 0.2;
    const radius = (1.05 + 1.35 * zone.footprint) * narrowing;
    const length = Math.min(4.5 + 12.5 * zone.footprint, end - 1.2 - MODULE_START);
    const builder = builderOf(zone);
    corridor(
      builder,
      angle,
      HUB_RADIUS - 0.6,
      MODULE_START - radius * 0.4,
      0.55 * Math.min(1, narrowing * 1.4),
    );
    keep(buildModule(builder, zone, angle, MODULE_START, length, radius, spoke % 2 === 0));
    corridor(
      builder,
      angle,
      MODULE_START + length + radius * 0.4,
      end,
      0.5 * Math.min(1, narrowing * 1.4),
    );
  });
  spine.add(
    materials.dark,
    ring(HUB_RADIUS - 0.6, 0.45, 8, 96),
    new Matrix4().makeRotationX(Math.PI / 2),
  );

  parts.build(root);
  spine.build(root);
  if (shells.length > 0) {
    const shellMesh = new Mesh(merged(shells), materials.glow);
    shellMesh.renderOrder = 5;
    root.add(shellMesh);
  }
  const conduits = conduitsOf(edges, bodies);
  if (conduits !== undefined) {
    const conduitMesh = new Mesh(conduits, materials.conduit);
    conduitMesh.renderOrder = 2;
    root.add(conduitMesh);
  }
  const heartBody = core[0] === undefined ? undefined : bodies.get(core[0].path);
  return {
    root,
    bodies,
    proxies,
    gimbal,
    heart,
    fallback: heartBody ?? bodies.values().next().value,
    dispose: () => {
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      for (const material of owned) material.dispose();
      proxyMaterial.dispose();
      root.removeFromParent();
    },
  };
}
