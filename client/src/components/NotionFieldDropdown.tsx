import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PickerField } from '../types';
import { chipStyle } from '../notionColors';

// A reusable picker for a Notion select / status / multi_select property. The
// trigger shows the current value(s) as chips in their exact Notion colors; the
// popover lists every option (also colored), filterable by text, keyboard
// accessible (ARIA combobox/listbox). Value is the set of selected option ids.
interface Props {
  field: PickerField;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

const chip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px',
  fontWeight: 500, padding: '2px 8px', borderRadius: '20px', lineHeight: 1.5,
  maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

export default function NotionFieldDropdown({ field, value, onChange, disabled }: Props) {
  const multi = field.type === 'multi_select';
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const byId = new Map(field.options.map(o => [o.id, o]));
  const selected = value.map(id => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
  const shown = field.options.filter(o => o.name.toLowerCase().includes(filter.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => { if (open) { setFilter(''); setActive(0); inputRef.current?.focus(); } }, [open]);
  useEffect(() => { setActive(0); }, [filter]);

  function choose(id: string) {
    if (multi) {
      onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
    } else {
      onChange(value[0] === id ? [] : [id]);
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active].id); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', width: '100%',
          minHeight: '34px', padding: '5px 9px', fontFamily: 'inherit', textAlign: 'left',
          background: '#fff', border: '1px solid #dbe3ee', borderRadius: '9px',
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
        }}
      >
        {selected.length === 0 && <span style={{ fontSize: '12.5px', color: '#8a97ab' }}>Set {field.name.toLowerCase()}…</span>}
        {selected.map(o => (
          <span key={o.id} style={{ ...chip, ...chipStyle(o.color) }}>
            {o.name}
            {multi && (
              <span
                role="button"
                aria-label={`Remove ${o.name}`}
                onClick={e => { e.stopPropagation(); choose(o.id); }}
                style={{ cursor: 'pointer', fontWeight: 700, opacity: 0.65 }}
              >×</span>
            )}
          </span>
        ))}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, minWidth: '100%',
            maxWidth: '280px', background: '#fff', border: '1px solid #e2e8f1', borderRadius: '11px',
            boxShadow: '0 14px 34px rgba(20,35,58,.14)', padding: '8px', maxHeight: '260px',
            overflowY: 'auto',
          }}
        >
          <input
            ref={inputRef}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Filter…"
            aria-label={`Filter ${field.name} options`}
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: '12.5px', color: '#16233a',
              padding: '7px 9px', border: '1px solid #e6ecf4', borderRadius: '8px', outline: 'none',
              marginBottom: '6px', boxSizing: 'border-box',
            }}
          />
          <div role="listbox" aria-label={field.name}>
            {shown.length === 0 && <div style={{ fontSize: '12px', color: '#8a97ab', padding: '8px' }}>No matching options.</div>}
            {shown.map((o, i) => {
              const isSel = value.includes(o.id);
              return (
                <div
                  key={o.id}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    padding: '6px 7px', borderRadius: '7px', cursor: 'pointer',
                    background: i === active ? '#f1f5fb' : 'transparent',
                  }}
                >
                  <span style={{ ...chip, ...chipStyle(o.color) }}>{o.name}</span>
                  {isSel && <span style={{ color: 'var(--ac)', fontWeight: 700, fontSize: '13px', flex: '0 0 auto' }}>✓</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
