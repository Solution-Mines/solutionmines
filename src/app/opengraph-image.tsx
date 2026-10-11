import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Build-time OG image, rendered via ImageResponse — no external service and
   no recurring cost.

   The link to this site will be pasted into Slack and WhatsApp constantly
   during early outreach, and a blank or cropped-favicon preview reads as
   broken. Type is kept large because the card is often displayed around
   300px wide. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#faf9f6",
          padding: "72px 80px",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 40, height: 3, backgroundColor: "#b8371f" }} />
          <div
            style={{
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "#6e6e66",
              fontFamily: "monospace",
            }}
          >
            Software engineering
          </div>
        </div>

        <div
          style={{
            fontSize: 78,
            lineHeight: 1.04,
            letterSpacing: -2,
            color: "#141511",
            maxWidth: 940,
            display: "flex",
          }}
        >
          We design, build and maintain the software other businesses run on.
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: "1px solid #e2ded5",
            paddingTop: 28,
          }}
        >
          {/* Satori requires an explicit display on any node with more than
              one child — it has no block-layout fallback. */}
          <div style={{ display: "flex", fontSize: 34, color: "#141511" }}>
            <span>SolutionMines</span>
            <span style={{ color: "#b8371f" }}>.</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#6e6e66",
              fontFamily: "monospace",
            }}
          >
            solutionmines
          </div>
        </div>
      </div>
    ),
    size,
  );
}
