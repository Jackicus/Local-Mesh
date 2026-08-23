import React, { useId } from 'react';

export interface FormRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  align?: 'center' | 'start' | 'stretch';
  className?: string;
  children: React.ReactNode;
}

export const FormRow: React.FC<FormRowProps> = ({
  label,
  description,
  hint,
  htmlFor,
  required = false,
  align = 'center',
  className = '',
  children,
}) => {
  // Auto-associate the label with a lone control child: generate an id, point
  // the label at it, and pass it down (button groups etc. stay unwired)
  const autoId = useId();
  let controlId = htmlFor;
  let wiredChildren = children;
  if (!htmlFor && React.isValidElement<{ id?: string }>(children)) {
    controlId = children.props.id ?? autoId;
    wiredChildren = React.cloneElement(children, { id: controlId });
  }

  return (
    <div className={`ui-form-row align-${align} ${className}`}>
      <div className="ui-form-row-info">
        <label htmlFor={controlId} className="ui-form-row-label">
          <span>{label}</span>
          {required && <span className="ui-form-row-required" aria-hidden="true">*</span>}
          {hint && <span className="ui-form-row-hint">{hint}</span>}
        </label>
        {description && <p className="ui-form-row-desc">{description}</p>}
      </div>

      <div className="ui-form-row-control">
        {wiredChildren}
      </div>
    </div>
  );
};
