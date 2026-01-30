// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User } from '../types';

interface UseNotificationListenerParams {
  user: User | null;
  onTransactionDetected: (tx: Transaction) => void;
}

export const useNotificationListener = ({
  user,
  onTransactionDetected,
}: UseNotificationListenerParams) => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const plugin = (Capacitor as any).Plugins?.CovaultNotification;
        if (!plugin || typeof plugin.addListener !== 'function') return;

        const handle = await plugin.addListener(
          'transactionDetected',
          (event: any) => {
            console.log('[notification] Transaction detected:', event);
            if (!user?.id) {
              console.warn(
                '[notification] No user logged in, ignoring transaction',
              );
              return;
            }

            const tx: Transaction = {
              id: crypto.randomUUID(),
              user_id: user.id,
              vendor: event.vendor || 'Unknown Merchant',
              amount: event.amount || 0,
              date: new Date().toISOString().slice(0, 10),
              budget_id: null, // User will categorize later
              is_projected: false,
              label: 'Auto-Added',
              userName: user.name || 'User',
              created_at: new Date().toISOString(),
            };

            onTransactionDetected(tx);
          },
        );

        cleanup = () => handle.remove();
      } catch (e) {
        console.warn(
          '[notification] Could not set up transaction listener:',
          e,
        );
      }
    };

    setupListener();

    return () => {
      cleanup?.();
    };
  }, [user, onTransactionDetected]);
};
