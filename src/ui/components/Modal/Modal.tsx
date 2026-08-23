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
  const titleId = useId();

  // Focus depends only on isOpen — bundling it with the Escape listener would
  // re-focus the dialog (stealing focus from inputs inside it) every time a
  // parent re-render changes the inline onClose identity
  useEffect(() => {
    if (isOpen) containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose();
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
