// lib/readGate.ts
//
// "The newest answer wins", for a read whose result REPLACES what is on screen.
//
// Loading the transaction list replaces it, and two loads are routinely in
// flight at the same moment: the one the app issues while it is starting, and
// the one a capture issues the instant its row is written. Launching the app by
// tapping a capture notification starts both.
//
// Nothing made them come back in the order they were sent. When the launch
// request — issued a moment BEFORE the purchase was written — answered last, it
// put back the list as it stood before the purchase existed. The purchase was
// then missing from the dashboard until something else happened to reload, and
// for a capture that files itself nothing ever does: the user looks in the
// budget, does not find it, and enters it a second time by hand.
//
// A gate hands out a ticket per read, in the order the reads START, and refuses
// any answer older than the one already applied.

export interface ReadGate {
  /** Take a ticket. Call this before the request goes out, never after. */
  take(): number;
  /**
   * May this ticket's answer be applied? True claims it, so a later answer
   * cannot then be overtaken by an earlier one.
   */
  accepts(ticket: number): boolean;
}

export function createReadGate(): ReadGate {
  let issued = 0;
  let applied = 0;
  return {
    take: () => ++issued,
    accepts(ticket: number): boolean {
      // Strictly older is refused. Equal cannot happen twice — every read takes
      // a fresh ticket — and treating equal as stale would refuse the very
      // first answer, since nothing has been applied yet.
      if (ticket < applied) return false;
      applied = ticket;
      return true;
    },
  };
}
