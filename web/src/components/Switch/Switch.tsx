import * as SwitchPrimitives from '@radix-ui/react-switch';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/utils';

export const Switch = forwardRef<ElementRef<typeof SwitchPrimitives.Root>, ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitives.Root ref={ref} className={cn('switch', className)} {...props}>
      <SwitchPrimitives.Thumb className="switch-thumb" />
    </SwitchPrimitives.Root>
  ),
);
Switch.displayName = 'Switch';
