import { useCallback, useSyncExternalStore } from 'react';

/**
 * THEME AND SIDEBAR STATE, SHARED WITH THE PRE-PAINT SCRIPT.
 *
 * The inline script in `index.html` has already read both of these out of `localStorage` and
 * stamped them onto `<html>` before the first pixel was painted. This module is the React
 * side of the same contract: it reads the attribute the script set — never `localStorage`
 * directly — so there is exactly one answer to "what theme is this" at any moment.
 *
 * Reading storage again here would introduce a second source of truth that disagrees with
 * the DOM for one render, which is the flash the inline script exists to prevent, moved
 * later rather than removed.
 *
 * KEEP THE KEYS AND ATTRIBUTE NAMES IN STEP WITH THAT SCRIPT. They are duplicated because a
 * module cannot be imported before paint; `security-headers.test.ts` pins the script's
 * bytes, and the test beside this file pins the names.
 */

export const THEME_KEY = 'dis-theme';
export const SIDEBAR_KEY = 'dis-sidebar';
const THEME_ATTR = 'data-theme';
const SIDEBAR_ATTR = 'data-sidebar';

/** What is actually painted. */
export type Theme = 'light' | 'dark';
/**
 * What the member CHOSE. `system` is a real preference, not the absence of one, and it is
 * the difference between "follow this device" and "always light" — which diverge the moment
 * the phone switches to dark at sunset.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type SidebarState = 'expanded' | 'rail';

/**
 * A store over a DOM attribute.
 *
 * `useSyncExternalStore` rather than `useState` so every component reading the theme sees
 * the same value in the same commit. Two independent `useState` copies of one global would
 * drift the moment anything other than the toggle changed it.
 */
function attributeStore<T extends string>(attribute: string, fallback: T) {
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get(): T {
      if (typeof document === 'undefined') return fallback;
      return (document.documentElement.getAttribute(attribute) as T | null) ?? fallback;
    },
    set(value: T, storageKey: string) {
      document.documentElement.setAttribute(attribute, value);
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        // Private browsing denies storage. The choice still applies for this session.
      }
      listeners.forEach((listener) => listener());
    },
    /** Paints the attribute WITHOUT writing storage — for a preference of `system`. */
    setResolvedOnly(value: T) {
      document.documentElement.setAttribute(attribute, value);
      listeners.forEach((listener) => listener());
    },
    /** The server snapshot. There is no SSR here, but React asks for it. */
    getServer: () => fallback,
  };
}

const themeStore = attributeStore<Theme>(THEME_ATTR, 'light');
const sidebarStore = attributeStore<SidebarState>(SIDEBAR_ATTR, 'expanded');

/** The resolved theme — what is on screen right now, whatever produced it. */
export function useTheme(): { theme: Theme } {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.getServer);
  return { theme };
}

/** What the member chose. Read from storage, because `system` leaves no trace on the DOM. */
function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * The setting itself.
 *
 * This moved out of the header. A theme switch sitting permanently beside the Rotary Year
 * badge gives a personal display preference the same visual weight as the dimension every
 * figure on the screen is scoped by — which is the wrong hierarchy, and it reads as a toy on
 * a screen somebody is about to put in front of a board.
 *
 * Choosing `system` deliberately CLEARS the stored value rather than storing the word. The
 * pre-paint script in index.html treats "no stored preference" as "follow the device", so
 * clearing is what makes the two agree; writing `system` and teaching the script a third
 * case would be one more thing to keep in step across two files.
 */
export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(
    themeStore.subscribe,
    readPreference,
    () => 'system' as ThemePreference,
  );

  const setPreference = useCallback((next: ThemePreference) => {
    const resolved: Theme = next === 'system' ? systemTheme() : next;

    if (next === 'system') {
      try {
        localStorage.removeItem(THEME_KEY);
      } catch {
        // Private browsing. The resolved theme below still applies for this session.
      }
      themeStore.setResolvedOnly(resolved);
    } else {
      themeStore.set(resolved, THEME_KEY);
    }

    // The browser chrome follows the page. Slate on dark, paper on light — never the brand
    // colour: cranberry has retreated to the mark and the primary action, and an address bar
    // is neither.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#232529' : '#faf9f7');
  }, []);

  return { preference, setPreference };
}

export function useSidebar(): {
  state: SidebarState;
  isRail: boolean;
  toggle: () => void;
} {
  const state = useSyncExternalStore(
    sidebarStore.subscribe,
    sidebarStore.get,
    sidebarStore.getServer,
  );

  const toggle = useCallback(() => {
    sidebarStore.set(sidebarStore.get() === 'rail' ? 'expanded' : 'rail', SIDEBAR_KEY);
  }, []);

  return { state, isRail: state === 'rail', toggle };
}
