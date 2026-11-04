import { useId, useState } from 'react';
import { Command } from 'cmdk';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type ComboboxOption = { value: string; label: string; disabled?: boolean; group?: string };

// shadcn's Popover + Command composition keeps search, focus and keyboard
// navigation consistent for every catalog in the panel.
export function Combobox({ options, value, disabled, label, triggerId, invalid, required, onValueChange }: {
  options: ComboboxOption[]; value: string; disabled: boolean; label: string;
  triggerId?: string; invalid?: boolean; required?: boolean; onValueChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const errorId = useId();
  const groups = [...new Set(options.map((option) => option.group ?? ''))];
  return <><Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={triggerId} variant="outline" type="button" role="combobox" aria-expanded={open && !disabled} aria-label={label} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} disabled={disabled} className="combobox-trigger w-full min-w-0 justify-between text-left font-normal">
        <span className="truncate">{options.find((option) => option.value === value)?.label ?? 'Selecciona una opción'}</span>
        <svg className="ml-2 size-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></svg>
      </Button>
    </PopoverTrigger>
    <PopoverContent>
      <Command label={label} loop>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <svg className="size-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <Command.Input className="h-11 w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Buscar…" aria-label={`Buscar: ${label}`} />
        </div>
        <Command.List className="max-h-[min(280px,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain p-1">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">No hay coincidencias.</Command.Empty>
          {groups.map((group) => <Command.Group key={group} heading={group || undefined} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {options.filter((option) => (option.group ?? '') === group).map((option) => <Command.Item key={option.value} value={option.value || '__empty__'} keywords={[option.label]} disabled={option.disabled} onSelect={() => { onValueChange(option.value); setOpen(false); }} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40">
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {option.value === value && <span aria-hidden="true" className="text-primary">✓</span>}
            </Command.Item>)}
          </Command.Group>)}
        </Command.List>
      </Command>
    </PopoverContent>
  </Popover>{invalid && <p id={errorId} className="mt-2 text-xs text-red-300" role="alert">Selecciona una opción para continuar.</p>}</>;
}
