import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Label } from '../ui/label';
import { useIndustryConfig } from '../../context/IndustryConfigContext';
import { listCostCenters, type CostCenter } from '../../services/industryConfig.service';

type Props = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  /** When true, omit the Label (caller renders its own). */
  hideLabel?: boolean;
  allowEmpty?: boolean;
};

export function CostCenterSelect({
  value,
  onChange,
  id = 'cost_center',
  className,
  hideLabel,
  allowEmpty = true,
}: Props) {
  const { costCenterLabel, costCenterPlaceholder, show_property_tagging } = useIndustryConfig();
  const [items, setItems] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show_property_tagging) return;
    setLoading(true);
    void listCostCenters(true)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [show_property_tagging]);

  if (!show_property_tagging) return null;

  return (
    <div className={className ?? 'space-y-2'}>
      {!hideLabel && <Label htmlFor={id}>{costCenterLabel}</Label>}
      <Select
        value={value || (allowEmpty ? '__none__' : undefined)}
        onValueChange={(v) => onChange(v === '__none__' ? '' : v)}
        disabled={loading}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={loading ? 'Loading…' : costCenterPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value="__none__">— None —</SelectItem>}
          {items.map((cc) => (
            <SelectItem key={cc.id} value={cc.name}>
              {cc.code ? `${cc.code} — ${cc.name}` : cc.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
