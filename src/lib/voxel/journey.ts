import { STONE_Y, DEEP_Y, type MineInfo, type SiteInfo } from "./terrain";
import { site, stages, situations, commitments, PLACEHOLDER } from "@/content/site";

/* ----------------------------------------------------------------------------
   THE JOURNEY

   Eight acts, one camera path, and one set of numbers that both of them are
   built from.

   WHY THE ACTS CARRY THEIR OWN HEIGHT
   The copy is real sections in the normal scroll flow -- that is what makes
   it readable without JavaScript and reachable by a screen reader -- so the
   progress at which an act is on screen is decided by how TALL its section
   is, and by nothing else. The previous version dodged that by giving every
   beat the same height and putting all the pacing in the shot list, which
   works until an act needs longer than its neighbour. Here each act declares
   a span in screens, the page is laid out from those spans, and the progress
   each act is framed at is computed from the same arithmetic. The camera and
   the words cannot drift apart because neither of them owns the number.

   WHY THE PATH IS A PURE FUNCTION
   Nothing accumulates: sample(0.4) returns the same frame whether it was
   reached scrolling down or scrolling back up, which is the whole of what
   "works in both directions" requires. An eased or integrated camera drifts
   apart on the way back and no amount of tuning fixes it.

   WHY A SPLINE AND NOT A LIST OF LERPS
   Straight segments between shots meet at a corner, and a corner in a camera
   path is a visible flick -- the movement stops dead on one heading and
   leaves on another. Catmull-Rom passes exactly through every shot, so each
   one can still be framed by hand, while arriving and leaving on a continuous
   tangent.
-------------------------------------------------------------------------------*/

export type V3 = [number, number, number];

export type Shot = {
  /** Scroll progress this shot is framed at. */
  p: number;
  pos: V3;
  look: V3;
  fov: number;
};

/** Metres per cube on the depth readout.

    Chosen, not derived -- there is nothing in the scene that fixes a cube to
    a real length, and pretending otherwise would be inventing a figure. Four
    puts the chamber at a bit over a hundred metres, which is the right order
    for a shallow working and reads honestly on a dial. */
export const METRES_PER_BLOCK = 4;

/* --- the acts ---------------------------------------------------------------
   Every word of business copy below is taken from the content layer, which is
   the single place unverified claims are allowed to live. Nothing here names
   a client, a metric, a team size or a result, because none of those exist
   yet; where proof would normally sit, an act names the ARTIFACT the stage
   actually produces, which is a claim the company can keep.

   The mining metaphor is held to one rule: each act must map to something the
   business genuinely does, or else be openly about the scene rather than
   about the business. Acts two, three, four, six and seven carry the five
   delivery stages in order. Acts one, five and eight are the frame. */

export type Act = {
  id: string;
  /** Height of this act's section, in screens. Pacing lives here. */
  span: number;
  /** Two words for the chapter rail.

      Separate from the kicker on purpose: the kicker carries the delivery
      stage's own number, and a rail that prints its position AND the stage
      number reads "01 01 - Discovery". The rail says where you are in the
      journey; the card says which stage of the work it stands for. */
  nav: string;
  kicker: string;
  title: string;
  body: string;
  /** What the client is actually handed at this stage, where there is one. */
  artifact?: string;
  /** Short supporting items. Problem quotes, capabilities, commitments. */
  list?: Array<{ lead: string; note?: string }>;
  /** Filled in by the layout pass below. */
  at: number;
  from: number;
  to: number;
  /** A progress that FRAMES this act, for the reduced-motion view picker. */
  still: number;
  /** Where in its span that frame is, when the middle will not do: an act
      whose middle is the island halfway through opening or closing gives
      a still of something caught in the act of moving. */
  stillAt?: number;
  /** How far this act's subject is slid clear of its card, as a share of
      the usual slide (VoxelField's CARD_LENS). Less where the shot is wide
      and what the slide brings in at the near side is not the subject. */
  lens?: number;
};

/** One screen of hold at the end, so the last act can sit on its own frame
    rather than being scrolled off the moment it arrives. */
const TAIL = 0.5;

const DRAFT: Array<Omit<Act, "at" | "from" | "to" | "still">> = [
  {
    id: "surface",
    nav: "Surface",
    span: 1.0,
    kicker: site.name,
    title: site.positioning.join(" "),
    body: site.qualifier,
  },
  {
    id: "challenge",
    nav: "The challenge",
    span: 1.35,
    kicker: `${stages[0].index} — ${stages[0].name}`,
    title: "Every solution begins with understanding the problem",
    body: stages[0].body,
    artifact: stages[0].artifact,
    /* Real problem recognition from the content layer, not invented pain.
       Two of the four: a card carrying all of them stops being a card. */
    list: situations.slice(0, 2).map((s) => ({
      lead: s.quote,
      note: s.reframe,
    })),
  },
  {
    id: "expedition",
    nav: "The expedition",
    span: 1.5,
    stillAt: 0.75,
    /* The island in section, with the half that slid away at the left. At
       the full slide the frame took in that half's shaded underside -- 3.1%
       of it crushed to black -- and the ledge at the right-hand end of the
       section went to the edge of the picture. */
    lens: 0.65,
    kicker: `${stages[1].index} — ${stages[1].name}`,
    title: "The way down is a decision, not a guess",
    body: stages[1].body,
    artifact: stages[1].artifact,
  },
  {
    id: "operation",
    nav: "The face",
    span: 1.5,
    kicker: `${stages[2].index} — ${stages[2].name}`,
    title: "Working the face",
    body: stages[2].body,
    artifact: stages[2].artifact,
  },
  {
    id: "discovery",
    nav: "The find",
    span: 1.3,
    kicker: "The find",
    title: "Digging deeper. Discovering better solutions.",
    body: "What is worth having is rarely lying on the surface. This is the point where a project stops being a plan and starts being a thing that exists — and the only way to reach it was to keep cutting after the easy ground ran out.",
  },
  {
    id: "transformation",
    nav: "Transformation",
    /* Out of the find, up the spur, round at its mouth and along to the
       forge: at 1.2 the turn at the mouth had a tenth of a screen and swung
       the view through 58 degrees in it. */
    span: 1.5,
    kicker: `${stages[3].index} — ${stages[3].name}`,
    title: "Raw material is not a result",
    body: stages[3].body,
    artifact: stages[3].artifact,
    list: site.capabilities.map((c) => ({ lead: c })),
  },
  {
    id: "return",
    nav: "Return",
    span: 1.1,
    stillAt: 1,
    kicker: `${stages[4].index} — ${stages[4].name}`,
    title: "We come back up with you",
    body: stages[4].body,
    artifact: stages[4].artifact,
  },
  {
    id: "outcome",
    nav: "Contact",
    span: 1.35,
    kicker: site.name,
    title: "We explore the challenge. We engineer the answer. We deliver the future.",
    body: `Tell us what is not working. You will get ${site.responseCommitment}.`,
    /* Straight from the content layer, word for word, and only the ones
       that are confirmed: a commitment still marked placeholder is a promise
       nobody has agreed to keep yet. */
    list: commitments
      .filter((c) => !c.body.startsWith(PLACEHOLDER))
      .map((c) => ({ lead: c.title, note: c.body })),
  },
];

/** Total height of the scroll stage, in screens. */
export const STAGE_SPANS = DRAFT.reduce((n, a) => n + a.span, 0) + TAIL;

/** The scrollable distance is the stage minus one screen, because the stage
    stops scrolling when its BOTTOM edge arrives -- which is exactly the pair
    of edges ScrollTrigger is told to measure between. Getting this wrong puts
    every act's camera key a screen away from the words it belongs to. */
const TRACK = STAGE_SPANS - 1;

export const ACTS: Act[] = (() => {
  let cursor = 0;
  return DRAFT.map((a) => {
    const from = Math.max(0, (cursor - 0.5) / TRACK);
    /* The progress at which this act's section sits in the MIDDLE of the
       screen. That is the moment it is being read, so it is the moment its
       camera key belongs at. */
    const at = Math.min(1, Math.max(0, (cursor + a.span / 2 - 0.5) / TRACK));
    cursor += a.span;
    const to = Math.min(1, (cursor - 0.5) / TRACK);
    const still = a.stillAt === undefined ? at : from + (to - from) * a.stillAt;
    return { ...a, at, from, to, still };
  });
})();

/** Which act is live at a progress. */
export function actAt(p: number) {
  let i = 0;
  for (let k = 0; k < ACTS.length; k++) if (p >= ACTS[k].from) i = k;
  return i;
}


/* --- the road ---------------------------------------------------------------
   Where the cart is, and where a camera following it should stand. Both the
   shot list below and the renderer read these, which is the only way the two
   can agree -- a camera whose position is computed from one formula while the
   thing it is filming moves on another ends up on top of it, and that is
   exactly what the first pass did. */

export type RailPoint = { x: number; y: number; z: number };

/** A point a given distance along the road, and the heading there.

    Distance is counted in rail points rather than in units, which is exact
    because the road is laid one box per block of run. Fractional values
    interpolate, so nothing steps. */
export function alongRail(rail: RailPoint[], s: number) {
  const n = rail.length;
  const c = Math.min(n - 1, Math.max(0, s));
  const i = Math.min(n - 2, Math.floor(c));
  const f = c - i;
  const a = rail[i];
  const b = rail[Math.min(n - 1, i + 1)];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/* --- the track as laid -------------------------------------------------------
   The road is a line of block centres, one a block, its floors at whole
   heights. The track laid on it is not that line, and a cart rides the
   track. A step in the road is a rail that climbs across the LOWER block,
   from its far edge to the near edge of the higher one, the way the game
   lays an ascending rail: run straight from centre to centre it cuts through
   the corner of the step, and laid flat on each block it is a staircase the
   cart floated up. A corner is a quarter circle across the corner block,
   where a cart following the points turned through ninety degrees in no
   distance at all. The rails are drawn from these same two functions. */

/** How far block i's rail has climbed at d across it (-0.5 at the side the
    road comes in by, 0.5 at the side it leaves by): flat, or rising toward
    whichever neighbour is a block higher. */
export function railRise(rail: RailPoint[], i: number, d: number) {
  const p = rail[i];
  const prev = rail[i - 1];
  const next = rail[i + 1];
  if (prev && prev.y === p.y + 1) return 0.5 - d;
  if (next && next.y === p.y + 1) return 0.5 + d;
  return 0;
}

/** The track's centre line at s, in road points, and its heading there. */
export function onTrack(rail: RailPoint[], s: number) {
  const n = rail.length;
  const c = Math.min(n - 1, Math.max(0, s));
  const i = Math.round(c);
  const d = c - i;
  const p = rail[i];
  const prev = rail[i - 1];
  const next = rail[i + 1];
  // One-block steps in the plane, into this block and out of it.
  const inX = prev ? p.x - prev.x : next ? next.x - p.x : 0;
  const inZ = prev ? p.z - prev.z : next ? next.z - p.z : 1;
  const outX = next ? next.x - p.x : inX;
  const outZ = next ? next.z - p.z : inZ;
  const y = p.y + railRise(rail, i, d);
  if (inX === outX && inZ === outZ) {
    return { x: p.x + inX * d, y, z: p.z + inZ * d, yaw: Math.atan2(inX, inZ) };
  }
  // Round the block's inside corner, from the middle of one edge to the next.
  const a = ((d + 0.5) * Math.PI) / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ox = p.x + (outX - inX) / 2;
  const oz = p.z + (outZ - inZ) / 2;
  return {
    x: ox + (inX * sin - outX * cos) / 2,
    y,
    z: oz + (inZ * sin - outZ * cos) / 2,
    yaw: Math.atan2(inX * cos + outX * sin, inZ * cos + outZ * sin),
  };
}

/** A cart on the track. Its body hangs between its two axles, half a
    wheelbase either side of s, so it tilts into a climb as the front wheels
    reach it and swings round a corner instead of turning on the spot.
    Pitch is positive nose-up. */
export function rideOn(rail: RailPoint[], s: number, half = 0.45) {
  const a = onTrack(rail, s - half);
  const b = onTrack(rail, s + half);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(b.y - a.y, Math.hypot(dx, dz)),
  };
}

/* Keyed off the acts rather than off round numbers, so retiming a section
   moves everything timed against it. A beat written at a literal 0.63 is
   correct until somebody makes act five a little longer, and then the reveal
   happens in a tunnel. */
const A = (i: number, t = 0.5) => {
  const a = ACTS[i];
  return a.from + (a.to - a.from) * t;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
};

/** How much of the frame belongs to act i at p: one inside it, nought
    outside, crossing over a quarter of a screen either side of each
    boundary. The weights of all the acts sum to one at every p, so anything
    set per act -- the lens shift that keeps a subject clear of its card --
    blends from one act to the next without a step. */
export function actWeight(i: number, p: number) {
  const h = 0.25 / TRACK;
  const a = ACTS[i];
  const into = i === 0 ? 1 : smooth(a.from - h, a.from + h, p);
  const out = i === ACTS.length - 1 ? 0 : smooth(a.to - h, a.to + h, p);
  return into - out;
}

/** Where in the last act the closing pull-back starts: from the shot over
    the depot to the whole island, the frame the journey ends on. */
const CLOSING = 0.58;

/** How far that pull-back has gone: nought at its start, one on the last
    frame. The renderer fits the last frame to the screen as it fits the
    first, and brings the fit in over this. */
export function closingAt(p: number) {
  return smooth(A(ACTS.length - 1, CLOSING), 1, p);
}

/* --- the cut ----------------------------------------------------------------
   How far open the island is, and where the half that goes has got to. Pure
   functions of progress like everything else here: the renderer slides the
   faces by them, and the clearance probe moves its copy of the rock by the
   same numbers, so the camera is checked against where the rock actually is
   rather than where it was. */

/** 0 closed to 1 open. It opens across act three and closes across act
    seven, with the camera outside the island both times. */
export function openAt(p: number) {
  return smooth(A(2, 0.12), A(2, 0.62), p) * (1 - smooth(A(6, 0.25), A(6, 0.7), p));
}

/** Where the front half ends up, fully open: out from the cut, then aside
    to the left and a little down, clear of every shot that looks into the
    section. */
export const OPEN_SHIFT: V3 = [-72, -8, 20];

/** The slide as a path rather than a line: straight out from the cut first,
    the way a drawer comes out, and only then aside. Sliding sideways along
    the cut from the start drags one face of rock across the other. */
export function openShift(o: number): V3 {
  const out = smooth(0, 0.45, o);
  const aside = smooth(0.2, 1, o);
  return [OPEN_SHIFT[0] * aside, OPEN_SHIFT[1] * aside, OPEN_SHIFT[2] * out];
}

/** How far the eye has gone over to the dark. The open mine stands in
    daylight from the cut, so it takes a little; the one enclosed space the
    camera enters -- the passage to the find, and the find -- takes all of
    it. */
export function underAt(p: number) {
  const dive = smooth(A(4, 0.42), A(4, 0.66), p) * (1 - smooth(A(5, 0.16), A(5, 0.34), p));
  return Math.max(0.3 * openAt(p), dive);
}

/** In the room with the find. */
export function findAt(p: number) {
  return smooth(A(4, 0.6), A(4, 0.9), p) * (1 - smooth(A(5, 0.1), A(5, 0.3), p));
}

/** The find in view: from the head of the spur, where its light first shows
    down the passage, until the camera has backed out of it. Wider than
    findAt, which is being in the room. */
export function revealAt(p: number) {
  return smooth(A(4, 0.3), A(4, 0.5), p) * (1 - smooth(A(5, 0.14), A(5, 0.3), p));
}

/* --- the cart ---------------------------------------------------------------
   Where it is and what it carries, as pure functions of progress: scrubbing
   back up the page runs it backwards exactly rather than approximately. */

/** Where the cart waits at each station, as points along the route. */
export type CartStops = { face: number; wait: number; forge: number; exit: number; depot: number };

export function cartStops(mine: MineInfo): CartStops {
  const r = mine.route;
  const { stops } = mine;
  /* Only ever on a level block: a cart parked on the block below a step
     sits on that step's climbing rail, tipped forty-five degrees. */
  const level = (i: number) => railRise(r, i, -0.5) === railRise(r, i, 0.5);
  const nearest = (x: number, from: number, to: number) => {
    let best = -1;
    for (let i = from; i <= to; i++) {
      if (level(i) && (best < 0 || Math.abs(r[i].x - x) < Math.abs(r[best].x - x))) best = i;
    }
    return best < 0 ? from : best;
  };
  const t = mine.target;
  const G = mine.gallery;
  const F = mine.forge;
  return {
    // In front of the face, a little short of the block being worked.
    face: nearest(t ? t.x - 1.5 : (G.x0 + G.x1) / 2, stops.portal, stops.gallery),
    /* Past the junction and up the incline: the camera goes down the spur
       while the cart waits, and a cart parked across the spur's mouth --
       with a man behind it -- is a thing for the lens to fly through. */
    wait: Math.min(stops.forge, stops.junction + 5),
    forge: nearest((F.x0 + F.x1) / 2 - 1, stops.junction, stops.forge),
    exit: stops.exit,
    // Against the buffer at the end of the road, not over it.
    depot: stops.depot - 0.6,
  };
}

/** Where the cart is at a progress, in route points. At the face through
    act four; across the bridge and up to the junction as act five opens;
    on to the forge in act six; up the long incline and out of the upper
    portal in act seven, and to the buffer at the depot in act eight. */
export function cartS(p: number, c: CartStops) {
  const run = (a: number, b: number, from: number, to: number) => a + (b - a) * smooth(from, to, p);
  if (p < A(4, 0.02)) return c.face;
  if (p < A(4, 0.34)) return run(c.face, c.wait, A(4, 0.02), A(4, 0.34));
  if (p < A(5, 0.06)) return c.wait;
  if (p < A(5, 0.36)) return run(c.wait, c.forge, A(5, 0.06), A(5, 0.36));
  if (p < A(6, 0.08)) return c.forge;
  if (p < A(6, 0.96)) return run(c.forge, c.exit, A(6, 0.08), A(6, 0.96));
  if (p < A(7, 0.04)) return c.exit;
  return run(c.exit, c.depot, A(7, 0.04), A(7, 0.3));
}

/** What the cart carries: ore, shovelled in at the face across act four;
    then, at the forge, the ore goes in and what the forge makes comes out.
    Each a fill from 0 to 1, which the renderer shows as a heap rising in
    the cart. */
export function cartLoads(p: number) {
  const fill = smooth(A(3, 0.2), A(3, 0.8), p);
  const unload = smooth(A(5, 0.4), A(5, 0.52), p);
  const reload = smooth(A(5, 0.58), A(5, 0.72), p);
  return { ore: fill * (1 - unload), product: reload };
}

/* --- the camera -------------------------------------------------------------*/

export function shotList(mine: MineInfo, site: SiteInfo): Shot[] {
  const L = site.ledge;
  const G = mine.gallery;
  const F = mine.forge;
  const C = mine.chasm;
  const geo = mine.geode;
  const S = mine.sectionZ;
  /* The working face, read off the generator's own pick rather than guessed
     at. It is the one thing in the gallery the act is about. */
  const t = mine.target;
  const faceX = t ? t.x : (G.x0 + G.x1) / 2;
  const faceY = t ? t.y + 0.4 : G.floorY + 2;
  const faceZ = t ? t.z : G.back - 1;
  /** A point a fraction of the way down the spur, junction first, lifted to
      eye height above its floor. The spur drops a block a point, and a
      camera flown on a straight line between its ends would be in the
      roof at one end and the floor at the other. */
  const spur = (f: number, up: number): V3 => {
    const p = alongRail(mine.spur, f * (mine.spur.length - 1));
    return [p.x, p.y + up, p.z];
  };
  const chasmX = (C.x0 + C.x1) / 2;
  const forgeX = (F.x0 + F.x1) / 2;
  const ex = site.exit;
  // The cliff the upper portal is cut in; `exit` is the turf outside it.
  const exitX = ex.x - 1;
  const depot = mine.route[mine.stops.depot];

  /* Annotated rather than inferred: without it the position literals come out
     as number[] and stop satisfying V3. */
  const shots: Shot[] = [
    /* ACT 1 -- the world. The island whole, its title over it, from the
       front right: the cascade on the sunlit left face, the mine's ledge in
       the shade of the right. */
    { p: 0, pos: [78, 89, 109], look: [0, 40, 0], fov: 48 },
    { p: A(0, 0.8), pos: [70, 82, 98], look: [0, 42, 0], fov: 48 },

    /* ACT 2 -- base camp. Down the island's side to the ledge the mine opens
       onto, ending at eye level with the crew and the way in. */
    { p: A(1, 0.25), pos: [L.x + 32, L.y + 15, L.z + 30], look: [L.face, L.y + 2, L.z], fov: 46 },
    { p: A(1, 0.62), pos: [L.x + 13, L.y + 4.5, L.z + 10], look: [L.face, L.y + 1.6, L.z - 0.5], fov: 50 },
    { p: A(1, 1.0), pos: [L.x + 5.5, L.y + 2.2, L.z + 2.6], look: [L.face - 2, L.y + 1.8, L.z], fov: 54 },

    /* ACT 3 -- the island opens. Off the ledge and out in front of the
       island as its front half comes away, to the whole mine in section:
       every level, the track between them and the crew on each, at once.

       Every one of these stands to the RIGHT of the island while the half
       that goes is still near it -- it leaves to the left -- and only comes
       round in front once it has gone. */
    { p: A(2, 0.2), pos: [L.x + 10, L.y + 6.5, L.z + 16.5], look: [L.face - 2, L.y + 2, L.z], fov: 52 },
    { p: A(2, 0.4), pos: [40, 54, 52], look: [4, 41, S], fov: 50 },
    { p: A(2, 0.68), pos: [8, 45, 84], look: [0, 38, S], fov: 52 },
    { p: A(2, 1.0), pos: [14, 44, 74], look: [4, 39, S], fov: 52 },

    /* ACT 4 -- the working face. In from the front of the section to the
       gallery, standing where the rock was, and a slow push in on the face
       and the block a visitor can break. */
    { p: A(3, 0.25), pos: [G.x1 + 6.5, G.floorY + 6, S + 20.5], look: [faceX - 0.5, G.floorY + 2, S - 2.5], fov: 52 },
    /* From the block's right: the visitor's man stands at its left and the
       loader further left by the cart, so the line to the block is clear. */
    { p: A(3, 0.5), pos: [faceX + 3.4, G.floorY + 4, S + 9], look: [faceX - 0.5, faceY + 0.4, faceZ + 1.2], fov: 54 },
    { p: A(3, 0.8), pos: [faceX + 1.7, G.floorY + 3.3, S + 5.6], look: [faceX - 0.4, faceY + 0.2, faceZ + 0.9], fov: 56 },
    // Turning off the face and onto the road, as the cart pulls away.
    { p: A(3, 1.0), pos: [G.x0 + 0.5, G.floorY + 3.5, S + 6.5], look: [chasmX + 6, C.bridgeY + 2, S - 2.5], fov: 56 },

    /* ACT 5 -- the find. The bridge over the chasm, the lava a long way
       down and daylight falling into it from the skylight; then down the
       spur and into the geode -- the one enclosed room the camera enters,
       so the find is come upon rather than looked at. */
    { p: A(4, 0.15), pos: [chasmX + 7.5, C.bridgeY + 6, S + 15.5], look: [chasmX, C.floorY + 9, S - 3], fov: 54 },
    { p: A(4, 0.38), pos: [geo.x, C.bridgeY + 4, S + 6], look: [geo.x, C.bridgeY - 0.5, S - 4.5], fov: 56 },
    /* Down into the spur's mouth, then down the spur itself at the height of
       a man's eyes over its floor: it is three blocks high, and a lens any
       higher sees through its roof where the floor steps down. */
    { p: A(4, 0.5), pos: [geo.x, C.bridgeY + 2.6, S + 0.5], look: spur(0.7, 1.4), fov: 58 },
    { p: A(4, 0.62), pos: spur(0.4, 2.0), look: spur(1.0, 1.2), fov: 60 },
    { p: A(4, 0.76), pos: spur(0.75, 2.0), look: [geo.x, geo.y, geo.z - 1], fov: 60 },
    { p: A(4, 0.9), pos: spur(1.0, 2.1), look: [geo.x - 0.3, geo.y - 0.5, geo.z - 2.5], fov: 62 },
    { p: A(4, 1.0), pos: [geo.x + 0.2, geo.y + 0.8, geo.z + 1.6], look: [geo.x - 0.5, geo.y - 0.6, geo.z - 3.5], fov: 64 },

    /* ACT 6 -- transformation. Backing out of the find still facing it --
       turning round in a passage three blocks wide swings the view through
       the wall -- then out of the spur's mouth and along to the forge. */
    // A little lower going back: the roof steps down toward the find, just in front of the lens.
    { p: A(5, 0.1), pos: spur(0.75, 1.8), look: [geo.x, geo.y - 0.5, geo.z], fov: 60 },
    { p: A(5, 0.2), pos: spur(0.3, 1.8), look: spur(1.0, 1.0), fov: 60 },
    /* Up out of the mouth before turning: the rails cross it a block lower.
       The turn is the biggest in the film, so it gets the most scroll. */
    { p: A(5, 0.42), pos: [geo.x, C.bridgeY + 3.0, S + 1.5], look: [geo.x - 4, C.bridgeY + 2.5, S - 2], fov: 58 },
    { p: A(5, 0.56), pos: [geo.x - 0.5, C.bridgeY + 4.5, S + 6], look: [forgeX + 2, F.floorY + 1, S - 4.5], fov: 56 },
    { p: A(5, 0.74), pos: [forgeX + 4.5, F.floorY + 4, S + 8.5], look: [forgeX + 0.5, F.floorY + 1.5, S - 2.5], fov: 54 },
    { p: A(5, 1.0), pos: [forgeX + 2.5, F.floorY + 4.3, S + 8], look: [forgeX - 0.5, F.floorY + 1.5, S - 3], fov: 54 },

    /* ACT 7 -- the return. Back out of the section as the island closes,
       round to the right, and down to the upper portal as the cart comes up
       the incline and out into the light.

       Out to sixty in front before the half that went comes back: it
       returns along the way it left, and the forge shot stands where its
       rock will be. */
    { p: A(6, 0.25), pos: [-2, 54, 54], look: [-6, 42, S], fov: 50 },
    { p: A(6, 0.55), pos: [38, 61, 50], look: [6, 47, -4], fov: 50 },
    /* In along the line of the track rather than across the plateau: the
       hoist's arm reaches out over the ledge at about the height this shot
       comes down to, and a path from the front passes through it. */
    { p: A(6, 0.84), pos: [exitX + 26, ex.y + 8, ex.z + 6.5], look: [exitX, ex.y + 0.5, ex.z], fov: 52 },
    // From the open side of the track: the depot's crew are on the other.
    { p: A(6, 1.0), pos: [exitX + 8.5, ex.y + 2.7, ex.z + 4], look: [exitX, ex.y + 1.1, ex.z], fov: 54 },

    /* ACT 8 -- the outcome. Along with the cart to the depot, where the
       beacon fires; then up and back to the whole island under it, higher
       than the opening frame and from the same side. Clear of the hoist:
       its arm reaches out over the ledge a few blocks in front of the
       depot, at about the height a camera at the cart's shoulder stands. */
    { p: A(7, 0.28), pos: [depot.x + 7.5, depot.y + 4.5, depot.z + 2.5], look: [depot.x - 1, depot.y + 1.5, depot.z - 1], fov: 52 },
    { p: A(7, CLOSING), pos: [52, 74, 34], look: [16, 58, -10], fov: 50 },
    { p: 1.0, pos: [90, 100, 122], look: [0, 50, 0], fov: 50 },
  ];

  return shots;
}

/* --- between the keys -------------------------------------------------------
   A cubic through every channel of the camera -- position, heading, pitch,
   lens -- with one slope at each key, in PROGRESS, shared by the segments on
   either side of it.

   The spline this replaces gave every segment the same unit of time however
   much scroll it spanned, so wherever a short segment met a long one the
   camera's speed changed in an instant: a lurch on seven keys of thirty-one,
   measured. The slopes are the shape-preserving kind (Fritsch and Butland's),
   so no channel runs past a key on its way through it -- a camera easing
   into a tunnel mouth does not swing beyond it into the rock, and a lens
   does not breathe.

   The view is carried as a heading and a pitch rather than as the point it
   looks at. A look point swept close past the lens turns the view through
   whatever angle it subtends there, however short the move. */

/** Slopes for a shape-preserving cubic through (xs, ys): flat where the
    curve turns back, and a weighted harmonic mean of the two secants
    elsewhere, so a slow segment meeting a fast one is not overshot. */
function slopes(xs: number[], ys: number[]) {
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(xs[k + 1] - xs[k] || 1e-6);
    d.push((ys[k + 1] - ys[k]) / h[k]);
  }
  const m = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) continue;
    const w1 = 2 * h[k] + h[k - 1];
    const w2 = h[k] + 2 * h[k - 1];
    m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
  }
  // The ends from the three points nearest them, never past the data.
  const end = (h0: number, h1: number, d0: number, d1: number) => {
    const e = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(e) !== Math.sign(d0)) return 0;
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(e) > Math.abs(3 * d0)) return 3 * d0;
    return e;
  };
  if (n > 2) {
    m[0] = end(h[0], h[1], d[0], d[1]);
    m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  } else if (n === 2) {
    m[0] = m[1] = d[0];
  }
  return m;
}

type Channel = { y: number[]; m: number[] };
type Track = { p: number[]; pos: Channel[]; yaw: Channel; pitch: Channel; fov: Channel; reach: number[] };

const tracks = new WeakMap<Shot[], Track>();

function trackOf(shots: Shot[]): Track {
  const known = tracks.get(shots);
  if (known) return known;
  const p = shots.map((s) => s.p);
  const channel = (y: number[]): Channel => ({ y, m: slopes(p, y) });
  const yaw: number[] = [];
  const pitch: number[] = [];
  const reach: number[] = [];
  for (const s of shots) {
    const dx = s.look[0] - s.pos[0];
    const dy = s.look[1] - s.pos[1];
    const dz = s.look[2] - s.pos[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    // Unwrapped, so a heading that crosses south turns the short way round.
    let a = Math.atan2(dx, dz);
    const before = yaw[yaw.length - 1];
    if (before !== undefined) {
      while (a - before > Math.PI) a -= 2 * Math.PI;
      while (a - before < -Math.PI) a += 2 * Math.PI;
    }
    yaw.push(a);
    pitch.push(Math.asin(dy / r));
    reach.push(r);
  }
  const track: Track = {
    p,
    pos: [0, 1, 2].map((a) => channel(shots.map((s) => s.pos[a]))),
    yaw: channel(yaw),
    pitch: channel(pitch),
    fov: channel(shots.map((s) => s.fov)),
    reach,
  };
  tracks.set(shots, track);
  return track;
}

export type Frame = { pos: V3; look: V3; fov: number };

/** The camera at a given scroll progress. Pure, and defined for every p. */
export function sampleShots(shots: Shot[], p: number): Frame {
  const tr = trackOf(shots);
  const q = Math.min(1, Math.max(0, p));

  let i = 0;
  while (i < shots.length - 2 && q > tr.p[i + 1]) i++;

  const h = tr.p[i + 1] - tr.p[i] || 1e-6;
  const s = Math.min(1, Math.max(0, (q - tr.p[i]) / h));
  const s2 = s * s;
  const s3 = s2 * s;
  // Hermite, with the slopes scaled to the segment's own length in progress.
  const at = (c: Channel) =>
    (2 * s3 - 3 * s2 + 1) * c.y[i] +
    (s3 - 2 * s2 + s) * h * c.m[i] +
    (-2 * s3 + 3 * s2) * c.y[i + 1] +
    (s3 - s2) * h * c.m[i + 1];

  const pos: V3 = [at(tr.pos[0]), at(tr.pos[1]), at(tr.pos[2])];
  const yaw = at(tr.yaw);
  const pitch = at(tr.pitch);
  const r = tr.reach[i] + (tr.reach[i + 1] - tr.reach[i]) * s;
  const look: V3 = [
    pos[0] + Math.sin(yaw) * Math.cos(pitch) * r,
    pos[1] + Math.sin(pitch) * r,
    pos[2] + Math.cos(yaw) * Math.cos(pitch) * r,
  ];
  return { pos, look, fov: at(tr.fov) };
}

/* --- the depth readout --------------------------------------------------------
   How far down the thing being shown is, in metres below the plateau -- not
   the camera's height. With the island open the camera stands outside the
   rock looking into it, so its own height says nothing about the mine; the
   working face, the bridge and the find each have a depth, and the readout
   carries the one the act is about from one to the next. */

/** The plateau's surface, the readout's zero. */
const GROUND = 50.5;

export function depthAlong(p: number, mine: MineInfo, ledgeY: number) {
  const m = (y: number) => Math.max(0, (GROUND - y) * METRES_PER_BLOCK);
  const keys: Array<[number, number]> = [
    [0, 0],
    [A(1, 0.45), 0],
    [A(1, 1.0), m(ledgeY)],
    [A(2, 0.5), m(ledgeY)],
    [A(3, 0.5), m(mine.gallery.floorY + 0.5)],
    [A(4, 0.2), m(mine.chasm.bridgeY + 0.5)],
    [A(4, 0.9), m(mine.geode.y - mine.geode.r + 1.5)],
    [A(5, 0.5), m(mine.forge.floorY + 0.5)],
    [A(6, 1.0), 0],
    [1, 0],
  ];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [p0, d0] = keys[i - 1];
      const [p1, d1] = keys[i];
      return d0 + (d1 - d0) * smooth(p0, p1, p);
    }
  }
  return 0;
}

/** Which band of the island a depth is in: the same bands the cut face
    shows, read off the generator's own two thresholds. */
export function stratumFor(metres: number) {
  const y = GROUND - metres / METRES_PER_BLOCK;
  if (metres < 1) return "Surface";
  if (y > STONE_Y + 3) return "Topsoil";
  if (y >= STONE_Y) return "Stone";
  if (y > DEEP_Y) return "Rock";
  return "Deep rock";
}
