import Link from "next/link";
import "./dither.css";
import { ShaderCanvas } from "@/components/lab/ShaderCanvas";
import { DITHER_FRAG } from "@/components/lab/dither.frag";
import { LabScope } from "@/components/lab/LabScope";
import { getServices } from "@/lib/content";

export const metadata = {
  title: "01 — Dither",
};

export default function DitherPage() {
  const services = getServices();

  return (
    <LabScope className="dith-scope">
      <div className="dith">
        <section className="dith-hero">
          <div className="dith-hero__type">
            <div className="dith-hero__head">
              <span>SolutionMines</span>
              <span>Direction 01 / one-bit</span>
              <span>Plate 01</span>
            </div>

            <h1>
              We build the software other businesses <em>run on.</em>
            </h1>

            <div className="dith-hero__foot">
              <p className="dith-hero__lede">
                For teams who need a product shipped properly, an integration
                that stops breaking, or a codebase someone else abandoned.
              </p>
              <Link href="/contact" className="dith-cta">
                Start a project
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>

          <figure className="dith-plateframe">
            <div className="dith-hero__fallback" aria-hidden="true" />
            <ShaderCanvas
              fragment={DITHER_FRAG}
              className="dith-hero__canvas"
              maxDpr={1.25}
            />
            <figcaption className="dith-plateframe__cap">
              <span>8&times;8 ordered dither</span>
              <span>Move the cursor</span>
            </figcaption>
          </figure>
        </section>

        <section className="dith-sec" aria-labelledby="dith-caps">
          <div className="dith-sec__head">
            <h2 id="dith-caps">Capability index</h2>
            <span>{String(services.length).padStart(2, "0")} entries</span>
            <span style={{ marginLeft: "auto" }}>Plate density = coverage</span>
          </div>

          <ul className="dith-plates">
            {services.map(({ data }, i) => (
              <li key={data.slug} className="dith-plate">
                <Link
                  href={`/services/${data.slug}`}
                  className="dith-plate__link"
                >
                  <span className="dith-plate__no">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="dith-plate__name">{data.shortTitle ?? data.title}</span>
                  <span className="dith-plate__body">{data.summary}</span>
                  <span className="dith-plate__swatch" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </LabScope>
  );
}
