export interface NotificationInsertError {
  message?: string;
}

export type InsertNotificationRow = (
  row: Record<string, unknown>,
) => Promise<{ error: NotificationInsertError | null }>;

/**
 * Insert a captured transaction, retrying without optional late-added columns
 * when an older database schema rejects them.
 */
export async function insertNotificationTransaction(
  row: Record<string, unknown>,
  insert: InsertNotificationRow,
): Promise<NotificationInsertError | null> {
  let { error } = await insert(row);

  if (error && /confidence|auto_filed/i.test(error.message || '')) {
    const withoutLateColumns = { ...row };
    delete withoutLateColumns.confidence;
    delete withoutLateColumns.auto_filed;
    ({ error } = await insert(withoutLateColumns));
  }

  return error;
}
