import { STONE_Y, DEEP_Y, type MineInfo } from "./terrain";
import { site, stages, situations } from "@/content/site";

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
    span: 1.2,
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
    list: [
      { lead: "You own everything", note: "Code, repositories and infrastructure accounts are yours from day one." },
      { lead: "Published rates and models", note: "Our engagement models and pricing method are on the site, before you ask." },
      { lead: "You work with the engineers", note: "The people who scope the work are the people who write it." },
    ],
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
    return { ...a, at, from, to, still: at };
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

/** Where the cart is at a progress, in rail points.

    It runs out to the find empty across act five and comes back loaded across
    act six. Pure, like the camera: scrubbing back up the page runs it
    backwards exactly rather than approximately. */
export function cartS(p: number, n: number) {
  const out = ACTS[4];
  const back = ACTS[5];
  const last = n - 2;
  if (p <= out.from) return 1;
  if (p < out.to) {
    return 1 + (last - 1) * ((p - out.from) / (out.to - out.from || 1));
  }
  if (p < back.to) {
    const u = Math.min(1, Math.max(0, (p - back.from) / (back.to - back.from || 1)));
    return last - (last - 1) * u;
  }
  return 1;
}

/** Loaded or empty: the find goes in the cart when the find is made. */
export function cartLoad(p: number) {
  const u = (p - ACTS[4].at) / (ACTS[4].to - ACTS[4].at || 1);
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/* --- the camera -------------------------------------------------------------
   Keyed off the acts rather than off round numbers, so retiming a section
   moves its shot with it. A shot written at a literal 0.63 is correct until
   somebody makes act five a little longer, and then the reveal happens in a
   tunnel. */
const A = (i: number, t = 0.5) => {
  const a = ACTS[i];
  return a.from + (a.to - a.from) * t;
};

export function shotList(mine: MineInfo): Shot[] {
  const { x, z, floorY, chamberFloorY, shaftBottomY, rimY } = mine;
  /* The working face, read off the generator's own pick rather than guessed
     at. It is the one thing in the chamber the act is about. */
  const t = mine.target;
  const faceX = t ? t.x : x + 4;
  const faceY = t ? t.y + 0.4 : chamberFloorY + 3;
  const faceZ = t ? t.z : z;
  const cav = mine.cavern;
  const cry = mine.crystal;
  const rail = mine.drift;
  const head = rail[0];
  const [dx, dz] = mine.driftDir;
  // Across the drift, for shots that stand to one side of the way.
  const px = -dz;
  const pz = dx;

  /** A camera following the cart: so many rail points behind it, a little to
      one side of the way, at eye height above the floor. */
  const trail = (p: number, back: number, side: number, up: number) => {
    const cart = alongRail(rail, cartS(p, rail.length));
    const eye = alongRail(rail, cartS(p, rail.length) + back);
    return {
      pos: [eye.x + px * side, eye.y + up, eye.z + pz * side] as V3,
      look: [cart.x, cart.y + 1.1, cart.z] as V3,
    };
  };

  /* Annotated rather than inferred: without it the position literals come out
     as number[] and stop satisfying V3. */
  const shots: Shot[] = [
    /* ACT 1 -- the world. The approved hero frame, which is the one shot not
       free to change: it is what the page opens on. */
    { p: 0, pos: [58.1, 54, 81.4], look: [0, 24, 0], fov: 48 },
    { p: A(0, 0.8), pos: [50, 52, 70], look: [0, 26, 0], fov: 48 },

    /* ACT 2 -- the challenge. Over the rim, with the crew and their gear in
       frame before the pit is. The hole is the problem; the people looking
       into it are the point. */
    { p: A(1, 0.25), pos: [27, 49, 34], look: [x + 5, 38, z + 4], fov: 46 },
    { p: A(1, 0.62), pos: [17.5, 53, 26], look: [x, 32, z], fov: 48 },
    /* The benches read as cut steps and the strata they expose are the
       cross-section -- the one frame that shows the ground in section. */
    { p: A(1, 1.0), pos: [11, 49, 17], look: [x, 30, z], fov: 50 },

    /* ACT 3 -- the expedition. Down the bore.

       Both numbers in the first are about the pit's own walls. HIGH, because
       a camera level with the rim looks ACROSS a pit rather than into it and
       the hole reads as a dark patch on the grass; and close to the AXIS,
       because the benches step inward as they go down, so the only column of
       air running clear from rim to floor is the one over the shaft. */
    { p: A(2, 0.18), pos: [2.0, 44, 10], look: [x, 29, z], fov: 52 },
    { p: A(2, 0.52), pos: [x + 1.1, floorY + 1.5, z + 0.5], look: [x, 20, z], fov: 60 },
    { p: A(2, 0.78), pos: [x + 0.2, 24, z + 1.2], look: [x, 15, z], fov: 62 },
    { p: A(2, 1.0), pos: [x - 0.9, 19.5, z + 0.3], look: [x, 11, z], fov: 62 },

    /* ACT 4 -- the working face. Through the roof of the chamber, then down
       to the floor of it.

       Low and back against the wall, looking across the room. The chamber is
       about six cubes of radius and narrows as it rises, so the widest place
       to stand in it is just off the floor; at mid-height the lens is close
       enough to the seam that the ore fills the frame -- a wall of coloured
       blocks rather than a room with ore in it. */
    { p: A(3, 0.12), pos: [x - 0.3, shaftBottomY + 1.0, z - 0.9], look: [x, 10, z], fov: 62 },
    /* Standing on the chamber floor, clear of the incline.

       The side of the room the camera can stand on is not a free choice any
       more: the incline out is a wedge of rock laid across the middle of the
       floor, and the first version of these three shots was composed before
       it existed -- all of them ended up inside it, which no still showed
       because a camera buried in rock renders the inside of the rock and
       that looks like an ordinary dark wall. Measured against the occupancy
       grid rather than judged by eye. */
    { p: A(3, 0.45), pos: [x - 4.0, chamberFloorY + 3.2, z - 3.8], look: [faceX, faceY, faceZ], fov: 62 },
    { p: A(3, 0.75), pos: [x - 0.6, chamberFloorY + 2.7, z - 3.6], look: [faceX, faceY, faceZ], fov: 58 },
    /* Turning off the face and onto the road out, which is what makes the
       next act a journey rather than a cut. */
    { p: A(3, 1.0), pos: [x - 0.9, chamberFloorY + 4.4, z - 4.3], look: [head.x, head.y + 1.8, head.z], fov: 64 },

    /* ACT 5 -- the discovery. Up the incline, down the drift, into the room.

       Every position is taken off the road itself, lifted to eye height above
       its floor. The drift climbs a block at a time and a camera flown along
       a straight line between two ends of it would be buried halfway. */
    { p: A(4, 0.1), pos: [head.x + dx * 1.5, head.y + 2.4, head.z + dz * 1.5], look: [head.x + dx * 7, head.y + 3.2, head.z + dz * 7], fov: 60 },
    { p: A(4, 0.42), pos: [rail[6].x, rail[6].y + 2.3, rail[6].z], look: [rail[11].x, rail[11].y + 3.0, rail[11].z], fov: 58 },
    { p: A(4, 0.7), pos: [rail[11].x, rail[11].y + 2.6, rail[11].z], look: [cry.x, cry.y + 4.5, cry.z], fov: 56 },
    /* The reveal. Off the axis and low, so the formation has the room behind
       it and the two figures in front of it have something to be in front
       OF -- dead centre it reads as a product shot. */
    /* Back at the mouth of the room, not in front of the find.

       At a block and a half off the middle the formation filled the frame
       edge to edge and stopped reading as an object in a space -- which is
       the whole of what a reveal is. From the way in there is ten blocks of
       floor between the lens and it, the two figures stand between the two,
       and the room has a far wall again. */
    { p: A(4, 1.0), pos: [cav.x - dx * 6.5 + px * 2.0, cav.floorY + 4.0, cav.z - dz * 6.5 + pz * 2.0], look: [cry.x, cry.y + 3.6, cry.z], fov: 60 },

    /* ACT 6 -- transformation. Behind the loaded cart, then alongside it.

       The offsets across the way are SMALL, and that is the constraint the
       first pass got wrong: the drift is five blocks wide, so its centre
       line has two blocks of air either side and a camera set 2.3 across is
       already in the wall. In the room the limit is the formation instead,
       which is why the first of these stands back toward the mouth. */
    { p: A(5, 0.3), ...trail(A(5, 0.3), 5.0, 1.1, 2.5), fov: 58 },
    { p: A(5, 1.0), ...trail(A(5, 1.0), 5.5, 1.1, 2.3), fov: 56 },

    /* ACT 7 -- the return. At the head of the incline the camera turns and
       looks up the shaft, and the only thing in the frame is the daylight at
       the top of it. */
    { p: A(6, 0.2), pos: [head.x + dx * -1.2, head.y + 2.2, head.z + dz * -1.2 + 1.2], look: [x, 24, z], fov: 66 },
    { p: A(6, 0.62), pos: [x - 0.8, 21, z + 0.6], look: [x, 31, z], fov: 64 },
    { p: A(6, 1.0), pos: [x + 1.0, floorY + 1.4, z - 0.6], look: [x, rimY, z + 3], fov: 58 },

    /* ACT 8 -- the outcome. Out of the pit and up, finishing above the
       island rather than on it. Higher and tighter than the opening frame,
       and from the lit flank: the last thing the visitor sees should be the
       world they started in, in daylight, from somewhere they have not
       stood before. */
    { p: A(7, 0.2), pos: [9, 47, 18], look: [x, 36, z], fov: 54 },
    { p: A(7, 0.62), pos: [26, 58, 40], look: [0, 28, 0], fov: 52 },
    { p: 1.0, pos: [44, 74, 62], look: [0, 22, 0], fov: 52 },
  ];

  return shots;
}

function spline(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3)
  );
}

export type Frame = { pos: V3; look: V3; fov: number };

/** The camera at a given scroll progress. Pure, and defined for every p. */
export function sampleShots(shots: Shot[], p: number): Frame {
  const q = Math.min(1, Math.max(0, p));

  let i = 0;
  while (i < shots.length - 2 && q > shots[i + 1].p) i++;

  const k1 = shots[i];
  const k2 = shots[i + 1];
  /* Ends are clamped by repeating the terminal shot rather than extrapolating
     one. An invented control point outside the list makes the spline overshoot
     at p = 0, and the frame the page opens on would not be the frame that was
     composed. */
  const k0 = shots[Math.max(0, i - 1)];
  const k3 = shots[Math.min(shots.length - 1, i + 2)];

  const span = k2.p - k1.p || 1;
  const t = Math.min(1, Math.max(0, (q - k1.p) / span));

  const pos: V3 = [0, 0, 0];
  const look: V3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    pos[a] = spline(k0.pos[a], k1.pos[a], k2.pos[a], k3.pos[a], t);
    look[a] = spline(k0.look[a], k1.look[a], k2.look[a], k3.look[a], t);
  }
  /* Field of view is interpolated straight. A spline through it overshoots on
     the way into the shaft, and an overshooting fov is a lens breathing. */
  const fov = k1.fov + (k2.fov - k1.fov) * t;

  return { pos, look, fov };
}

/** Depth below the original ground at the pit, in metres. */
export function depthAt(y: number, mine: MineInfo) {
  return Math.max(0, (mine.rimY - y) * METRES_PER_BLOCK);
}

/** Which band the camera is passing through, for the readout.

    Read off the same two constants the fill uses. Writing the thresholds out
    again here is how a readout ends up confidently naming the wrong rock:
    the bands moved to a flat datum and a copy of the old numbers would still
    have called the pit floor stone. */
export function stratumAt(y: number, mine: MineInfo) {
  if (y > mine.rimY - 1) return "Surface";
  if (y > mine.rimY - 2) return "Topsoil";
  if (y >= STONE_Y) return "Stone";
  if (y > DEEP_Y) return "Rock";
  return "Deep rock";
}
