import React from 'react';

interface TextProps {
    variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'body1' | 'body2';
    children: React.ReactNode;
    className?: string;
}

const Text: React.FC<TextProps> = ({ variant = 'body1', children, className }) => {
    const styles: React.CSSProperties = {
        margin: '0.5rem 0',
        ...(variant === 'h1' && { fontSize: '2rem', fontWeight: 'bold' }),
        ...(variant === 'h2' && { fontSize: '1.75rem', fontWeight: 'bold' }),
        ...(variant === 'h3' && { fontSize: '1.5rem', fontWeight: 'bold' }),
        ...(variant === 'h4' && { fontSize: '1.25rem', fontWeight: 'bold' }),
        ...(variant === 'body1' && { fontSize: '1rem' }),
        ...(variant === 'body2' && { fontSize: '0.875rem' }),
    };

    return (
        <p className={className} style={styles}>
            {children}
        </p>
    );
};

export default Text;