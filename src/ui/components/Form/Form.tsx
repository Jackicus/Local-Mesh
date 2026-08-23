import React from 'react';
import { FormRow } from './FormRow';
import { FormSegmented } from './FormSegmented';
import { FormToggle } from './FormToggle';
import { FormInput } from './FormInput';
import { FormSelect } from './FormSelect';
import { FormCheckbox } from './FormCheckbox';
import { FormSlider } from './FormSlider';

export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children?: React.ReactNode;
  className?: string;
  asForm?: boolean;
}

interface FormComponent extends React.FC<FormProps> {
  Row: typeof FormRow;
  Segmented: typeof FormSegmented;
  Toggle: typeof FormToggle;
  Input: typeof FormInput;
  Select: typeof FormSelect;
  Checkbox: typeof FormCheckbox;
  Slider: typeof FormSlider;
}

export const Form: FormComponent = ({
  children,
  className = '',
  asForm = false,
  onSubmit,
  ...props
}) => {
  if (asForm || onSubmit) {
    return (
      <form
        className={`ui-form ${className}`}
        onSubmit={onSubmit}
        {...props}
      >
        {children}
      </form>
    );
  }

  return (
    <div className={`ui-form ${className}`} {...(props as React.HTMLAttributes<HTMLDivElement>)}>
      {children}
    </div>
  );
};

Form.Row = FormRow;
Form.Segmented = FormSegmented;
Form.Toggle = FormToggle;
Form.Input = FormInput;
Form.Select = FormSelect;
Form.Checkbox = FormCheckbox;
Form.Slider = FormSlider;
