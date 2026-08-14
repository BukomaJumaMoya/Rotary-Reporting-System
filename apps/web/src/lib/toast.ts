import { createContext, useContext } from 'react';

/**
 * The toast channel.
 *
 * The context and the hook live here, apart from the provider component, so the design
 * system module exports components only and keeps fast refresh.
 */
export interface ToastMessage {
  id: number;
  tone: 'success' | 'error';
  text: string;
}

export const ToastContext = createContext<{
  show: (tone: ToastMessage['tone'], text: string) => void;
}>({ show: () => undefined });

/**
 * Every mutation says something. No silent failures — a member who taps Save and sees
 * nothing assumes it worked, and finds out in March that it did not.
 */
export function useToast() {
  const { show } = useContext(ToastContext);
  return {
    success: (text: string) => show('success', text),
    error: (text: string) => show('error', text),
  };
}
