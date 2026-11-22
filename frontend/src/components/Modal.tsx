import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  isLoading?: boolean;
  preventClose?: boolean;
}

interface SiblingIsolationRecord {
  element: Element;
  hadInert: boolean;
  ariaHidden: string | null;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return elements.filter((el) => {
    // 1. Direct or ancestor disabled state
    if (el.hasAttribute('disabled') || (el as HTMLButtonElement).disabled) return false;
    if (el.closest('fieldset[disabled]')) return false;

    // 2. Direct or ancestor hidden state
    if (el.hidden || el.closest('[hidden]')) return false;

    // 3. Direct or ancestor aria-hidden state
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) return false;

    // 4. Direct or ancestor inert state
    if (el.hasAttribute('inert') || (el as HTMLElement).inert || el.closest('[inert]')) return false;

    // 5. CSS display or visibility check (own and ancestors up to container)
    try {
      let current: HTMLElement | null = el;
      while (current && current !== container.parentElement) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        current = current.parentElement;
      }
    } catch {
      if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    }

    return true;
  });
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  isLoading = false,
  preventClose = false,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Keep latest callbacks/states available in stable event listeners
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isCloseBlocked = isLoading || preventClose;
  const isCloseBlockedRef = useRef(isCloseBlocked);
  isCloseBlockedRef.current = isCloseBlocked;

  useEffect(() => {
    if (!isOpen) return;

    // Capture previous active element for restoration on close
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // 1. Lock background scrolling
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 2. Background accessibility & interaction isolation via sibling inert / aria-hidden
    const currentOverlay = overlayRef.current;
    let isolationRecords: SiblingIsolationRecord[] = [];

    if (currentOverlay && document.body.contains(currentOverlay)) {
      const siblings = Array.from(document.body.children).filter(
        (child) => child !== currentOverlay
      );

      isolationRecords = siblings.map((sibling) => ({
        element: sibling,
        hadInert: sibling.hasAttribute('inert'),
        ariaHidden: sibling.getAttribute('aria-hidden'),
      }));

      siblings.forEach((sibling) => {
        sibling.setAttribute('inert', '');
        try {
          (sibling as HTMLElement).inert = true;
        } catch {}
        sibling.setAttribute('aria-hidden', 'true');
      });
    }

    // Helper to check if this modal is currently inert (e.g. shadowed by a stacked modal)
    const isThisModalInert = () => {
      return Boolean(
        currentOverlay &&
          (currentOverlay.hasAttribute('inert') || (currentOverlay as HTMLElement).inert)
      );
    };

    // 3. Trap focus within dialog
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isThisModalInert()) return;

      if (e.key === 'Escape') {
        if (!isCloseBlockedRef.current) {
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        // Edge case: Dialog container itself has focus
        if (document.activeElement === dialogRef.current) {
          e.preventDefault();
          if (e.shiftKey) {
            lastElement.focus();
          } else {
            firstElement.focus();
          }
          return;
        }

        if (e.shiftKey) {
          if (
            document.activeElement === firstElement ||
            !dialogRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (
            document.activeElement === lastElement ||
            !dialogRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    // 4. Capture escaping focus (e.g. click outside dialog window or programmatic focus)
    const handleFocusIn = (e: FocusEvent) => {
      if (isThisModalInert()) return;
      if (!dialogRef.current) return;
      if (!dialogRef.current.contains(e.target as Node)) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    // 5. Initial focus inside modal (cancellable via RAF ref)
    rafIdRef.current = requestAnimationFrame(() => {
      if (dialogRef.current) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    });

    return () => {
      // Cancel pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Cleanup listeners
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);

      // Restore background scrolling
      document.body.style.overflow = originalOverflow;

      // Restore exact previous inert and aria-hidden states on siblings
      isolationRecords.forEach(({ element, hadInert, ariaHidden }) => {
        if (!document.contains(element)) return;

        if (hadInert) {
          element.setAttribute('inert', '');
          try {
            (element as HTMLElement).inert = true;
          } catch {}
        } else {
          element.removeAttribute('inert');
          try {
            (element as HTMLElement).inert = false;
          } catch {}
        }

        if (ariaHidden !== null) {
          element.setAttribute('aria-hidden', ariaHidden);
        } else {
          element.removeAttribute('aria-hidden');
        }
      });

      // Restore focus to opener element
      if (previousActiveElementRef.current && document.contains(previousActiveElementRef.current)) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const maxWidthStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return createPortal(
    <div
      ref={overlayRef}
      data-bizflow-modal-root="true"
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      <div className="min-h-screen px-4 text-center flex items-center justify-center sm:p-0">
        {/* Backdrop overlay */}
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
          aria-hidden="true"
          onClick={() => {
            if (!isCloseBlocked) {
              onCloseRef.current();
            }
          }}
        />

        {/* Modal Window */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          aria-describedby={description ? 'modal-description' : undefined}
          tabIndex={-1}
          className={clsx(
            'inline-block w-full my-8 p-6 text-left align-middle transition-all transform bg-white shadow-2xl rounded-2xl border border-slate-100 z-10 focus:outline-none',
            maxWidthStyles[maxWidth]
          )}
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div>
              <h3 id="modal-title" className="text-lg font-bold text-slate-900">
                {title}
              </h3>
              {description && (
                <p id="modal-description" className="text-xs text-slate-500 mt-0.5">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={isCloseBlocked}
              onClick={() => {
                if (!isCloseBlocked) {
                  onCloseRef.current();
                }
              }}
              className={clsx(
                'p-1.5 rounded-lg transition',
                isCloseBlocked
                  ? 'text-slate-300 cursor-not-allowed'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
              )}
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div>{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
};
