import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/ap-invoice/utils';
import { Button } from '../ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  formatPropertyLabel,
  listDemoProperties,
  type DemoProperty,
} from '../../lib/ap-invoice/propertiesService';

type Props = {
  value: string;
  onChange: (propertyName: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
};

/** Searchable Property / Project picker. Saves property_name into property_ref. */
export function PropertyCombobox({ value, onChange, id, className, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<DemoProperty[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listDemoProperties()
      .then((rows) => {
        if (!cancelled) setProperties(rows);
      })
      .catch(() => {
        if (!cancelled) setProperties([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = (value || '').trim();

  const selected = useMemo(
    () => properties.find((p) => p.property_name === trimmed) ?? null,
    [properties, trimmed],
  );

  /** Keep legacy free-text property_ref values selectable / visible. */
  const legacyOption = useMemo(() => {
    if (!trimmed) return null;
    if (selected) return null;
    return {
      id: `__legacy__:${trimmed}`,
      property_name: trimmed,
      location: null,
      property_type: null,
    } satisfies DemoProperty;
  }, [selected, trimmed]);

  const options = useMemo(() => {
    if (!legacyOption) return properties;
    return [legacyOption, ...properties];
  }, [legacyOption, properties]);

  const triggerLabel = selected
    ? formatPropertyLabel(selected)
    : trimmed
      ? trimmed
      : loading
        ? 'Loading properties…'
        : 'Select property…';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search property…" />
          <CommandList>
            <CommandEmpty>No property found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__ none clear"
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', !trimmed ? 'opacity-100' : 'opacity-0')} />
                — None —
              </CommandItem>
              {options.map((p) => {
                const label = formatPropertyLabel(p);
                const isLegacy = String(p.id).startsWith('__legacy__:');
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.property_name} ${p.location || ''} ${p.property_type || ''}`}
                    onSelect={() => {
                      onChange(p.property_name);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        trimmed === p.property_name ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">
                      {label}
                      {isLegacy ? ' (current)' : ''}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
