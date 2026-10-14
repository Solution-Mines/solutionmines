"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* Split out as a client component purely so the layout itself stays a server
   component — `usePathname` is the only thing here that needs the client. */
export function LabTabs({
  items,
}: {
  items: { slug: string; name: string }[];
}) {
  const pathname = usePathname();

  return (
    <ul className="lab-bar__tabs">
      {items.map((item) => {
        const href = `/lab/${item.slug}`;
        const active = pathname === href;
        return (
          <li key={item.slug}>
            <Link
              href={href}
              className="lab-bar__tab"
              aria-current={active ? "page" : undefined}
            >
              {item.name}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
