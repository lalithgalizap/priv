"use client";

/**
 * Lazy-loaded Markdown renderer. ``react-markdown`` + ``remark-gfm`` adds
 * roughly 60 KB gzipped to the JS bundle. Loading it only once a message is
 * actually rendered keeps initial page load fast.
 */

import dynamic from "next/dynamic";

const MarkdownInner = dynamic(() => import("./MarkdownInner"), {
  ssr: false,
  loading: () => null,
});

export default function LazyMarkdown({ children }: { children: string }) {
  return <MarkdownInner>{children}</MarkdownInner>;
}
