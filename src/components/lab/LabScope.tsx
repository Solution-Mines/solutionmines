"use client";

import { useEffect } from "react";

/* Each prototype re-colours the shared lab chrome (the sticky tab bar and the
   footer) to its own palette. Those elements live in the layout, above this
   page in the tree, so a wrapper class cannot reach them — the variables have
   to be written onto the layout's own root.

   Deliberately an effect rather than a render-time mutation: it must not run
   during render, and it must restore cleanly when you switch prototypes. */
export function LabScope({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const root = document.querySelector(".lab");
    if (!root) return;
    root.classList.add(className);
    return () => root.classList.remove(className);
  }, [className]);

  return <>{children}</>;
}
