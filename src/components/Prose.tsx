/* Typographic wrapper for MDX bodies.

   Styling lives in a single `.prose` block in globals.css rather than being
   passed down as an MDX component map, so authored content picks up the type
   scale automatically and a new heading level can never arrive unstyled. */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="prose">{children}</div>;
}
