// Stones that roll, tumble and collide with their real shapes, on Jolt Physics (jolt-physics, WebAssembly).
// Unlike the exact engine this steps time (fixed 1/60 s), so results are approximate, and the drop preview can
// only show where a throw first touches something, not where the stone ends up after rolling.
// Jolt objects live in WebAssembly memory: everything made with `new J.X` is destroyed by hand.
import initJolt from 'jolt-physics';
import { restingHeight, surfaceUnder } from './stones.ts';
import type { DropPreview, Obstacle, StoneEngine, StoneView, Vec3 } from './stones.ts';

type J = Awaited<ReturnType<typeof initJolt>>;
type Body = InstanceType<J['Body']>;

const STEP = 1 / 60;
const LAYER_STATIC = 0, LAYER_MOVING = 1;
const PENETRATION_SLOP = 0.002; // m: Jolt's default (2 cm) would sink a 5 cm stone visibly into the floor
const PRESETTLE_LIMIT = 15;     // s of simulated time to let the initial heaps come to rest
const PREVIEW_LIMIT = 5;        // s of flight the drop preview follows
const MAX_CARRY_SPEED = 3;      // m/s: a held stone follows the hand no faster, or it would fling what it touches
// Contacts here are float32 with a small penetration, and a hull's bottom isn't exactly one radius down, so a
// stone counts as on a surface whose top is anywhere up to half a radius below its centre.
const supportBottom = (centreY: number, radius: number) => centreY - radius / 2;

let loading: Promise<J> | null = null;
const loadJolt = () => (loading ??= initJolt());

export const createJoltStones: StoneEngine = async (opts) => {
  const J = await loadJolt();

  // ---------- the world ----------
  const settings = new J.JoltSettings();
  const pairs = new J.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING);
  pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
  const bpStatic = new J.BroadPhaseLayer(0), bpMoving = new J.BroadPhaseLayer(1);
  const bpInterface = new J.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, bpStatic);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, bpMoving);
  J.destroy(bpStatic); // mapped by value
  J.destroy(bpMoving);
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 2, pairs, 2);
  const jolt = new J.JoltInterface(settings); // takes over the filters
  J.destroy(settings);
  const system = jolt.GetPhysicsSystem();
  const bodyInterface = system.GetBodyInterface();
  const physicsSettings = system.GetPhysicsSettings();
  physicsSettings.mPenetrationSlop = PENETRATION_SLOP;
  system.SetPhysicsSettings(physicsSettings);

  let gravity = opts.gravity;
  function setGravity(g: number) {
    gravity = g;
    const v = new J.Vec3(0, -g, 0);
    system.SetGravity(v);
    J.destroy(v);
  }
  setGravity(opts.gravity);

  function addStaticBox(box: Obstacle) {
    const { min, max } = box;
    const half = new J.Vec3((max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2);
    const shape = new J.BoxShape(half, 0.001); // the default 5 cm rounding wouldn't fit thin walls
    const pos = new J.RVec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    const rot = new J.Quat(0, 0, 0, 1);
    const cs = new J.BodyCreationSettings(shape, pos, rot, J.EMotionType_Static, LAYER_STATIC);
    cs.mFriction = 0.8;
    const body = bodyInterface.CreateBody(cs);
    bodyInterface.AddBody(body.GetID(), J.EActivation_DontActivate);
    for (const o of [cs, pos, rot, half]) J.destroy(o);
  }
  for (const s of opts.surfaces) {
    const fp = s.footprint;
    addStaticBox({ min: { x: fp.minX, y: s.height - 0.2, z: fp.minZ }, max: { x: fp.maxX, y: s.height, z: fp.maxZ } });
  }
  for (const o of opts.obstacles ?? []) addStaticBox(o);

  // ---------- the stones, placed by the sphere rule, then left to settle ----------
  const placed: (Vec3 & { radius: number })[] = [];
  const stones: Body[] = opts.stones.map((spec) => {
    const y = restingHeight(opts.surfaces, placed, spec.x, spec.z, spec.radius);
    placed.push({ x: spec.x, y, z: spec.z, radius: spec.radius });
    let shapeSettings: InstanceType<J['ConvexHullShapeSettings']> | null = null;
    let shape: InstanceType<J['Shape']>;
    if (spec.hull && spec.hull.length >= 4) {
      shapeSettings = new J.ConvexHullShapeSettings();
      for (const p of spec.hull) {
        const v = new J.Vec3(p.x, p.y, p.z);
        shapeSettings.mPoints.push_back(v); // copied
        J.destroy(v);
      }
      shapeSettings.mMaxConvexRadius = spec.radius * 0.1;
      shape = shapeSettings.Create().Get();
    } else {
      shape = new J.SphereShape(spec.radius);
    }
    const pos = new J.RVec3(spec.x, y, spec.z);
    const rot = new J.Quat(0, 0, 0, 1);
    const cs = new J.BodyCreationSettings(shape, pos, rot, J.EMotionType_Dynamic, LAYER_MOVING);
    cs.mFriction = 0.7;
    cs.mRestitution = opts.restitution;
    cs.mLinearDamping = 0.1; // habitat air, and lumpy stones don't roll for ever
    cs.mAngularDamping = 0.4;
    cs.mMotionQuality = J.EMotionQuality_LinearCast;
    const body = bodyInterface.CreateBody(cs);
    bodyInterface.AddBody(body.GetID(), J.EActivation_Activate);
    for (const o of [cs, pos, rot]) J.destroy(o);
    if (shapeSettings) J.destroy(shapeSettings); // the body holds its own reference to the shape
    return body;
  });

  const position = (b: Body): Vec3 => { const p = b.GetPosition(); return { x: p.GetX(), y: p.GetY(), z: p.GetZ() }; };

  let time = 0, pending = 0;
  let held: number | null = null;
  let target: Vec3 | null = null;

  function step() {
    if (held !== null && target) {
      const body = stones[held];
      const from = position(body);
      const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
      const k = Math.min(1, MAX_CARRY_SPEED * STEP / (Math.hypot(dx, dy, dz) || 1));
      const pos = new J.RVec3(from.x + dx * k, from.y + dy * k, from.z + dz * k);
      bodyInterface.MoveKinematic(body.GetID(), pos, body.GetRotation(), STEP);
      J.destroy(pos);
    }
    jolt.Step(STEP, 1);
  }

  // heaps settle before the visitor sees them, so the bins don't jiggle on arrival
  for (let t = 0; t < PRESETTLE_LIMIT && stones.some((b) => b.IsActive()); t += STEP) step();

  return {
    get time() { return time; },
    advance(dt) {
      if (!(dt > 0)) return;
      pending += dt;
      while (pending >= STEP) {
        step();
        pending -= STEP;
        time += STEP;
      }
    },
    stones(): StoneView[] {
      return stones.map((b, id) => {
        const pos = position(b);
        const q = b.GetRotation();
        const radius = opts.stones[id].radius;
        return {
          id, pos, radius,
          rot: { x: q.GetX(), y: q.GetY(), z: q.GetZ(), w: q.GetW() },
          status: id === held ? 'held' : b.IsActive() ? 'falling' : 'resting',
          on: surfaceUnder(opts.surfaces, pos.x, pos.z, supportBottom(pos.y, radius)),
        };
      });
    },
    grab(id) {
      if (held !== null || !stones[id]) return false;
      bodyInterface.SetMotionType(stones[id].GetID(), J.EMotionType_Kinematic, J.EActivation_Activate);
      held = id;
      target = position(stones[id]);
      return true;
    },
    moveHeld(p) {
      if (held !== null) target = p;
    },
    release(v = { x: 0, y: 0, z: 0 }) {
      if (held === null) return;
      const id = stones[held].GetID();
      bodyInterface.SetMotionType(id, J.EMotionType_Dynamic, J.EActivation_Activate);
      const linear = new J.Vec3(v.x, v.y, v.z), zero = new J.Vec3(0, 0, 0);
      bodyInterface.SetLinearVelocity(id, linear);
      bodyInterface.SetAngularVelocity(id, zero);
      J.destroy(linear);
      J.destroy(zero);
      held = null;
      target = null;
    },
    // follows the throw's parabola in short ray segments until the first hit (rays, not the stone's shape: close
    // enough for a guide)
    dropPreview(v = { x: 0, y: 0, z: 0 }): DropPreview | null {
      if (held === null) return null;
      const from = position(stones[held]);
      const radius = opts.stones[held].radius;
      const at = (t: number): Vec3 => ({ x: from.x + v.x * t, y: from.y + v.y * t - gravity * t * t / 2, z: from.z + v.z * t });
      const raySettings = new J.RayCastSettings();
      const bpFilter = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), LAYER_MOVING);
      const layerFilter = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), LAYER_MOVING);
      const bodyFilter = new J.IgnoreSingleBodyFilter(stones[held].GetID());
      const shapeFilter = new J.ShapeFilter();
      const path: Vec3[] = [from];
      let hit: Vec3 | null = null;
      for (let t = STEP; t <= PREVIEW_LIMIT && !hit; t += STEP) {
        const a = path[path.length - 1], b = at(t);
        const origin = new J.RVec3(a.x, a.y, a.z), dir = new J.Vec3(b.x - a.x, b.y - a.y, b.z - a.z);
        const ray = new J.RRayCast(origin, dir);
        const collector = new J.CastRayClosestHitCollisionCollector();
        system.GetNarrowPhaseQuery().CastRay(ray, raySettings, collector, bpFilter, layerFilter, bodyFilter, shapeFilter);
        if (collector.HadHit()) {
          const f = collector.mHit.mFraction;
          hit = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
        }
        path.push(hit ?? b);
        for (const o of [origin, dir, ray, collector]) J.destroy(o);
      }
      for (const o of [raySettings, bpFilter, layerFilter, bodyFilter, shapeFilter]) J.destroy(o);
      if (!hit) return null;
      const pos = { x: hit.x, y: hit.y + radius, z: hit.z };
      return { pos, path, on: surfaceUnder(opts.surfaces, pos.x, pos.z, supportBottom(pos.y, radius)) };
    },
    setGravity,
    dispose() {
      J.destroy(jolt); // frees the system, its bodies and the filters it took over
    },
  };
};
