import { useState } from 'react';
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
import { CURRENCIES } from '@/constants/currencies';

type Props = {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  className?: string;
};

export function CurrencyCombobox({ value, onChange, id, className }: Props) {
  const [open, setOpen] = useState(false);
  const selected = CURRENCIES.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
        >
          {selected ? `${selected.symbol} ${selected.code} â€” ${selected.name}` : 'Select currencyâ€¦'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search currencyâ€¦" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {CURRENCIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.code} ${c.name}`}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === c.code ? 'opacity-100' : 'opacity-0')} />
                  {c.symbol} {c.code} â€” {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

