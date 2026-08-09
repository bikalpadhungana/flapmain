import React from 'react';
import Modal from './Modal';
import { AlertTriangle, Info, CheckCircle, Trash2, Check } from 'lucide-react';

function ConfirmModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = "Confirm Action", 
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "danger" // 'danger', 'warning', 'info', 'success', 'primary'
}) {
  const getStyles = () => {
    switch(type) {
      case 'danger':
        return {
          bg: 'var(--status-error-bg)',
          border: '1px solid #fecaca',
          iconColor: 'text-red-600',
          textColor: 'text-red-900',
          Icon: AlertTriangle,
          btnStyle: { background: 'var(--status-error)', borderColor: 'var(--status-error)', color: 'white' }
        };
      case 'warning':
        return {
          bg: 'var(--status-warn-bg)',
          border: '1px solid #fde68a',
          iconColor: 'text-amber-600',
          textColor: 'text-amber-900',
          Icon: AlertTriangle,
          btnStyle: { background: '#f59e0b', borderColor: '#f59e0b', color: 'white' }
        };
      case 'primary':
      case 'info':
        return {
          bg: '#eff6ff',
          border: '1px solid #bfdbfe',
          iconColor: 'text-blue-600',
          textColor: 'text-blue-900',
          Icon: Info,
          btnStyle: { background: 'var(--action-primary)', borderColor: 'var(--action-primary)', color: 'white' }
        };
      case 'success':
        return {
          bg: 'var(--status-success-bg)',
          border: '1px solid #a7f3d0',
          iconColor: 'text-green-600',
          textColor: 'text-green-900',
          Icon: CheckCircle,
          btnStyle: { background: 'var(--status-success)', borderColor: 'var(--status-success)', color: 'white' }
        };
      default:
        return {
          bg: 'var(--status-error-bg)',
          border: '1px solid #fecaca',
          iconColor: 'text-red-600',
          textColor: 'text-red-900',
          Icon: AlertTriangle,
          btnStyle: { background: 'var(--status-error)', borderColor: 'var(--status-error)', color: 'white' }
        };
    }
  };

  const styles = getStyles();
  const IconComponent = styles.Icon;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="450px"
    >
      <div className="flex flex-col gap-4 animate-slide-up">
        <div className="flex items-start gap-3 p-4 rounded-lg" style={{ background: styles.bg, border: styles.border }}>
          <IconComponent size={24} className={`${styles.iconColor} shrink-0 mt-0.5`} />
          <p className={`${styles.textColor} text-sm m-0`} style={{ lineHeight: '1.5' }}>
            {message}
          </p>
        </div>
        
        <div className="flex gap-3 justify-end mt-2">
          <button 
            onClick={onClose} 
            className="btn btn-secondary"
          >
            {cancelText}
          </button>
          <button 
            onClick={() => {
              onConfirm();
              onClose();
            }} 
            className="btn" 
            style={styles.btnStyle}
          >
            {type === 'danger' ? <Trash2 size={16} /> : <Check size={16} />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmModal;
