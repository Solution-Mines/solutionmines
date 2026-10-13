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

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  colorScheme: "dark",
};

/* Set `js` before first paint so the CSS-defined reveal hidden-states apply
   only when JS can actually un-hide them, and read the stored motion
   preference so there is no flash of motion. Blocking by design: it is ~200
   bytes and must run before the first frame. */
const BOOT = `(function(){var d=document.documentElement;d.classList.add('js');try{if(localStorage.getItem('sm-motion')==='reduced'){d.setAttribute('data-motion','reduced')}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>
        <a href="#main" className="u-skip">
          Skip to content
        </a>
        {children}
        <div className="u-atmosphere" aria-hidden="true" />
        <div className="u-grid-field" aria-hidden="true" />
        <div className="u-grain" aria-hidden="true" />
      </body>
    </html>
  );
}
