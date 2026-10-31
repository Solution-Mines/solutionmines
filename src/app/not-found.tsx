import Link from "next/link";
import "./voxel/voxel.css";

/* ----------------------------------------------------------------------------
   404

   The earlier pages' addresses are redirected to the journey (next.config.ts),
   so this is only reached by an address that never existed. It speaks the
   journey's language -- a card over its sky, a block button -- and offers the
   one way on there is.
-------------------------------------------------------------------------------*/
export default function NotFound() {
  return (
    <main id="main" className="vx vx-lost">
      <div className="vx__card">
        <p className="vx__kicker">404 — not found</p>
        <h1 className="vx__title">There is nothing at this address.</h1>
        <p className="vx__body">
          The link may be wrong, or the page may have moved. Everything this
          site has is on the island.
        </p>
        <div className="vx__actions">
          <Link href="/" className="vx__btn vx__btn--go">
            Back to the island
          </Link>
        </div>
      </div>
    </main>
  );
}
