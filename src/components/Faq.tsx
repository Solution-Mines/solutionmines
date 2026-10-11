type Props = { items: { question: string; answer: string }[]; heading?: string };

/* Built on <details>/<summary>.

   That choice is deliberate: it gives correct expand/collapse semantics,
   keyboard operation and screen-reader announcement for free, works with
   JavaScript disabled, and is findable by in-page browser search in current
   browsers. A hand-rolled ARIA accordion would be more code and less robust. */
export function Faq({ items, heading = "Questions we get" }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="section" aria-labelledby="faq-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>FAQ</span>
          <span className="u-eyebrow">{heading}</span>
        </div>
        <h2 id="faq-heading" className="u-sr-only">{heading}</h2>
        <div className="faq">
          {items.map((item) => (
            <details key={item.question} className="faq__item">
              <summary className="faq__q">
                <span>{item.question}</span>
                <span className="faq__icon" aria-hidden="true" />
              </summary>
              <div className="faq__a">
                <p>{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
