/* ----------------------------------------------------------------------------
   THE WORLD, BUILT OFF THE MAIN THREAD

   The island is half a million cells: filled, carved, flooded with light
   twice and walked face by face. On the main thread that is a stall of a few
   hundred milliseconds on a fast desktop and a second or more on a phone,
   while the page is trying to answer its first scroll. Here it costs the
   visitor nothing but the wait for the picture.

   Every typed array is TRANSFERRED rather than copied: structured cloning
   would duplicate several megabytes on both sides of the boundary, which is
   most of the cost this file exists to move. The worker has no further use
   for them once they are sent.
-------------------------------------------------------------------------------*/

import { buildTerrain, type VoxelTerrain } from "./terrain";
import { buildAtlas, type Atlas } from "./atlas";

self.addEventListener(
  "message",
  (event: MessageEvent<{ seed?: number; falls?: boolean }>) => {
    const t0 = performance.now();
    let terrain: VoxelTerrain;
    try {
      terrain = buildTerrain(event.data?.seed ?? 0x7a19, {
        falls: event.data?.falls ?? true,
        // The loading screen's bar: posted as each stage of the build begins.
        onProgress: (done, stage) => self.postMessage({ progress: done, stage }),
      });
    } catch (error) {
      self.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const ms = performance.now() - t0;
    /* The textures as well: painting them is a tenth of a second of pure
       arithmetic that the page used to do twice on its main thread -- once
       for the scene, once for the hotbar's icons. */
    let atlas: Atlas | null = null;
    try {
      atlas = buildAtlas();
    } catch {
      // The page paints its own if this one is missing.
    }
    const t = terrain;
    self.postMessage(
      { terrain, ms, atlas },
      {
        transfer: [
          t.offset.buffer,
          t.material.buffer,
          t.ao.buffer,
          t.tint.buffer,
          t.faceOffset.buffer,
          t.faceDir.buffer,
          t.faceMaterial.buffer,
          t.faceAo.buffer,
          t.faceTint.buffer,
          t.faceTile.buffer,
          t.faceCornerAO.buffer,
          t.faceLightW.buffer,
          t.faceLightC.buffer,
          t.faceHalf.buffer,
          t.faceAoOpen.buffer,
          t.cells.buffer,
          t.lightW.buffer,
          t.lightC.buffer,
          t.daylight.buffer,
          t.daylightOpen.buffer,
          t.site.plants.buffer,
          ...(atlas ? atlas.levels.map((l) => l.buffer) : []),
        ],
      },
    );
  },
);
