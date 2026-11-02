import { cn } from '../../lib/utils.js';

export function Badge({ className, variant = 'secondary', ...props }) {
  const variants = {
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    outline: 'border-border bg-transparent text-muted-foreground',
    success: 'border-emerald-900/80 bg-emerald-950/60 text-emerald-300',
  };
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', variants[variant], className)} {...props} />;
}
