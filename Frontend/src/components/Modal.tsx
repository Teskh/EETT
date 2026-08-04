import { type PropsWithChildren, type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

type ModalProps = PropsWithChildren<{
  open: boolean;
  title: ReactNode;
  kicker: ReactNode;
  onClose: () => void;
  panelClassName?: string;
}>;

export function Modal({ open, title, kicker, onClose, panelClassName, children }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    // Locking the body hides its scrollbar; pad the gap back in so the page
    // underneath does not jump sideways when the modal opens.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const previousPaddingRight = document.body.style.paddingRight;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  // Rendered in a portal so the overlay escapes the app shell's stacking and
  // backdrop-filter contexts: nesting one backdrop blur inside another is what
  // washed the sidebar and header out to flat gray.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        className="modal-scrim absolute inset-0 w-full h-full border-0 p-0 cursor-default"
        onClick={onClose}
        aria-label="Cerrar modal"
      />
      <section
        role="dialog"
        aria-modal="true"
        className={`modal-panel relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-zinc-900 border border-black/[0.07] dark:border-white/10 rounded-2xl p-6 z-10 shadow-2xl shadow-zinc-950/15 dark:shadow-black/60 ${panelClassName || ""}`}
      >
        <div className="flex items-start justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6">
          <div>
            <p className="text-[10px] font-bold text-accent-600 dark:text-accent-500 uppercase tracking-widest mb-1 flex items-center gap-2">
              <i className="ph-bold ph-pencil-simple" /> {kicker}
            </p>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">{title}</h3>
          </div>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            onClick={onClose}
          >
            <i className="ph-bold ph-x" />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
