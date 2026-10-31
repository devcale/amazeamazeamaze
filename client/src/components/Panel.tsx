import type { ReactNode } from 'react';

export function Screws() {
  return (
    <>
      <span className="screw tl" />
      <span className="screw tr" />
      <span className="screw bl" />
      <span className="screw br" />
    </>
  );
}

export function Panel({
  title,
  code,
  right,
  className = '',
  children,
}: {
  title: string;
  code?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <Screws />
      <header className="panel-title">
        <span>
          <strong>{title}</strong>
          {code && (
            <>
              {' '}
              <span className="code">{code}</span>
            </>
          )}
        </span>
        {right}
      </header>
      {children}
    </section>
  );
}

export type LampColor = 'off' | 'green' | 'amber' | 'red' | 'cyan';

export function Lamp({ label, color, blink = false }: { label: string; color: LampColor; blink?: boolean }) {
  return (
    <span className={`lamp ${color !== 'off' ? `on-${color}` : ''} ${blink ? 'blink' : ''}`}>
      <i />
      {label}
    </span>
  );
}
