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

export type Theme = 'light' | 'dark';
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
    /** The server snapshot. There is no SSR here, but React asks for it. */
    getServer: () => fallback,
  };
}

const themeStore = attributeStore<Theme>(THEME_ATTR, 'light');
const sidebarStore = attributeStore<SidebarState>(SIDEBAR_ATTR, 'expanded');

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.getServer);

  const toggle = useCallback(() => {
    const next: Theme = themeStore.get() === 'dark' ? 'light' : 'dark';
    themeStore.set(next, THEME_KEY);

    // The browser chrome follows the page. Without this the address bar stays cranberry on a
    // dark page, which looks like a rendering fault rather than a choice.
    const meta = document.querySelector('meta[name="theme-color"]');
    // Slate on dark, paper on light. NOT the brand colour: cranberry has retreated to the
    // mark and the primary action, and the address bar is neither.
    meta?.setAttribute('content', next === 'dark' ? '#232529' : '#faf9f7');
  }, []);

  return { theme, toggle };
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
