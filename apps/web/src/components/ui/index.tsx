import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { cx } from '../../lib/cx';
import { errorSentence, isRetryable } from '../../lib/errors';
import { ToastContext, type ToastMessage } from '../../lib/toast';

/**
 * THE DESIGN SYSTEM.
 *
 * Mobile-first, because that is where the reporting happens: a club secretary filing on a
 * phone, one-handed, on metered data, possibly at 11pm in Fort Portal. Every interactive
 * target is at least 44px and every screen works at 360px.
 *
 * Two rules govern everything below.
 *
 * **Every colour is a token.** Not one literal hex, not one raw ramp step. Components use
 * the semantic layer — `bg-surface`, `text-text-muted`, `border-border` — so a palette
 * change or a dark-mode fix happens in `index.css` and nowhere else. A component that names
 * a ramp step directly — cranberry 600, ink 200 — has quietly decided what the brand colour
 * will be forever, and it will be the one screen nobody re-checks in dark mode.
 *
 * **Every interactive element defines all six states**: default, hover, focus, active,
 * disabled, loading. A missing state is exactly where an interface starts to feel broken —
 * and it is almost always hover or loading that is missing.
 */

// ─── Button ──────────────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Hover is wrapped in `@media (hover: hover)` by Tailwind, so a phone never gets a stuck
 * hover state after a tap. Active carries the press scale from the `press` utility.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:bg-accent-active disabled:bg-accent disabled:opacity-40',
  secondary:
    'bg-surface text-text-secondary border border-border hover:bg-surface-raised hover:border-border-strong active:bg-surface-sunken disabled:opacity-40',
  ghost:
    'bg-transparent text-text-secondary hover:bg-surface-raised active:bg-surface-sunken disabled:opacity-40',
  // Ember, never cranberry. A red destructive button in this palette would read as the
  // primary action, which is the single most dangerous ambiguity available to a system that
  // can erase a person's record.
  danger:
    'bg-danger text-white hover:bg-danger-hover active:bg-danger disabled:bg-danger disabled:opacity-40',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-label',
  md: 'min-h-10 px-4 text-table',
  lg: 'min-h-12 px-5 text-body',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(
        // `relative` anchors the loading spinner; see below for why that matters.
        'press relative inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'disabled:cursor-not-allowed',
        // The visual height can be under 44px on desktop; the touch target never is.
        'touch-manipulation',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {/*
       * THE BUTTON DOES NOT CHANGE SIZE WHILE LOADING.
       *
       * The label stays in the layout and goes transparent; the spinner is painted over it.
       * Swapping the label out for a spinner instead would shrink the button mid-tap, which
       * moves every control beside it and causes exactly the mis-taps that make an interface
       * feel unreliable at the worst possible moment — the one where the user is waiting.
       */}
      <span className={cx('inline-flex items-center gap-2', isLoading && 'invisible')}>
        {children}
      </span>
      {isLoading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
    </button>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'size-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

// ─── Fields ──────────────────────────────────────────────────────────────────────────────

/**
 * Label, control, then hint or error — in that order, in the DOM as well as on screen.
 *
 * Labels sit ABOVE the input, always. Not floating, not as placeholder text. Floating labels
 * fail on mobile zoom, fail for screen readers, and vanish at precisely the moment somebody
 * needs to check what the field was asking for.
 */
function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-text-secondary text-table font-medium">
        {label}
        {required === true && (
          <span className="text-danger ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-text-muted text-label">
          {hint}
        </p>
      )}
      {/*
       * Never colour alone: the icon carries the same information for the one man in twelve
       * with a colour vision deficiency, and `role="alert"` carries it for a screen reader
       * rather than leaving somebody to discover the problem by tabbing back.
       */}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-danger-text text-label flex items-start gap-1.5"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="mt-0.5 size-3.5 shrink-0 fill-current"
          >
            <path d="M8 1.5 15 14H1L8 1.5Zm0 4.25a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5.75Zm0 6.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
          </svg>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'min-h-11 md:min-h-10 rounded-sm border bg-surface px-3 text-text-primary placeholder:text-text-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function Input({ label, error, hint, className, id, required, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field id={inputId} label={label} hint={hint} error={error} required={required}>
      <input
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={cx(
          CONTROL_BASE,
          error ? 'border-danger' : 'border-border hover:border-border-strong',
          className,
        )}
        {...rest}
      />
    </Field>
  );
}

/**
 * A number field that summons the number pad.
 *
 * `inputMode="numeric"` is a one-attribute change that measurably speeds up data entry on a
 * phone — the difference between a full QWERTY keyboard and a keypad, on every amount a
 * treasurer types. `type="text"` rather than `type="number"` deliberately: number inputs
 * scroll-wheel themselves into wrong values and reject the leading zeroes and thousands
 * separators people actually type.
 */
export function NumberInput({ className, ...rest }: InputProps) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="off"
      className={cx('text-right tabular-nums', className)}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | undefined;
  /** A line under the control, for the thing the label has no room to say. */
  hint?: string | undefined;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function Select({
  label,
  error,
  hint,
  options,
  placeholder,
  id,
  required,
  className,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <Field id={selectId} label={label} hint={hint} error={error} required={required}>
      <select
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={cx(
          CONTROL_BASE,
          error ? 'border-danger' : 'border-border hover:border-border-strong',
          className,
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
    </Field>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────────────────

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Off for a card whose body is a table — the table owns its own edges. */
  padded?: boolean;
}) {
  return (
    <section
      className={cx(
        // Elevation is a shadow in light mode and a hairline in dark, because a shadow on a
        // dark ground is invisible. Both are tokens; `hairline-top` resolves to nothing in
        // light mode.
        'border-border-subtle bg-surface hairline-top rounded-lg border shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          {typeof title === 'string' ? (
            <h2 className="text-text-primary text-subsection font-semibold">{title}</h2>
          ) : (
            title
          )}
          {actions}
        </header>
      )}
      {/* 20px on mobile, 24px on desktop — both on the spacing scale. */}
      <div className={cx(padded && 'p-5 md:p-6')}>{children}</div>
    </section>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hidden below `md`, where the card layout carries it instead. */
  secondary?: boolean;
  /** Right-aligned and tabular. Set it on every money, count and score column. */
  numeric?: boolean;
  /**
   * The unit, stated ONCE in the header rather than repeated in every cell — `USD`, `UGX`,
   * `%`, `members`. Repeating a unit down a column is noise; omitting it entirely is an
   * ambiguity somebody will resolve wrongly.
   */
  unit?: string;
}

/**
 * THE TABLE. The primary artefact of this system.
 *
 * The audience reads tables fluently and will judge the product on them, so this follows
 * statistical publication convention rather than web convention:
 *
 *  * **Horizontal rules only.** No vertical rules, no cell borders, no zebra striping. A
 *    hairline above the header, a stronger rule below it, a rule at the foot. This is the
 *    standard scientific table, and it is standard because it is the most legible.
 *  * **Sentence-case headers, not uppercase.** Uppercase headers are a web convention; a
 *    published table does not shout its column names.
 *  * **Units in the header**, in parentheses at `meta` size.
 *  * Numbers right-aligned and tabular; text left-aligned. A data column is never centred.
 *  * **Total rows in medium weight above a rule**, never bold and filled.
 *
 * On small screens each row becomes a definition card — which is why `Column.header` has to
 * read as a label on its own, not only as a column heading. **Restructure, never hide:**
 * every figure available on desktop is available on a phone. A mobile view that drops
 * columns is a mobile view that cannot be trusted.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  isPending,
  total,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  /** Rows not yet confirmed by the server. Marked in words, not by motion. */
  isPending?: (row: T) => boolean;
  /** A total or subtotal row, rendered in medium weight above a rule. */
  total?: { label: string; cells: Partial<Record<string, ReactNode>> };
}) {
  if (rows.length === 0) return <>{emptyState ?? <EmptyState title="Nothing here yet" />}</>;

  return (
    <>
      <div className="hidden md:block">
        <table className="text-table w-full text-left">
          <thead>
            {/* A hairline above, a strong rule below. Those two rules are the entire
                structure of a scientific table. */}
            <tr className="border-border-strong border-b">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cx(
                    'text-text-secondary text-label px-4 py-2.5 font-medium',
                    column.numeric && 'text-right',
                  )}
                >
                  {column.header}
                  {column.unit && (
                    <span className="text-text-muted text-meta ml-1 font-normal">
                      ({column.unit})
                    </span>
                  )}
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
                  'border-border-subtle border-b',
                  onRowClick && 'hover:bg-surface-sunken cursor-pointer',
                )}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    /* 44px rows. Dense, and still a viable touch target. */
                    className={cx(
                      'text-text-primary h-11 px-4 py-2 align-middle',
                      column.numeric && 'text-right',
                    )}
                  >
                    {column.render(row)}
                    {/*
                      The pending state, in words, on the first cell.
                      It used to be an opacity pulse. A pulsing row draws the eye to the one
                      piece of information on the page that is LEAST settled, and it cannot
                      be screenshotted, printed or read aloud. A label can.
                    */}
                    {index === 0 && isPending?.(row) && (
                      <span className="text-text-muted text-meta ml-2 inline-flex items-center gap-1">
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          className="size-3 fill-none stroke-current"
                          strokeWidth={1.5}
                        >
                          <circle cx="8" cy="8" r="6" />
                          <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
                        </svg>
                        Pending
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr className="border-border-strong border-t">
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cx(
                      'text-text-primary h-11 px-4 py-2 font-medium',
                      column.numeric && 'text-right',
                    )}
                  >
                    {index === 0 ? total.label : (total.cells[column.key] ?? null)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/*
        DEFINITION CARDS below `md`. The identifying column heads the card; everything else
        is a label-value pair. Numbers stay tabular so they still align to each other from
        card to card, which is most of why a stack of cards remains readable as data.
      */}
      <ul className="divide-border-subtle border-border-subtle divide-y border-y md:hidden">
        {rows.map((row) => {
          const [first, ...rest] = columns;
          return (
            <li
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx('py-4', onRowClick && 'active:bg-surface-sunken cursor-pointer')}
            >
              {first && (
                <p className="text-text-primary text-subsection font-serif mb-2 flex items-baseline justify-between gap-3">
                  <span className="min-w-0">{first.render(row)}</span>
                  {isPending?.(row) && (
                    <span className="text-text-muted text-meta shrink-0">Pending</span>
                  )}
                </p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {rest.map((column) => (
                  <div key={column.key} className="contents">
                    <span className="text-text-muted text-meta">
                      {column.header}
                      {column.unit && ` (${column.unit})`}
                    </span>
                    <span className={cx('text-text-primary text-table min-w-0', 'text-right')}>
                      {column.render(row)}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────────────────

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'achievement' | 'accent';

/**
 * Tint the background, deepen the text — never white on a mid-tone fill.
 *
 * White on cranberry 600 is about 4.9:1, which passes for large text and UI but not for a
 * badge's small label. Text at step 800 on a step-50 tint is about 8:1 and reads cleanly at
 * 12px, which is the size these are actually used at.
 */
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-text-secondary',
  success: 'bg-success-subtle text-success-text',
  warning: 'bg-warning-subtle text-warning-text',
  danger: 'bg-danger-subtle text-danger-text',
  info: 'bg-info-subtle text-info-text',
  // Gold means achievement — a tier, a commendation. Never a state; that is what keeps it
  // distinguishable from amber, which it neighbours on the wheel.
  achievement: 'bg-achievement-subtle text-achievement-text',
  accent: 'bg-accent-subtle text-accent-text',
};

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  /** Warnings always carry one. Colour alone is not a signal everybody receives. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'text-meta inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
        BADGE_TONES[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────────────────────────

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `sm` for a destructive confirmation, `md` for a short form. Longer than that is a page. */
  size?: 'sm' | 'md';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /** Where focus was before this opened, so it can be handed back on close. */
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    // Focus the panel itself rather than the first control: on a destructive confirmation,
    // auto-focusing the confirm button is how somebody deletes a club with a stray Enter.
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Focus is trapped. Without this, tabbing walks out of the dialog and into the page
      // behind it, where a screen reader user has no way of knowing they have left.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreTo.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--scrim)] sm:items-center sm:p-4"
      onClick={onClose}
    >
      {/* A sheet on mobile, a centred card above sm. A dialog's controls at the top of a
          phone screen cannot be reached one-handed, which is how this system is used. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cx(
          'bg-surface-overlay hairline-top max-h-[90vh] w-full overflow-y-auto rounded-t-xl',
          'pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-lg)] outline-none sm:rounded-xl sm:pb-0',
          // Scale from 0.96 with an 8px rise. Entering movement is small and decisive; a
          // bigger entrance reads as a slower one.
          'motion-safe:animate-[dialog-in_var(--duration-slow)_var(--ease-out)]',
          size === 'sm' ? 'sm:max-w-[420px]' : 'sm:max-w-[560px]',
        )}
      >
        <header className="border-border-subtle bg-surface-overlay sticky top-0 flex items-center justify-between gap-4 border-b px-5 py-4">
          <h2 className="text-subsection font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-current">
              <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94Z" />
            </svg>
          </Button>
        </header>
        <div className="p-5">{children}</div>
        {footer && (
          <footer className="border-border-subtle bg-surface-overlay sticky bottom-0 flex justify-end gap-3 border-t px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────────────────

/** How long a success stays up. Errors do not auto-dismiss at all. */
const TOAST_MS = 4000;
/** Beyond three, the stack is taller than the thing it is reporting on. */
const TOAST_MAX = 3;

/**
 * Toasts are for outcomes the user is NOT looking at.
 *
 * Anything happening on screen in front of somebody gets inline confirmation instead. An
 * inline success is seen; a toast may well be missed, and a missed confirmation is worse
 * than none because the user goes looking for the thing that already worked.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const show = useCallback((tone: ToastMessage['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current.slice(-(TOAST_MAX - 1)), { id, tone, text }]);

    /*
     * There was a haptic here — eight milliseconds on a success. It has been removed along
     * with the springs, the count-ups and the stagger. A buzz is a flourish, and this
     * interface does not perform: the confirmation is the message, and the message is enough.
     */
    // An error stays until it is dismissed. It usually carries an instruction, and four
    // seconds is not long enough to read one and act on it.
    if (tone !== 'error') {
      setTimeout(() => setMessages((current) => current.filter((m) => m.id !== id)), TOAST_MS);
    }
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  const dismiss = (id: number) => setMessages((current) => current.filter((m) => m.id !== id));

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className={cx(
          'pointer-events-none fixed z-[60] flex flex-col gap-2 px-4',
          // Top on mobile, below the header and clear of the thumb; bottom-right on desktop.
          'inset-x-0 top-[calc(var(--spacing-header)+8px)] items-center',
          'md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:items-end',
        )}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            role={message.tone === 'error' ? 'alert' : undefined}
            className={cx(
              'pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-md px-4 py-3',
              'text-table shadow-[var(--shadow-lg)] motion-safe:animate-[dialog-in_var(--duration-base)_var(--ease-out)]',
              message.tone === 'success'
                ? 'bg-text-primary text-text-inverse'
                : 'bg-danger text-white',
            )}
          >
            <div className="flex items-start gap-3">
              <span className="flex-1">{message.text}</span>
              {message.tone === 'error' && (
                <button
                  type="button"
                  onClick={() => dismiss(message.id)}
                  aria-label="Dismiss"
                  className="-m-1 shrink-0 p-1 opacity-70 transition-opacity hover:opacity-100"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-current">
                    <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94Z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Skeleton, EmptyState, ErrorState ────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('bg-surface-sunken animate-pulse rounded-sm', className)}
    />
  );
}

/**
 * Skeletons shaped like the content they stand in for.
 *
 * Matching line counts and widths, not generic grey blocks. A block that promises a shape the
 * content does not deliver is worse than a spinner, because the layout visibly rearranges
 * itself the moment the data lands — and that shift is the most-noticed flaw in mobile web.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="border-border-subtle flex h-14 items-center gap-4 rounded-md border px-4"
        >
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Every empty state answers three questions: what this is, why it is empty, and what to do
 * next — and then offers the button that does it.
 *
 * `filtered` distinguishes "there is nothing here" from "nothing matches what you asked
 * for". They are different problems with different answers, and conflating them is why so
 * many applications tell a user their data is missing when it is merely hidden.
 */
export function EmptyState({
  title,
  description,
  action,
  filtered = false,
  onClearFilters,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className="font-serif text-section text-text-primary">
        {filtered ? 'Nothing matches those filters' : title}
      </h3>
      {(description || filtered) && (
        <p className="text-text-muted text-table max-w-sm text-pretty">
          {filtered
            ? 'Try widening the search, or clear the filters to see everything again.'
            : description}
        </p>
      )}
      {filtered && onClearFilters ? (
        <Button variant="secondary" onClick={onClearFilters} className="mt-1">
          Clear filters
        </Button>
      ) : (
        action && <div className="mt-1">{action}</div>
      )}
    </div>
  );
}

/**
 * An error, said in a sentence, with a way forward.
 *
 * Never a raw code, never "something went wrong". `errorSentence` maps the server's domain
 * codes to something actionable, and `isRetryable` decides whether to offer a retry — a
 * retry button on a locked Rotary Year would never work, and a button that never works
 * teaches people to distrust every other one.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="bg-danger-subtle text-danger grid size-10 place-items-center rounded-full">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-5 fill-current">
          <path d="M8 1.5 15 14H1L8 1.5Zm0 4.25a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5.75Zm0 6.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
        </svg>
      </span>
      <p className="text-text-primary text-body max-w-md text-pretty">{errorSentence(error)}</p>
      {onRetry && isRetryable(error) && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────────────────

/**
 * Previous / next with a count.
 *
 * Not numbered pages: on a 360px screen a row of page numbers is a row of targets too small
 * to hit, and "showing 26–50 of 87" is the part anybody actually reads.
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
    <div className="border-border-subtle mt-4 flex items-center justify-between gap-4 border-t pt-4">
      <p className="text-text-muted text-table tabular-nums">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasMore}
          onClick={() => onPageChange(page + 1)}
        >
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
    <label className="hover:bg-surface-raised flex min-h-11 cursor-pointer items-start gap-3 rounded-sm px-2 py-1.5 transition-colors duration-[var(--duration-instant)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent mt-1 size-5 shrink-0"
      />
      <span className="min-w-0">
        <span className="text-text-primary text-label block font-mono">{label}</span>
        {description && <span className="text-text-muted text-label block">{description}</span>}
      </span>
    </label>
  );
}

/**
 * The page heading.
 *
 * ONE primary action. Everything else belongs in an overflow menu — a page offering three
 * equally weighted buttons has told the reader nothing about what it expects them to do.
 */
export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
  meta,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** At most two ancestors. Deeper than that and the hierarchy is the problem. */
  breadcrumb?: ReactNode;
  /** Middle-dot separated facts under the title: cluster, charter date, RI id. */
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {breadcrumb && <div className="text-text-muted text-label">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Fraunces, at a display size, with the negative tracking that stops large type
              looking accidental. Restricted to page titles and the showcase screens. */}
          <h1 className="font-serif text-section md:text-title text-text-primary text-balance">
            {title}
          </h1>
          {meta && <p className="text-text-muted text-label mt-1.5">{meta}</p>}
          {description && (
            <p className="text-text-secondary text-table mt-2 max-w-prose text-pretty">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}
