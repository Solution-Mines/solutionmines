import type { Metadata } from "next";
import Link from "next/link";
import "./lab.css";
import { prototypes } from "./prototypes";
import { LabTabs } from "@/components/lab/LabTabs";

export const metadata: Metadata = {
  title: "Design lab",
  description: "Four art-direction prototypes, side by side.",
  robots: { index: false, follow: false },
};

export default function LabLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="lab">
      {/* Deliberately NOT the marketing <Nav>. These routes are a comparison
          surface; the production chrome would bias every judgement toward the
          direction the current site already uses. */}
      <header className="lab-bar">
        <Link href="/lab" className="lab-bar__home">
          SolutionMines / lab
        </Link>
        <LabTabs items={prototypes.map((p) => ({ slug: p.slug, name: p.name }))} />
      </header>

      <main id="main">{children}</main>

      <footer className="lab-foot">
        <span>Prototypes — not the live site. Nothing here is indexed.</span>
        <Link href="/">← back to solutionmines.com</Link>
      </footer>
    </div>
  );
}
