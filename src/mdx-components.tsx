import type { MDXComponents } from "mdx/types";

/* Next resolves this file (at the src/ root, not inside app/) as the MDX
   component map. Providing it is what lets @next/mdx avoid the
   @mdx-js/react provider, which builds on React context and therefore
   cannot be evaluated inside a Server Component. */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...components };
}
