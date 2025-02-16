import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'; // Optional variant prop for styling
}

const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', className, ...props }) => {
  const baseStyles = "p-2 rounded focus:outline-none focus:ring";
  const variantStyles = variant === 'primary' 
    ? "bg-black text-white hover:bg-blue-600" 
    : "bg-gray-300 text-black hover:bg-gray-400";

  return (
    <button className={`${baseStyles} ${variantStyles} ${className}`} {...props}>
      {children}
    </button>
  );
};

export default Button;