import Link from "next/link";
import { mainNav } from "@/config/site";

/* ----------------------------------------------------------------------------
   404

   This file was the last survivor of the first art direction: it hardcoded a
   serif face and a palette of literal hex values, so after the redesign it was
   the only page on the site in a different typeface and a different warm grey.

   Worse, it rendered its own <html> and <body>. The root layout already wraps
   this route, so those were NESTED inside the real document — invalid markup
   that browsers silently unwrap, taking the font variables and the design
   system with it. That is why the headline rendered in Georgia.

   Now it is an ordinary page built from the same tokens as everything else. On
   a small site a designed 404 is a disproportionately strong craft signal, and
   it is the one page a visitor reaches when something has already gone wrong —
   so it offers routes out rather than an apology.
-------------------------------------------------------------------------------*/
export default function NotFound() {
  return (
    <main id="main" className="nf">
      <div className="shell nf__inner">
        <p className="u-eyebrow nf__code">404 — not found</p>

        <h1 className="t-display-lg nf__title">That page does not exist.</h1>

        <p className="nf__lede">
          It may have moved, or the link may be wrong. Nothing here is lost —
          everything the site has is one of these:
        </p>

        <ul className="nf__links">
          {[
            { href: "/", label: "Home" },
            ...mainNav,
            { href: "/contact", label: "Start a project" },
          ].map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="nf__link">
                <span className="nf__link-arrow" aria-hidden="true">
                  &rarr;
                </span>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
