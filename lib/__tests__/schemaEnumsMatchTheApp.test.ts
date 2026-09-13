import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYSTEM_CATEGORIES } from '../../constants';
import { Recurrence } from '../../types';

/**
 * supabase/schema.sql has to describe a database this app can actually use.
 *
 * It is the canonical schema and the starting point for a brand-new project,
 * and both of its enums had fallen behind the app: `Budgets` was missing
 * Shopping, Personal and Travel, and `Recurrence` was missing Yearly. Neither
 * omission is cosmetic. A database built from that file rejects any
 * transaction filed under one of the three newer categories — and the
 * recurring-charge lookup, which is what stops a subscription being captured
 * twice, FILTERS on the full list of cadences: a filter naming a label the
 * enum does not have fails the whole query rather than returning fewer rows,
 * which is how that lookup once returned 400 for months and saw nothing.
 *
 * The real drift check needs the live database and a service-role key
 * (scripts/check_schema_drift.sh), which CI does not have. This is the half
 * that can be checked from the repo alone: the two lists the app itself
 * treats as closed sets.
 */

const SCHEMA = readFileSync(resolve(__dirname, '../../supabase/schema.sql'), 'utf8');

function enumMembers(typeName: string): string[] {
  const at = SCHEMA.indexOf(`CREATE TYPE public."${typeName}" AS ENUM`);
  expect(at, `schema.sql should declare the ${typeName} enum`).toBeGreaterThan(-1);
  const body = SCHEMA.slice(at, SCHEMA.indexOf(');', at));
  // Comments inside the declaration are prose, not members.
  const withoutComments = body.replace(/--[^\n]*/g, '');
  return [...withoutComments.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the schema enums and the app', () => {
  it('offers every budget category the app can file into', () => {
    const declared = enumMembers('Budgets');
    for (const category of SYSTEM_CATEGORIES) {
      expect(
        declared,
        `schema.sql's Budgets enum is missing "${category.name}", so a database `
          + 'built from it would reject every transaction filed there',
      ).toContain(category.name);
    }
  });

  it('offers every cadence the app stores or asks about', () => {
    const declared = enumMembers('Recurrence');
    for (const cadence of Object.values(Recurrence)) {
      expect(
        declared,
        `schema.sql's Recurrence enum is missing "${cadence}" — an insert of it `
          + 'is rejected, and a SELECT that filters on it fails the whole query',
      ).toContain(cadence);
    }
  });

  it('declares nothing the app does not know about', () => {
    // The other direction matters too: a member here that the app has never
    // heard of is either a category nobody can reach or a sign the app's own
    // list was trimmed without the schema following.
    const names = new Set(SYSTEM_CATEGORIES.map((c) => c.name));
    for (const member of enumMembers('Budgets')) {
      expect(names, `schema.sql declares a budget "${member}" the app does not have`)
        .toContain(member);
    }
  });
});
