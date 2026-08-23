import React from 'react';
import { useToastStore } from './toastStore';
import { Toast } from './Toast';

export interface ToastContainerProps {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  position = 'bottom-right',
}) => {
  const [toasts] = useToastStore();

  // Always mounted: an aria-live region only announces changes if it already
  // existed, so unmounting when empty would silence the first toast
  return (
    <div
      className={`ui-toast-container ui-toast-pos-${position}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((item) => (
        // Slot collapses its grid row while the toast exits, so the rest of
        // the stack slides into place instead of jumping on removal
        <div key={item.id} className={`ui-toast-slot ${item.exiting ? 'exiting' : ''}`}>
          <div className="ui-toast-clip">
            <Toast toast={item} />
          </div>
        </div>
      ))}
    </div>
  );
};
