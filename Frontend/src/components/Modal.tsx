import { type PropsWithChildren, useEffect } from "react";

type ModalProps = PropsWithChildren<{
  open: boolean;
  title: string;
  kicker: string;
  onClose: () => void;
}>;

export function Modal({ open, title, kicker, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" aria-hidden={!open}>
      <button 
        type="button"
        className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm border-0 p-0 w-full h-full cursor-default" 
        onClick={onClose} 
        aria-label="Close modal" 
      />
      <section className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-900 border border-black/10 dark:border-white/10 rounded-2xl p-6 z-10">
        <div className="flex items-start justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6">
          <div>
            <p className="text-[10px] font-bold text-accent-600 dark:text-accent-500 uppercase tracking-widest mb-1 flex items-center gap-2">
              <i className="ph-bold ph-pencil-simple" /> {kicker}
            </p>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">{title}</h3>
          </div>
          <button 
            type="button" 
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/60 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:text-white transition-colors" 
            onClick={onClose}
          >
            <i className="ph-bold ph-x" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
