import { AlertTriangle, Plus, Star, Trash2 } from 'lucide-react';
import { useDeferredValue, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AllergyMatch, Drug, RxItemInput } from '@clinic/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { t } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDrugSearch, useFavorites, useSaveFavorite } from './api';

export type DraftItem = RxItemInput & { key: string };

let nextKey = 0;
export const withKey = (item: RxItemInput): DraftItem => ({ ...item, key: `item-${nextKey++}` });

const c = t.consult;

function DrugSearch({ onAdd }: { onAdd: (item: RxItemInput) => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDeferredValue(query.trim());
  const results = useDrugSearch(q);
  const listId = useId();
  const options: { label: string; item: RxItemInput }[] = [
    ...(results.data ?? []).map((d: Drug) => ({
      label: `${d.genericName}${d.brandName ? ` (${d.brandName})` : ''} · ${d.strength} ${d.form}`,
      item: {
        drugId: d.id,
        genericName: d.genericName,
        brandName: d.brandName,
        strength: d.strength,
        form: d.form,
        sig: '',
        quantity: '',
      },
    })),
    ...(q.length >= 2
      ? [{ label: c.addFreeText(q), item: { genericName: q, sig: '', quantity: '' } }]
      : []),
  ];

  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    onAdd(option.item);
    setQuery('');
    setActive(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    else if (e.key === 'Enter') pick(active);
    else if (e.key === 'Escape') setQuery('');
    else return;
    e.preventDefault();
  };

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-label={c.searchDrug}
        placeholder={c.searchDrug}
        value={query}
        onChange={(e) => (setQuery(e.target.value), setActive(0))}
        onKeyDown={onKeyDown}
      />
      {options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        >
          {options.map((o, i) => (
            <li
              key={o.label}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(i))}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                i === active && 'bg-muted',
                !o.item.drugId && 'text-muted-foreground italic',
              )}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RxBuilder({
  items,
  onChange,
  notes,
  onNotesChange,
  matches,
  acknowledged,
  onAcknowledge,
  errors,
  disabled,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  matches: AllergyMatch[];
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const favorites = useFavorites();
  const saveFavorite = useSaveFavorite();
  const [favoriteName, setFavoriteName] = useState<string | null>(null);
  const lastSig = useRef<HTMLInputElement | null>(null);

  const update = (key: string, patch: Partial<RxItemInput>) =>
    onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const add = (item: RxItemInput) => {
    onChange([...items, withKey(item)]);
    requestAnimationFrame(() => lastSig.current?.focus());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-60 flex-1">
          <DrugSearch onAdd={add} />
        </div>
        {(favorites.data?.length ?? 0) > 0 && (
          <Select
            className="w-auto"
            aria-label={c.applyFavorite}
            value=""
            disabled={disabled}
            onChange={(e) => {
              const fav = favorites.data?.find((f) => f.id === e.target.value);
              if (fav) onChange([...items, ...fav.items.map(withKey)]);
            }}
          >
            <option value="">{c.applyFavorite}</option>
            {favorites.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {matches.length > 0 && (
        <Alert variant="destructive" className="space-y-2">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" />
            {c.allergyTitle}
          </p>
          <ul className="list-disc pl-5">
            {matches.map((m) => (
              <li key={`${m.drug}-${m.allergen}`}>{c.allergyLine(m.drug, m.allergen)}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="size-4"
              checked={acknowledged}
              onChange={(e) => onAcknowledge(e.target.checked)}
            />
            {c.allergyAck}
          </label>
        </Alert>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{c.noRx}</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item, index) => {
            const err = (field: string) => errors[`rx.items.${index}.${field}`];
            const flagged = matches.some((m) => m.drug === item.genericName);
            return (
              <li
                key={item.key}
                className={cn(
                  'rounded-md border p-3',
                  flagged ? 'border-destructive/60 bg-destructive/5' : 'border-border',
                )}
              >
                <div className="grid gap-2 sm:grid-cols-[2fr_1.5fr_1fr_1fr_auto]">
                  <Input
                    aria-label={c.generic}
                    placeholder={c.generic}
                    value={item.genericName}
                    onChange={(e) => update(item.key, { genericName: e.target.value })}
                  />
                  <Input
                    aria-label={c.brand}
                    placeholder={c.brand}
                    value={item.brandName ?? ''}
                    onChange={(e) => update(item.key, { brandName: e.target.value })}
                  />
                  <Input
                    aria-label={c.strength}
                    placeholder={c.strength}
                    value={item.strength ?? ''}
                    onChange={(e) => update(item.key, { strength: e.target.value })}
                  />
                  <Input
                    aria-label={c.form}
                    placeholder={c.form}
                    value={item.form ?? ''}
                    onChange={(e) => update(item.key, { form: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={c.remove}
                    onClick={() => onChange(items.filter((i) => i.key !== item.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_6rem]">
                  <Input
                    ref={index === items.length - 1 ? lastSig : undefined}
                    aria-label={c.sig}
                    placeholder={c.sig}
                    aria-invalid={!!err('sig')}
                    value={item.sig}
                    onChange={(e) => update(item.key, { sig: e.target.value })}
                  />
                  <Input
                    aria-label={c.quantity}
                    placeholder={c.quantity}
                    aria-invalid={!!err('quantity')}
                    value={item.quantity}
                    onChange={(e) => update(item.key, { quantity: e.target.value })}
                  />
                </div>
                {(err('sig') || err('quantity') || err('genericName')) && (
                  <p className="mt-1 text-xs text-destructive">
                    {err('genericName') ?? err('sig') ?? err('quantity')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Input
        aria-label={c.rxNotes}
        placeholder={c.rxNotes}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
      />

      {items.length > 0 &&
        (favoriteName === null ? (
          <Button variant="ghost" size="sm" onClick={() => setFavoriteName('')}>
            <Star />
            {c.saveFavorite}
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-56"
              autoFocus
              placeholder={c.favoriteName}
              value={favoriteName}
              onChange={(e) => setFavoriteName(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!favoriteName.trim() || saveFavorite.isPending}
              onClick={() =>
                saveFavorite.mutate(
                  { name: favoriteName, items: items.map(({ key: _key, ...rest }) => rest) },
                  { onSuccess: () => setFavoriteName(null) },
                )
              }
            >
              <Plus />
              {t.common.save}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFavoriteName(null)}>
              {t.common.cancel}
            </Button>
            {saveFavorite.isError && (
              <span className="text-xs text-destructive">
                {errorMessage(saveFavorite.error, t.common.genericError)}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}
