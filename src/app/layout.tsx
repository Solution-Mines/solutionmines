import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/* Self-hosted OFL-1.1 variable fonts.
   `adjustFontFallback` makes Next generate a metric-matched local fallback
   (size-adjust / ascent-override), so the swap produces ~0 layout shift.
   On a type-led site this single setting is the difference between
   CLS ~0.15 and CLS ~0.00. */

const archivo = localFont({
  src: "../fonts/archivo-latin-wght-normal.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: "Arial",
  preload: true,
});

const geist = localFont({
  src: "../fonts/geist-latin-wght-normal.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: "Arial",
  preload: true,
});

const geistMono = localFont({
  src: "../fonts/geist-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: false,
  // Not preloaded: the mono only appears in below-the-fold labels.
  preload: false,
});

const SITE_NAME = "SolutionMines";
const SITE_DESC =
  "We design, build and maintain the software other businesses run on.";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — Software engineering for growing businesses`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  // PLACEHOLDER: replace with the live origin once the domain is confirmed.
  metadataBase: new URL("https://example.invalid"),
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Software engineering for growing businesses`,
    description: SITE_DESC,
  },
  robots: {
    // Prototype only — must never be indexed.
    index: false,
    follow: false,
  },
};

/* The journey's own night blue, which is also what shows past either end of
   the page and behind the browser's bar on a phone. */
export const viewport: Viewport = {
  themeColor: "#0b1016",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>
        <a href="#main" className="u-skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
