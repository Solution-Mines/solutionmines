import Link from "next/link";
import "./liquid.css";
import { ShaderCanvas } from "@/components/lab/ShaderCanvas";
import { LIQUID_FRAG } from "@/components/lab/liquid.frag";
import { LabScope } from "@/components/lab/LabScope";
import { stages } from "@/content/site";

export const metadata = {
  title: "02 — Liquid field",
};

export default function LiquidPage() {
  return (
    <LabScope className="liq-scope">
      <div className="liq">
        <section className="liq-hero">
          <div className="liq-hero__fallback" aria-hidden="true" />
          <ShaderCanvas fragment={LIQUID_FRAG} className="liq-hero__canvas" />

          <p className="liq-hero__eyebrow">Direction 02 — liquid field</p>

          <h1>
            Systems that hold together under <strong>load</strong>.
          </h1>

          <p className="liq-hero__lede">
            We design, build and maintain the software other businesses run on.
            The field behind this text is being solved per pixel, in real time,
            with your cursor as one of its six sources.
          </p>

          <div className="liq-actions">
            <Link href="/contact" className="liq-btn">
              Start a project
            </Link>
            <Link href="/work" className="liq-btn liq-btn--ghost">
              See the work
            </Link>
          </div>

          <p className="liq-hint">Move the pointer — the geometry re-solves.</p>
        </section>

        <section className="liq-sec" aria-labelledby="liq-stages">
          <div className="liq-sec__head">
            <h2 id="liq-stages">How the work actually runs</h2>
            <p>
              Five stages, and the artefact you hold at the end of each one.
              Stage names alone are not a process; the thing you receive is.
            </p>
          </div>

          <ol className="liq-stages">
            {stages.map((stage) => (
              <li key={stage.index} className="liq-stage">
                <span className="liq-stage__dot" aria-hidden="true" />
                <span className="liq-stage__no">{stage.index}</span>
                <h3 className="liq-stage__name">{stage.name}</h3>
                <p className="liq-stage__body">{stage.body}</p>
                <p className="liq-stage__artifact">
                  <span>You get</span>
                  {stage.artifact}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </LabScope>
  );
}
