"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * A submit button that asks first.
 *
 * Lives inside a plain `<form action={serverAction}>` so the page stays a
 * server component. On confirm it submits the enclosing form with itself as
 * the submitter, so a `name`/`value` on the button still reaches the action.
 */
export function ConfirmSubmitButton({
  title,
  description,
  confirmLabel = "Excluir",
  children,
  onClick,
  ...props
}: ButtonProps & {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { pending } = useFormStatus();

  return (
    <>
      <Button
        ref={ref}
        type="submit"
        disabled={pending}
        {...props}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={props.variant === "destructive" || props.variant === undefined}
        onConfirm={() => {
          setOpen(false);
          const button = ref.current;
          button?.form?.requestSubmit(button);
        }}
      />
    </>
  );
}
