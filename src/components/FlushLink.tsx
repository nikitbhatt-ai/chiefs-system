"use client";

// A link that saves the estimate editor's pending changes before it
// navigates, opens or downloads — so a PDF, the configurator, or the
// print view always reflects what's on screen.

import { flushQuoteEditor } from "@/lib/quoteFlush";

export function FlushLink({
  href,
  newTab = false,
  className,
  title,
  children,
}: {
  href: string;
  newTab?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks (open in new tab, etc.) behave natively.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!(await flushQuoteEditor())) return;
    if (newTab) window.open(href, "_blank", "noopener");
    else window.location.href = href;
  };
  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener" : undefined}
      onClick={onClick}
      className={className}
      title={title}
    >
      {children}
    </a>
  );
}
