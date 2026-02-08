// lib/devMode.ts
// Dev mode context and utilities for comprehensive testing without DB writes.
import React, { createContext, useContext } from 'react';
import type { AppState, User, BudgetCategory, Transaction } from '../types';
import { SYSTEM_CATEGORIES } from '../constants';
import { supabaseUrl, supabaseAnonKey } from './supabase';

// ─── Credentials ─────────────────────────────────────────────────────────────
export const DEV_USERNAME = 'dev';
export const DEV_PASSWORD = 'shazbot2020';

// Hidden activation: number of rapid taps on logo and time window
export const DEV_TAP_COUNT = 5;
export const DEV_TAP_WINDOW_MS = 3000;

// ─── Context ─────────────────────────────────────────────────────────────────
export interface DevModeContextValue {
  isDevMode: boolean;
  /** Log message displayed when a DB write is intercepted */
  dbPingLog: string[];
  addPingLog: (msg: string) => void;
  clearPingLog: () => void;
}

export const DevModeContext = createContext<DevModeContextValue>({
  isDevMode: false,
  dbPingLog: [],
  addPingLog: () => {},
  clearPingLog: () => {},
});

export const useDevMode = () => useContext(DevModeContext);

// ─── Mock Data ───────────────────────────────────────────────────────────────

const DEV_USER_ID = 'dev-user-00000000-0000-0000-0000-000000000001';
const DEV_PARTNER_ID = 'dev-partner-00000000-0000-0000-0000-000000000002';

export const createDevUser = (solo: boolean): User => ({
  id: DEV_USER_ID,
  name: 'Dev Tester',
  email: 'dev@covault.test',
  hasJointAccounts: !solo,
  budgetingSolo: solo,
  monthlyIncome: 6500,
  ...(solo
    ? {}
    : {
        partnerId: DEV_PARTNER_ID,
        partnerEmail: 'partner@covault.test',
        partnerName: 'Dev Partner',
      }),
});

const DEV_BUDGET_LIMITS: Record<string, number> = {
  Housing: 1800,
  Groceries: 600,
  Transport: 300,
  Utilities: 250,
  Leisure: 400,
  Services: 200,
};
const DEFAULT_DEV_LIMIT = 150;

export const DEV_BUDGETS: BudgetCategory[] = SYSTEM_CATEGORIES.map((c) => ({
  ...c,
  totalLimit: DEV_BUDGET_LIMITS[c.name] ?? DEFAULT_DEV_LIMIT,
}));

const today = new Date();
const currentMonth = today.getUTCMonth();
const currentYear = today.getUTCFullYear();
const fmt = (d: Date) => d.toISOString();

function dateThisMonth(day: number): string {
  return fmt(new Date(Date.UTC(currentYear, currentMonth, day)));
}

function dateLastMonth(day: number): string {
  return fmt(new Date(Date.UTC(currentYear, currentMonth - 1, day)));
}

export const createDevTransactions = (solo: boolean): Transaction[] => {
  const userId = DEV_USER_ID;
  const partnerId = DEV_PARTNER_ID;
  const userName = 'Dev Tester';
  const partnerName = 'Dev Partner';

  const txs: Transaction[] = [
    // Housing
    { id: 'dev-tx-001', user_id: userId, vendor: 'Rent Payment', amount: 1500, date: dateThisMonth(1), budget_id: DEV_BUDGETS[0].id, recurrence: 'Monthly', label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(1) },
    { id: 'dev-tx-002', user_id: userId, vendor: 'Home Insurance', amount: 120, date: dateThisMonth(5), budget_id: DEV_BUDGETS[0].id, recurrence: 'Monthly', label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(5) },
    // Groceries
    { id: 'dev-tx-003', user_id: userId, vendor: 'Whole Foods', amount: 87.32, date: dateThisMonth(3), budget_id: DEV_BUDGETS[1].id, label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(3) },
    { id: 'dev-tx-004', user_id: userId, vendor: 'Trader Joe\'s', amount: 52.18, date: dateThisMonth(8), budget_id: DEV_BUDGETS[1].id, label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(8) },
    { id: 'dev-tx-005', user_id: userId, vendor: 'Costco', amount: 145.60, date: dateThisMonth(12), budget_id: DEV_BUDGETS[1].id, label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(12) },
    // Transport
    { id: 'dev-tx-006', user_id: userId, vendor: 'Shell Gas', amount: 48.00, date: dateThisMonth(4), budget_id: DEV_BUDGETS[2].id, label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(4) },
    { id: 'dev-tx-007', user_id: userId, vendor: 'Uber', amount: 22.50, date: dateThisMonth(10), budget_id: DEV_BUDGETS[2].id, label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(10) },
    // Utilities
    { id: 'dev-tx-008', user_id: userId, vendor: 'Electric Company', amount: 95.00, date: dateThisMonth(2), budget_id: DEV_BUDGETS[3].id, recurrence: 'Monthly', label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(2) },
    { id: 'dev-tx-009', user_id: userId, vendor: 'Water Bill', amount: 45.00, date: dateThisMonth(7), budget_id: DEV_BUDGETS[3].id, recurrence: 'Monthly', label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(7) },
    // Leisure
    { id: 'dev-tx-010', user_id: userId, vendor: 'Netflix', amount: 15.99, date: dateThisMonth(1), budget_id: DEV_BUDGETS[4].id, recurrence: 'Monthly', label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(1) },
    { id: 'dev-tx-011', user_id: userId, vendor: 'Movie Theater', amount: 32.00, date: dateThisMonth(9), budget_id: DEV_BUDGETS[4].id, label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(9) },
    { id: 'dev-tx-012', user_id: userId, vendor: 'Spotify', amount: 9.99, date: dateThisMonth(1), budget_id: DEV_BUDGETS[4].id, recurrence: 'Monthly', label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(1) },
    // Services
    { id: 'dev-tx-013', user_id: userId, vendor: 'Haircut', amount: 35.00, date: dateThisMonth(6), budget_id: DEV_BUDGETS[5].id, label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(6) },
    // Other
    { id: 'dev-tx-014', user_id: userId, vendor: 'Amazon', amount: 67.45, date: dateThisMonth(11), budget_id: DEV_BUDGETS[6].id, label: 'Auto-Added', is_projected: false, userName, created_at: dateThisMonth(11) },
    // Split transaction
    { id: 'dev-tx-015', user_id: userId, vendor: 'Target', amount: 120.00, date: dateThisMonth(7), budget_id: DEV_BUDGETS[1].id, label: 'Manual', is_projected: false, userName, created_at: dateThisMonth(7),
      splits: [
        { budget_id: DEV_BUDGETS[1].id, amount: 80.00 },
        { budget_id: DEV_BUDGETS[6].id, amount: 40.00 },
      ],
    },
    // Last month transactions (for history)
    { id: 'dev-tx-100', user_id: userId, vendor: 'Rent Payment', amount: 1500, date: dateLastMonth(1), budget_id: DEV_BUDGETS[0].id, recurrence: 'Monthly', label: 'Manual', is_projected: false, userName, created_at: dateLastMonth(1) },
    { id: 'dev-tx-101', user_id: userId, vendor: 'Whole Foods', amount: 92.10, date: dateLastMonth(5), budget_id: DEV_BUDGETS[1].id, label: 'Manual', is_projected: false, userName, created_at: dateLastMonth(5) },
    // Projected (future recurring)
    { id: 'dev-tx-200', user_id: userId, vendor: 'Internet Bill', amount: 65.00, date: dateThisMonth(25), budget_id: DEV_BUDGETS[3].id, recurrence: 'Monthly', label: 'Manual', is_projected: true, userName, created_at: dateThisMonth(1) },
  ];

  // Add partner transactions if couples mode
  if (!solo) {
    txs.push(
      { id: 'dev-tx-p01', user_id: partnerId, vendor: 'Partner Groceries', amount: 63.20, date: dateThisMonth(4), budget_id: DEV_BUDGETS[1].id, label: 'Manual', is_projected: false, userName: partnerName, created_at: dateThisMonth(4) },
      { id: 'dev-tx-p02', user_id: partnerId, vendor: 'Partner Gas', amount: 40.00, date: dateThisMonth(6), budget_id: DEV_BUDGETS[2].id, label: 'Auto-Added', is_projected: false, userName: partnerName, created_at: dateThisMonth(6) },
      { id: 'dev-tx-p03', user_id: partnerId, vendor: 'Partner Dinner', amount: 55.00, date: dateThisMonth(9), budget_id: DEV_BUDGETS[4].id, label: 'Manual', is_projected: false, userName: partnerName, created_at: dateThisMonth(9) },
    );
  }

  return txs;
};

export const createDevAppState = (solo: boolean): AppState => ({
  user: createDevUser(solo),
  budgets: DEV_BUDGETS,
  transactions: createDevTransactions(solo),
  settings: {
    rolloverEnabled: true,
    rolloverOverspend: false,
    useLeisureAsBuffer: true,
    showSavingsInsight: true,
    theme: 'light',
    hasSeenTutorial: true,
    notificationsEnabled: false,
    hiddenCategories: [],
    notification_rules: [],
  },
});

// ─── DB Ping ─────────────────────────────────────────────────────────────────
// Pings the Supabase REST endpoint to verify connectivity without writing data.

export const pingDatabase = async (): Promise<{
  reachable: boolean;
  latencyMs: number;
  error?: string;
}> => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { reachable: false, latencyMs: 0, error: 'Supabase not configured' };
  }

  const start = performance.now();
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });
    const latencyMs = Math.round(performance.now() - start);
    return { reachable: res.ok || res.status === 404, latencyMs };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return { reachable: false, latencyMs, error: err?.message || String(err) };
  }
};
