declare module "*.mdx" {
  import type { MDXProps } from "mdx/types";
  export const meta: Record<string, unknown>;
  export default function MDXContent(props: MDXProps): JSX.Element;
}
