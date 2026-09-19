import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ModalHeader } from './ModalHeader';
import { ModalBody } from './ModalBody';
import { ModalFooter } from './ModalFooter';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  children: React.ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ModalComponent extends React.FC<ModalProps> {
  Header: typeof ModalHeader;
  Body: typeof ModalBody;
  Footer: typeof ModalFooter;
}

export const Modal: ModalComponent = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  size = 'md',
  closeOnBackdropClick = true,
  closeOnEscape = true,
  children,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Focus depends only on isOpen — bundling it with the Escape listener would
  // re-focus the dialog (stealing focus from inputs inside it) every time a
  // parent re-render changes the inline onClose identity
  useEffect(() => {
    if (!isOpen) return;
    // Remember what had focus so closing hands it back rather than dumping
    // focus on <body>, where the next Tab restarts from the top of the window
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && target.isConnected) target.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose();
        return;
      }
      // Keep Tab inside the dialog: without this the focus ring walks out into
      // the shell behind the backdrop, which is inert to the eye but not to Tab
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? container.contains(active) : false;
      if (e.shiftKey && (!inside || active === first || active === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const modalNode = (
    <div
      className="ui-modal-backdrop"
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`ui-modal-container ui-modal-${size} ${className}`}
      >
        {/* If simple title prop was passed, automatically render standard ModalHeader */}
        {title && (
          <ModalHeader
            title={title}
            titleId={titleId}
            subtitle={subtitle}
            icon={icon}
            onClose={onClose}
          />
        )}

        {children}
      </div>
    </div>
  );

  const mountRoot =
    typeof document !== 'undefined'
      ? document.getElementById('overlay-root') || document.body
      : null;

  return mountRoot ? createPortal(modalNode, mountRoot) : modalNode;
};

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
