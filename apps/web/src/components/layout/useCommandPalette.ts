import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GO_SHORTCUTS } from './navigation';

/**
 * The keyboard that opens the palette, and the `g`-prefixed jumps.
 *
 * They live together because they are the same feature — getting somewhere without reaching
 * for the mouse — and splitting them across two listeners is how one of them ends up firing
 * inside a text field. Both check for that here, once.
 *
 * In its own module rather than beside the palette so that file exports components only,
 * which is what keeps fast refresh working on it.
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const goPending = useRef(false);
  const goTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((current) => !current);
        return;
      }

      // A bare letter is a character somebody may well be entering into a field.
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (goPending.current) {
        const destination = GO_SHORTCUTS[event.key.toLowerCase()];
        goPending.current = false;
        clearTimeout(goTimer.current);
        if (destination) {
          event.preventDefault();
          navigate(destination);
        }
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        goPending.current = true;
        // A prefix that never expires would swallow an unrelated keystroke minutes later.
        goTimer.current = setTimeout(() => (goPending.current = false), 1500);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(goTimer.current);
    };
  }, [navigate]);

  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
}
