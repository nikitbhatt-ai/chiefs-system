"use client";

import { useEffect } from "react";

export function PrintTrigger() {
  useEffect(() => {
    const btn = document.getElementById("__print");
    if (!btn) return;
    const handler = () => window.print();
    btn.addEventListener("click", handler);
    return () => btn.removeEventListener("click", handler);
  }, []);
  return null;
}
