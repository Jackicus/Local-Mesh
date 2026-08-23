import React from 'react';
import {
  CheckCircleIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  InfoIcon,
  CloseIcon,
} from '../../assets/icons';
import { ToastItem, toastStore } from './toastStore';

interface ToastProps {
  toast: ToastItem;
}

export const Toast: React.FC<ToastProps> = ({ toast }) => {
  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircleIcon size={18} className="ui-toast-icon success" />;
      case 'danger':
        return <AlertCircleIcon size={18} className="ui-toast-icon danger" />;
      case 'warning':
        return <AlertTriangleIcon size={18} className="ui-toast-icon warning" />;
      case 'info':
      default:
        return <InfoIcon size={18} className="ui-toast-icon info" />;
    }
  };

  return (
    <div
      className={`ui-toast-item ui-toast-${toast.type} ${toast.exiting ? 'exiting' : ''}`}
      role="alert"
    >
      <div className="ui-toast-leading">{getIcon()}</div>

      <div className="ui-toast-content">
        {toast.title && <div className="ui-toast-title">{toast.title}</div>}
        <div className="ui-toast-message">{toast.message}</div>
      </div>

      <button
        type="button"
        className="ui-toast-close"
        aria-label="Dismiss notification"
        onClick={() => toastStore.dismiss(toast.id)}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
};
