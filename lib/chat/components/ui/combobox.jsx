'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDownIcon, CheckIcon, SearchIcon } from '../icons.js';
import { cn } from '../../utils.js';

export function Combobox({ options = [], value, onChange, placeholder = 'Select...', loading = false, disabled = false, highlight = false, side = 'bottom', onOpen, triggerClassName, triggerLabel, footerAction }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  const selectedLabel = options.find((o) => o.value === value)?.label || '';

  const filtered = filter
    ? options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()))
    : options;

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setFilter('');
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setFilter('');
      }
    };
    setTimeout(() => document.addEventListener('click', handleClick), 0);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  // Auto-focus search input when opened + call onOpen
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      onOpen?.();
    }
  }, [open]);

  const handleSelect = useCallback((val) => {
    onChange(val);
    setOpen(false);
    setFilter('');
  }, [onChange]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={triggerClassName || cn(
          'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors w-full',
          disabled
            ? 'border-border bg-muted text-muted-foreground cursor-not-allowed opacity-60'
            : highlight
              ? 'border-primary ring-2 ring-primary/30 bg-background text-foreground hover:bg-muted cursor-pointer animate-pulse'
              : 'border-border bg-background text-foreground hover:bg-muted cursor-pointer'
        )}
      >
        {triggerLabel || (
          <>
            <span className={cn('flex-1 text-left truncate', !value && 'text-muted-foreground')}>
              {value ? selectedLabel : placeholder}
            </span>
            <ChevronDownIcon size={14} className={cn('text-muted-foreground transition-transform shrink-0', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute z-50 w-full min-w-[200px] overflow-hidden rounded-lg border border-border bg-background shadow-lg",
          side === 'top' ? 'bottom-full mb-1' : 'mt-1'
        )}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <SearchIcon size={14} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-left transition-colors',
                    'hover:bg-accent',
                    opt.value === value && 'bg-muted'
                  )}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.value === value && <CheckIcon size={14} className="text-foreground shrink-0" />}
                </button>
              ))
            )}
          </div>
          {footerAction && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setFilter('');
                  footerAction.onClick();
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-left transition-colors hover:bg-accent text-muted-foreground"
              >
                {footerAction.icon}
                <span>{footerAction.label}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
