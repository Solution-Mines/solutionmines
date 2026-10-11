import { MotionProvider } from "@/lib/motion/MotionProvider";
import { Nav } from "@/components/Nav";
import { Trace } from "@/components/Trace";
import { Footer } from "@/components/Footer";
import { MotionToggle } from "@/components/MotionToggle";

/* Shared chrome for every public page.

   MotionProvider is a Client Component, but `children` is passed through as a
   prop — so every page below stays a Server Component and ships no JavaScript
   of its own. Only Nav, Trace and MotionToggle hydrate. */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionProvider>
      <Nav />
      <Trace />
      <main id="main">{children}</main>
      <Footer />
      <MotionToggle />
    </MotionProvider>
  );
}
