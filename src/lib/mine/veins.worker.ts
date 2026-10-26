/* ----------------------------------------------------------------------------
   VEIN GENERATION, OFF THE MAIN THREAD

   Growing the structure costs ~160 ms on a fast desktop, which is perhaps
   600 ms on a mid-range phone. Run on the main thread that is a visible stall
   in whatever the visitor was doing — scrolling, tapping a link — for a
   decoration. So it runs here instead, and the section shows its CSS fallback
   until the result arrives.

   The arrays are TRANSFERRED rather than copied. structuredClone would
   duplicate about a megabyte of Float32 on both sides of the boundary, which
   is most of the cost we just moved off the main thread. After a transfer the
   worker's own view of those buffers is detached, which is fine: it has no
   further use for them and builds fresh arrays on the next request.
-------------------------------------------------------------------------------*/

import { buildVeins, type VeinGeometry, type VeinOptions } from "./veins";

self.addEventListener("message", (event: MessageEvent<VeinOptions>) => {
  let geometry: VeinGeometry;
  try {
    geometry = buildVeins(event.data ?? {});
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  self.postMessage(geometry, {
    transfer: [
      geometry.position.buffer,
      geometry.along.buffer,
      geometry.depth.buffer,
      geometry.level.buffer,
      geometry.thickness.buffer,
      geometry.seed.buffer,
      geometry.ore.buffer,
      geometry.anchorDepth.buffer,
    ],
  });
});
