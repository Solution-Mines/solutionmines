/* ----------------------------------------------------------------------------
   THE MINER

   One figure, built from boxes, described here as data and nowhere else.

   WHY A FINER GRID THAN THE TERRAIN
   The island is made of one-unit blocks. This figure is made of pieces about
   a twentieth of that. That is deliberate and it is the normal convention for
   voxel work: terrain is coarse because it is landscape, characters are fine
   because a person built from one-unit blocks at this camera distance is four
   cubes tall and reads as a crate. The two grids relate -- the figure is
   almost exactly two terrain blocks tall -- so he still belongs to the world.

   WHY HE IS THE SIZE HE IS
   Nothing in this scene has ever had a known size. A 48-block island could be
   a desk ornament or a county, and until now there was no way to tell. The
   whole job of this first figure is to settle that, which is why his height
   is normalised: the part list below can be rearranged freely and the figure
   still comes out exactly as tall as it was asked to be.

   WHAT HE IS NOT
   Not a Minecraft skin. The proportions are deliberately away from that --
   narrower shoulders, a smaller head, a brimmed safety helmet rather than a
   cube, and a high-visibility band. He reads as someone at work, which is the
   whole point: this is a site under survey, not a world to play in.
-------------------------------------------------------------------------------*/

/** The one saturated colour in the scene, and the site's own accent. */
const HIVIS: [number, number, number] = [1.0, 0.42, 0.24];
const JACKET: [number, number, number] = [0.24, 0.27, 0.32];
const TROUSER: [number, number, number] = [0.17, 0.19, 0.23];
const BOOT: [number, number, number] = [0.11, 0.11, 0.13];
/* Deliberately neutral. At fifty pixels there is no face to read, and a
   figure that is a silhouette doing a job needs no more than this. */
const SKIN: [number, number, number] = [0.42, 0.36, 0.31];
const PACK: [number, number, number] = [0.31, 0.23, 0.17];
const HAFT: [number, number, number] = [0.29, 0.2, 0.14];
const STEEL: [number, number, number] = [0.42, 0.45, 0.49];
const LAMP: [number, number, number] = [1.0, 0.86, 0.58];

export type MinerPart = {
  /** Centre, in local units. Feet at y = 0, facing +Z, +X to his right. */
  at: [number, number, number];
  size: [number, number, number];
  color: [number, number, number];
  /** Baked ambient darkening, lower nearer the ground. One value per part
      rather than per face: the six faces are already separated by the shared
      lighting function, and this only has to supply the vertical gradient
      that stops a standing figure reading as a flat cut-out. */
  ao: number;
  /** Self-lit. The helmet lamp and nothing else. */
  emit?: number;
  /** Left out of the height normalisation. The pick stands above the helmet
      and the height that was asked for is the figure's, not the tool's. */
  tool?: boolean;
};

/* --- the figure, at rest ----------------------------------------------------
   An idle pose, not a symmetrical one. The right arm is forward of the left
   and the pick rides on that shoulder, because a figure built symmetrically
   about its own centre line reads as a mannequin however well it is lit. */
export const MINER_PARTS: MinerPart[] = [
  // feet
  { at: [-0.072, 0.034, 0.014], size: [0.098, 0.068, 0.128], color: BOOT, ao: 0.6 },
  { at: [0.072, 0.034, 0.014], size: [0.098, 0.068, 0.128], color: BOOT, ao: 0.6 },
  // legs
  { at: [-0.072, 0.21, 0.0], size: [0.086, 0.3, 0.105], color: TROUSER, ao: 0.72 },
  { at: [0.072, 0.21, 0.0], size: [0.086, 0.3, 0.105], color: TROUSER, ao: 0.72 },
  // body
  { at: [0.0, 0.535, 0.0], size: [0.25, 0.35, 0.155], color: JACKET, ao: 0.88 },
  /* The band is a shade proud of the jacket on every axis. Two coplanar
     faces z-fight, and a stripe that flickers is worse than no stripe. */
  { at: [0.0, 0.585, 0.0], size: [0.258, 0.045, 0.163], color: HIVIS, ao: 0.9 },
  { at: [0.0, 0.575, -0.112], size: [0.17, 0.21, 0.075], color: PACK, ao: 0.78 },
  // arms, the right one carried forward
  { at: [-0.158, 0.525, 0.004], size: [0.066, 0.31, 0.086], color: JACKET, ao: 0.82 },
  { at: [0.158, 0.525, 0.022], size: [0.066, 0.31, 0.086], color: JACKET, ao: 0.84 },
  // head and helmet
  { at: [0.0, 0.79, 0.004], size: [0.152, 0.16, 0.148], color: SKIN, ao: 0.92 },
  { at: [0.0, 0.9, 0.0], size: [0.196, 0.08, 0.186], color: HIVIS, ao: 0.97 },
  /* The brim is what makes it a safety helmet instead of a hat, and at this
     distance it is most of what says "this person is working". */
  { at: [0.0, 0.873, 0.108], size: [0.206, 0.03, 0.078], color: HIVIS, ao: 0.93 },
  { at: [0.0, 0.9, 0.102], size: [0.056, 0.046, 0.05], color: LAMP, ao: 1, emit: 1 },

  /* The pick, over the right shoulder. Stepped rather than rotated: a
     staircase of small boxes is how voxel work draws a diagonal, it needs no
     rotation support in the shader, and it keeps the whole figure to a single
     instanced draw of axis-aligned boxes. */
  { at: [0.225, 0.46, -0.03], size: [0.05, 0.1, 0.05], color: HAFT, ao: 0.8, tool: true },
  { at: [0.267, 0.55, -0.03], size: [0.05, 0.1, 0.05], color: HAFT, ao: 0.82, tool: true },
  { at: [0.309, 0.64, -0.03], size: [0.05, 0.1, 0.05], color: HAFT, ao: 0.84, tool: true },
  { at: [0.351, 0.73, -0.03], size: [0.05, 0.1, 0.05], color: HAFT, ao: 0.86, tool: true },
  /* Narrower and duller than the first pass. At this size the eye goes to
     whatever is brightest, and a broad pale bar beat the helmet to it --
     which put the emphasis on the tool rather than on the person. */
  { at: [0.351, 0.805, -0.03], size: [0.17, 0.055, 0.062], color: STEEL, ao: 0.9, tool: true },
];

/* --- the wind-up ------------------------------------------------------------
   The same parts in the same order, with a handful moved. Same order matters:
   the two poses are blended per box in the vertex shader, so part 8 of one
   list must be the same arm as part 8 of the other. Deriving the second pose
   from the first by index is what guarantees that -- two hand-written lists
   would drift the moment either is edited.

   This is a POSE, not an animation system. One extra set of positions and a
   single blend factor; there is no rig, no channel table and no curve
   evaluation. Phase 1 can replace it wholesale without unpicking anything. */
const RAISED: Record<number, Partial<MinerPart>> = {
  // lean back into the swing
  4: { at: [0.0, 0.535, -0.035] },
  5: { at: [0.0, 0.585, -0.035] },
  // both arms up and across
  7: { at: [-0.145, 0.63, 0.055], size: [0.066, 0.26, 0.086] },
  8: { at: [0.15, 0.655, 0.03], size: [0.066, 0.26, 0.086] },
  // the haft swung up and back over the shoulder
  13: { at: [0.135, 0.735, 0.0] },
  14: { at: [0.105, 0.83, -0.075] },
  15: { at: [0.075, 0.915, -0.155] },
  16: { at: [0.045, 0.995, -0.235] },
  17: { at: [0.02, 1.05, -0.305], size: [0.17, 0.055, 0.062] },
};

export const MINER_RAISED: MinerPart[] = MINER_PARTS.map((p, i) => ({
  ...p,
  ...(RAISED[i] ?? {}),
}));


/* --- the pose library -------------------------------------------------------
   Every pose is an OVERRIDE MAP against MINER_PARTS, keyed by index, and is
   turned into a part list by the one function below.

   Index-keyed and nowhere else, because the two lists a figure is built from
   are blended per box in the vertex shader: box 8 of the first list must be
   the same arm as box 8 of the second. Two hand-written lists satisfy that
   on the day they are written and stop satisfying it the first time either
   is edited, and the failure is a figure whose elbow turns into its boot.

   Composable on purpose. The lamp bearer walks AND holds a lantern up, and
   those are two independent facts about him; writing a fifth list that is
   the sum of two others is how pose libraries become unmaintainable. */
export function pose(
  ...overrides: Array<Record<number, Partial<MinerPart>>>
): MinerPart[] {
  return MINER_PARTS.map((p, i) =>
    Object.assign({}, p, ...overrides.map((o) => o[i] ?? {})),
  );
}

/** Arm forward and level: surveying, calling a line, pointing something out. */
export const P_POINT: Record<number, Partial<MinerPart>> = {
  4: { at: [0.0, 0.535, 0.02] },
  5: { at: [0.0, 0.585, 0.02] },
  8: { at: [0.15, 0.60, 0.15], size: [0.066, 0.078, 0.3] },
  9: { at: [0.0, 0.79, 0.03] },
  10: { at: [0.0, 0.9, 0.026] },
  11: { at: [0.0, 0.873, 0.134] },
  12: { at: [0.0, 0.9, 0.128] },
  // The pick comes off the shoulder and hangs at the hip.
  13: { at: [0.2, 0.3, -0.07] },
  14: { at: [0.2, 0.4, -0.07] },
  15: { at: [0.2, 0.5, -0.07] },
  16: { at: [0.2, 0.6, -0.07] },
  17: { at: [0.2, 0.665, -0.07] },
};

/** Down on one knee: inspecting the ground, working a crate, loading. */
export const P_CROUCH: Record<number, Partial<MinerPart>> = {
  0: { at: [-0.072, 0.03, 0.08] },
  1: { at: [0.082, 0.028, -0.03] },
  2: { at: [-0.072, 0.135, 0.055], size: [0.086, 0.17, 0.105] },
  3: { at: [0.082, 0.12, -0.02], size: [0.086, 0.15, 0.105] },
  4: { at: [0.0, 0.37, 0.03] },
  5: { at: [0.0, 0.42, 0.03] },
  6: { at: [0.0, 0.41, -0.082] },
  7: { at: [-0.15, 0.3, 0.105], size: [0.066, 0.2, 0.086] },
  8: { at: [0.15, 0.3, 0.105], size: [0.066, 0.2, 0.086] },
  9: { at: [0.0, 0.625, 0.034] },
  10: { at: [0.0, 0.735, 0.03] },
  11: { at: [0.0, 0.708, 0.138] },
  12: { at: [0.0, 0.735, 0.132] },
  13: { at: [0.225, 0.26, -0.03] },
  14: { at: [0.267, 0.35, -0.03] },
  15: { at: [0.309, 0.44, -0.03] },
  16: { at: [0.351, 0.53, -0.03] },
  17: { at: [0.351, 0.605, -0.03] },
};

/** Leaning into something heavy, both hands low and forward. */
export const P_PUSH: Record<number, Partial<MinerPart>> = {
  0: { at: [-0.072, 0.034, 0.1] },
  1: { at: [0.072, 0.034, -0.07] },
  2: { at: [-0.072, 0.21, 0.07] },
  3: { at: [0.072, 0.21, -0.05] },
  4: { at: [0.0, 0.52, 0.06] },
  5: { at: [0.0, 0.57, 0.06] },
  6: { at: [0.0, 0.56, -0.05] },
  7: { at: [-0.15, 0.5, 0.17], size: [0.066, 0.072, 0.3] },
  8: { at: [0.15, 0.5, 0.17], size: [0.066, 0.072, 0.3] },
  9: { at: [0.0, 0.76, 0.08] },
  10: { at: [0.0, 0.87, 0.075] },
  11: { at: [0.0, 0.843, 0.183] },
  12: { at: [0.0, 0.87, 0.177] },
};

/** Both arms up. The reaction at the face, and the top of a lift. */
export const P_LIFT: Record<number, Partial<MinerPart>> = {
  7: { at: [-0.168, 0.7, 0.015], size: [0.066, 0.27, 0.086] },
  8: { at: [0.168, 0.7, 0.015], size: [0.066, 0.27, 0.086] },
  9: { at: [0.0, 0.8, 0.008] },
  10: { at: [0.0, 0.91, 0.004] },
  11: { at: [0.0, 0.883, 0.112] },
  12: { at: [0.0, 0.91, 0.106] },
};

/** Mid-stride, left foot leading. Its mirror is the other half of a walk. */
export const P_STRIDE_A: Record<number, Partial<MinerPart>> = {
  0: { at: [-0.072, 0.038, 0.11] },
  1: { at: [0.072, 0.03, -0.09] },
  2: { at: [-0.072, 0.215, 0.07] },
  3: { at: [0.072, 0.205, -0.06] },
  7: { at: [-0.158, 0.525, -0.07] },
  8: { at: [0.158, 0.525, 0.09] },
};

export const P_STRIDE_B: Record<number, Partial<MinerPart>> = {
  0: { at: [-0.072, 0.03, -0.09] },
  1: { at: [0.072, 0.038, 0.11] },
  2: { at: [-0.072, 0.205, -0.06] },
  3: { at: [0.072, 0.215, 0.07] },
  7: { at: [-0.158, 0.525, 0.09] },
  8: { at: [0.158, 0.525, -0.07] },
};

/** The pick taken out of a figure's hands. Zero-sized boxes rather than a
    shorter list: the two poses a figure is blended between have to stay the
    same length, and a degenerate box costs no pixels. */
export const P_NO_TOOL: Record<number, Partial<MinerPart>> = {
  13: { size: [0, 0, 0] },
  14: { size: [0, 0, 0] },
  15: { size: [0, 0, 0] },
  16: { size: [0, 0, 0] },
  17: { size: [0, 0, 0] },
};

/** A lantern carried high in the left hand, lighting the way forward. */
export const P_LANTERN: Record<number, Partial<MinerPart>> = {
  7: { at: [-0.175, 0.69, 0.04], size: [0.066, 0.28, 0.086] },
};

/** The lantern itself, appended rather than overridden -- it is a box the
    base figure does not have. Both poses of a bearer get it. */
export const LANTERN_BOX: MinerPart = {
  at: [-0.185, 0.5, 0.05],
  size: [0.1, 0.12, 0.1],
  color: LAMP,
  ao: 1,
  emit: 1,
};

export type MinerGeometry = {
  /** Per box: centre, dimensions, colour, ambient, self-lit. */
  part: Float32Array;
  size: Float32Array;
  color: Float32Array;
  ao: Float32Array;
  emit: Float32Array;
  /** Boxes, i.e. the instance count of the one draw this costs. */
  count: number;
  /** Height of the FIGURE in local units, tool excluded. Divide the height
      you want by this to get the scale the shader should apply. */
  unitHeight: number;
  /** The same boxes in the raised pose, for the shader to blend toward. */
  partB: Float32Array;
  sizeB: Float32Array;
};

export function buildMiner(parts: MinerPart[] = MINER_PARTS): MinerGeometry {
  const n = parts.length;
  const part = new Float32Array(n * 3);
  const size = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const ao = new Float32Array(n);
  const emit = new Float32Array(n);

  let unitHeight = 0;
  for (let i = 0; i < n; i++) {
    const p = parts[i];
    part[i * 3] = p.at[0];
    part[i * 3 + 1] = p.at[1];
    part[i * 3 + 2] = p.at[2];
    size[i * 3] = p.size[0];
    size[i * 3 + 1] = p.size[1];
    size[i * 3 + 2] = p.size[2];
    color[i * 3] = p.color[0];
    color[i * 3 + 1] = p.color[1];
    color[i * 3 + 2] = p.color[2];
    ao[i] = p.ao;
    emit[i] = p.emit ?? 0;
    if (!p.tool) unitHeight = Math.max(unitHeight, p.at[1] + p.size[1] / 2);
  }

  const partB = new Float32Array(n * 3);
  const sizeB = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const q = MINER_RAISED[i];
    partB[i * 3] = q.at[0];
    partB[i * 3 + 1] = q.at[1];
    partB[i * 3 + 2] = q.at[2];
    sizeB[i * 3] = q.size[0];
    sizeB[i * 3 + 1] = q.size[1];
    sizeB[i * 3 + 2] = q.size[2];
  }

  return { part, size, color, ao, emit, count: n, unitHeight, partB, sizeB };
}
