import type { Metadata } from "next";
import { MineView } from "./MineView";

/* Not public work. Same stance as the prototype lab: a development route is
   not a page anyone should reach from a search result, and noindex is how you
   say so — a robots.txt Disallow would stop the crawler from ever SEEING the
   noindex, which is strictly worse. */
export const metadata: Metadata = {
  title: "Mine sequence (development)",
  robots: { index: false, follow: false },
};

export default function MinePage() {
  return (
    <div
      className="mine-dark"
      data-surface="dark"
      style={{ backgroundColor: "var(--color-ink-1000)" }}
    >
      <MineView />
    </div>
  );
}
