/* Renders a consolidated JSON-LD @graph.

   Uses a plain <script> rather than next/script: structured data must be in
   the server-rendered HTML for crawlers, and next/script defers it. */
export function StructuredData({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // The payload is built from our own typed content, never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
