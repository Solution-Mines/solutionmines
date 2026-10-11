import Link from "next/link";
import { mainNav } from "@/config/site";

/* A designed 404. On a small site this is a disproportionately strong craft
   signal, and it is the one page a visitor reaches when something has already
   gone wrong — so it should offer routes out rather than an apology. */
export default function NotFound() {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeContent: "center",
          padding: "2rem",
          backgroundColor: "#faf9f6",
          color: "#141511",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: "36rem" }}>
          <p
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#b8371f",
              marginBottom: "1.5rem",
            }}
          >
            404 — not found
          </p>
          <h1
            style={{
              fontFamily: "ui-serif, Georgia, serif",
              fontSize: "clamp(2rem, 1rem + 4vw, 3.5rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              fontWeight: 400,
            }}
          >
            That page does not exist.
          </h1>
          <p style={{ marginTop: "1.25rem", color: "#5b5b54", lineHeight: 1.6 }}>
            It may have moved, or the link may be wrong. Here is everything
            else:
          </p>
          <ul
            style={{
              marginTop: "2rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "1.5rem",
              listStyle: "none",
              padding: 0,
            }}
          >
            {[{ href: "/", label: "Home" }, ...mainNav, { href: "/contact", label: "Start a project" }].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  style={{
                    color: "#141511",
                    textDecoration: "underline",
                    textUnderlineOffset: "0.2em",
                  }}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </main>
      </body>
    </html>
  );
}
