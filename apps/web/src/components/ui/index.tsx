import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { cx } from '../../lib/cx';
import { ToastContext, type ToastMessage } from '../../lib/toast';

/**
 * The design system.
 *
 * Mobile-first, because that is where the reporting happens: a club secretary filing on a
 * phone, one-handed, on metered data. Every interactive target is at least 44px, every
 * screen works at 360px, and nothing here loads a webfont or an icon library.
 *
 * Rotaract's palette — Cranberry for action, Azure for information. Never the Rotary
 * wheel.
 */

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-cranberry-500 text-white hover:bg-cranberry-600 disabled:bg-cranberry-200',
  secondary: 'bg-white text-ink-700 border border-ink-300 hover:bg-ink-100 disabled:text-ink-400',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 disabled:text-ink-400',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 disabled:bg-danger-100',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  isLoading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      // min-h-11 is 44px: the smallest target a thumb hits reliably.
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled === true || isLoading}
      {...rest}
    >
      {isLoading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function Input({ label, error, hint, className, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-ink-700 text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'min-h-11 rounded-lg border bg-white px-3 text-base',
          error ? 'border-danger-600' : 'border-ink-300',
          className,
        )}
        {...rest}
      />
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-ink-500 text-xs">
          {hint}
        </p>
      )}
      {/* role="alert" so a screen reader announces the problem rather than leaving the
          member to discover it by tabbing back. */}
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-danger-700 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | undefined;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function Select({ label, error, options, placeholder, id, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-ink-700 text-sm font-medium">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cx(
          'min-h-11 rounded-lg border bg-white px-3 text-base',
          error ? 'border-danger-600' : 'border-ink-300',
        )}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-danger-700 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('border-ink-200 rounded-xl border bg-white', className)}>
      {(title || actions) && (
        <header className="border-ink-200 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          {typeof title === 'string' ? (
            <h2 className="text-ink-900 text-base font-semibold">{title}</h2>
          ) : (
            title
          )}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hidden below `md`, where the card layout carries it instead. */
  secondary?: boolean;
}

/**
 * A table on desktop; a stack of cards on mobile.
 *
 * A table scrolled sideways on a 360px screen is a table nobody reads, and the members
 * this system is for are on 360px screens.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
}) {
  if (rows.length === 0) return <>{emptyState ?? <EmptyState title="Nothing here yet" />}</>;

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-ink-200 text-ink-500 border-b">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  'border-ink-100 border-b last:border-0',
                  onRowClick && 'hover:bg-ink-50 cursor-pointer',
                )}
              >
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-3 align-top">
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className="border-ink-200 rounded-lg border p-3"
          >
            {columns.map((column) => (
              <div key={column.key} className="flex justify-between gap-3 py-0.5 text-sm">
                <span className="text-ink-500">{column.header}</span>
                <span className="text-right">{column.render(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-600',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-700',
  info: 'bg-azure-100 text-azure-700',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  footer,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      {/* A sheet on mobile, a centred card above sm. Reaching a dialog's controls at the
          top of a phone screen one-handed is the problem this solves. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white sm:max-w-lg sm:rounded-2xl"
      >
        <header className="border-ink-200 flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="p-4">{children}</div>
        {footer && (
          <footer className="border-ink-200 flex justify-end gap-2 border-t px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const show = useCallback((tone: ToastMessage['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current, { id, tone, text }]);
    setTimeout(() => setMessages((current) => current.filter((m) => m.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={cx(
              'pointer-events-auto w-full max-w-sm rounded-lg px-4 py-3 text-sm text-white shadow-lg',
              message.tone === 'success' ? 'bg-ink-900' : 'bg-danger-600',
            )}
          >
            {message.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Skeleton, EmptyState, ErrorState ────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('bg-ink-200 animate-pulse rounded', className)} />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-ink-700 font-medium">{title}</p>
      {description && <p className="text-ink-500 max-w-sm text-sm">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : 'Something went wrong. Please try again.';

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-danger-700 font-medium">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/**
 * Previous / next with a count.
 *
 * Not numbered pages: on a 360px screen a row of page numbers is a row of targets too
 * small to hit, and "showing 26–50 of 87" is the part anybody actually reads.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const hasMore = page * pageSize < total;

  if (total <= pageSize) return null;

  return (
    <div className="border-ink-200 mt-3 flex items-center justify-between gap-3 border-t pt-3">
      <p className="text-ink-500 text-sm">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** A labelled checkbox with a 44px target, for permission grids and consent. */
export function Checkbox({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="hover:bg-ink-50 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0"
      />
      <span className="min-w-0">
        <span className="text-ink-900 block font-mono text-xs">{label}</span>
        {description && <span className="text-ink-500 block text-xs">{description}</span>}
      </span>
    </label>
  );
}

/** A page heading with an optional action, used by every admin screen. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-ink-900 text-xl font-semibold">{title}</h1>
        {description && <p className="text-ink-500 mt-0.5 text-sm">{description}</p>}
      </div>
      {action}
    </header>
  );
}
