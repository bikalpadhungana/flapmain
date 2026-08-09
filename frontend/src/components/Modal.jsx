import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Reusable Modal component with a floating, blurred background effect.
 * Mimics Material-UI's Dialog component behavior.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = '600px',
  actions, // Optional action buttons to render in the footer
}) {
  const modalRef = useRef(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [open]);

  // Close when clicking outside the card
  const handleBackdropClick = (e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      onClose();
    }
  };

  if (!open) return null;

  return createPortal(
    <div 
      className="flex items-center justify-center glass-modal-overlay" 
      style={{ 
        position: 'fixed', 
        top: 0, left: 0, right: 0, bottom: 0, 
        zIndex: 50
      }}
      onMouseDown={handleBackdropClick}
    >
      <div 
        ref={modalRef}
        className="card shadow-lg" 
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          width: '100%', 
          maxWidth: maxWidth, 
          maxHeight: '90vh', 
          margin: '20px', 
          animation: 'modalFadeIn 0.2s ease-out',
          overflow: 'hidden'
        }}
      >
        <div className="card-header flex justify-between items-center" style={{ flexShrink: 0, padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{title}</h3>
          <button 
            type="button" 
            onClick={onClose} 
            className="btn btn-icon text-muted" 
            style={{ border: 'none', background: 'transparent', padding: '4px' }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        
        <div className="card-body" style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {children}
        </div>
        
        {actions && (
          <div className="card-footer flex justify-end gap-3" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
