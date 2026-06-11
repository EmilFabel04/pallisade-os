"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8 animate-fade"
      style={{ background: "rgba(5,5,6,0.72)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "panel w-full animate-rise my-auto",
          maxW,
        )}
        style={{ background: "var(--color-surface)", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)" }}
        role="dialog"
        aria-modal="true"
      >
        <div className="panel-head">
          <div className="min-w-0">
            <h2 className="text-[0.98rem] font-semibold text-[var(--color-ink)] truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[0.78rem] text-[var(--color-muted)] mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-[1.1rem] py-[1.1rem] max-h-[68vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-[1.1rem] py-[0.9rem] border-t border-[var(--color-line)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-accent"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[0.88rem] text-[var(--color-ink-soft)] leading-relaxed">{message}</p>
    </Modal>
  );
}
