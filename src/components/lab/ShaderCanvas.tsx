"use client";

import { useEffect, useRef, useState } from "react";
import { mountFullscreenShader } from "@/lib/gl/fullscreen";

/* The canvas is decorative in the strict sense: every word on these pages is
   real DOM behind it. If WebGL2 is missing, if the shader fails to compile, or
   if JS never runs at all, the page loses a backdrop and nothing else — which
   is the only honest way to use a shader on a marketing site. */
export function ShaderCanvas({
  fragment,
  className,
  maxDpr,
}: {
  fragment: string;
  className?: string;
  maxDpr?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";

    return mountFullscreenShader(canvas, {
      fragment,
      maxDpr,
      // Reduced motion still gets the image — it just stops moving.
      still: reduced,
      onError: () => setFailed(true),
    });
  }, [fragment, maxDpr]);

  if (failed) return null;

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
