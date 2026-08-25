"use client";

import { Toaster as Sonner } from "sonner";

/** App-wide toast host. Light theme only, matching the rest of the UI. */
export function Toaster() {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: "font-sans" } }}
    />
  );
}
