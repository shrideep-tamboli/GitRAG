import React from 'react';

interface BoxProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    className?: string;
}

const Box: React.FC<BoxProps> = ({ children, style, className }) => {
    return (
        <div style={{ padding: '1rem', borderRadius: '8px', ...style }} className={className}>
            {children}
        </div>
    );
};

export default Box;