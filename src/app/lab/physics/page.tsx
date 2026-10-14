import Link from "next/link";
import "./physics.css";
import { LabScope } from "@/components/lab/LabScope";
import { PhysicsField, type Chip } from "@/components/lab/PhysicsField";
import { situations } from "@/content/site";
import { getServices } from "@/lib/content";

export const metadata = {
  title: "03 — Tactile",
};

export default function PhysicsPage() {
  const services = getServices();

  /* Services are the heavy bodies, the tools they are built with are the light
     ones — so the pile sorts itself by what matters, physically. */
  const chips: Chip[] = [
    ...services.map<Chip>((s) => ({
      label: s.data.shortTitle ?? s.data.title,
      weight: "heavy",
    })),
    ...Array.from(
      new Set(
        services.flatMap((s) => (s.data.technologies ?? []).map((t) => t.name)),
      ),
    ).map<Chip>((label) => ({ label, weight: "light" })),
  ];

  return (
    <LabScope className="phys-scope">
      <div className="phys">
        <section className="phys-hero">
          <div>
            <p className="phys-hero__eyebrow">Direction 03 — tactile</p>
            <h1>Things we build have weight.</h1>
            <p className="phys-hero__lede">
              Every item in that frame is a rigid body in a real solver. Pick one
              up, throw it, stack them. The four in white are what we do; the
              rest is what we do it with.
            </p>
            <div className="phys-hero__actions">
              <Link href="/contact" className="phys-btn">
                Start a project
              </Link>
              <Link href="/how-we-work" className="phys-btn phys-btn--ghost">
                How we work
              </Link>
            </div>
          </div>

          <div>
            <PhysicsField chips={chips} />
            <p className="phys-caption">
              Drag to throw · {chips.length} bodies · solver runs only in view
            </p>
          </div>
        </section>

        <section className="phys-sec" aria-labelledby="phys-sit">
          <h2 id="phys-sit">Where we usually come in</h2>
          <p className="phys-sec__lede">
            Four sentences we hear almost word for word, and what each one
            actually turns out to be.
          </p>

          <ul className="phys-cards">
            {situations.map((s) => (
              <li key={s.quote} className="phys-card">
                <p className="phys-card__quote">&ldquo;{s.quote}&rdquo;</p>
                <p className="phys-card__reframe">{s.reframe}</p>
                <p className="phys-card__tag">
                  <Link href={s.href}>{s.service} →</Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </LabScope>
  );
}
