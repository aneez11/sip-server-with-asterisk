import type { ReactNode } from 'react';

export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="screen-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="screen-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="screen-actions">{actions}</div> : null}
    </header>
  );
}
