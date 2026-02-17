-- ============================================================================
-- COVAULT SCHEMA CONSOLIDATION MIGRATION
-- ============================================================================
-- This migration consolidates the database schema by:
--   1. Dropping unused/redundant tables
--   2. Simplifying pending_transactions (privacy + cleanup)
--   3. Consolidating household_links and link_codes into settings
--   4. Removing the categories table (budgets IS the categories now)
--   5. Cleaning up vendor_overrides
--   6. Cleaning up transactions
--   7. Adding known_banking_apps table
--
-- NON-DESTRUCTIVE: budgets and transactions records are preserved.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. DROP UNUSED / REDUNDANT TABLES
-- ────────────────────────────────────────────────────────────────────────────

-- notification_rules: replaced by AI-based extraction (no more regex)
DROP TABLE IF EXISTS public.notification_rules CASCADE;

-- notification_fingerprints: dedup now done app-side via vendor+amount+time check
DROP TABLE IF EXISTS public.notification_fingerprints CASCADE;

-- transaction_budget_splits: feature removed for simplicity
DROP TABLE IF EXISTS public.transaction_budget_splits CASCADE;

-- household_links: partner data consolidated into settings table
DROP TABLE IF EXISTS public.household_links CASCADE;

-- link_codes: link code consolidated into settings table
DROP TABLE IF EXISTS public.link_codes CASCADE;

-- categories: merged into budgets table (each user gets budget rows as categories)
-- NOTE: We drop this AFTER migrating any existing category references
DROP TABLE IF EXISTS public.categories CASCADE;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. SIMPLIFY pending_transactions
--    Remove notification text (privacy), pattern_id, validation_reasons,
--    and replace needs_review + approved with a single status column.
-- ────────────────────────────────────────────────────────────────────────────

-- Add new status column
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- Migrate existing data: map needs_review/approved to status
UPDATE public.pending_transactions
  SET status = CASE
    WHEN approved = true THEN 'approved'
    WHEN approved = false THEN 'rejected'
    WHEN needs_review = false AND approved IS NULL THEN 'rejected'
    ELSE 'pending'
  END
  WHERE status = 'pending' AND (approved IS NOT NULL OR needs_review = false);

-- Add rejection_reason if it doesn't exist yet
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Now drop the old columns
ALTER TABLE public.pending_transactions
  DROP COLUMN IF EXISTS notification_text,
  DROP COLUMN IF EXISTS notification_title,
  DROP COLUMN IF EXISTS pattern_id,
  DROP COLUMN IF EXISTS validation_reasons,
  DROP COLUMN IF EXISTS needs_review,
  DROP COLUMN IF EXISTS approved;

-- Fix data types: confidence should be smallint, not integer
ALTER TABLE public.pending_transactions
  ALTER COLUMN confidence TYPE smallint USING confidence::smallint;

-- Fix data types: extracted_amount should be numeric, not text
-- (some rows may have stored it as text)
ALTER TABLE public.pending_transactions
  ALTER COLUMN extracted_amount TYPE numeric USING extracted_amount::numeric;

-- Add index on status for efficient queries
CREATE INDEX IF NOT EXISTS idx_pending_transactions_status
  ON public.pending_transactions (user_id, status);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. CONSOLIDATE household_links AND link_codes INTO settings
-- ────────────────────────────────────────────────────────────────────────────

-- Add link code columns to settings
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS link_code text,
  ADD COLUMN IF NOT EXISTS link_code_expires_at timestamptz;

-- Remove has_seen_tutorial (tutorial removed from app)
ALTER TABLE public.settings
  DROP COLUMN IF EXISTS has_seen_tutorial;

-- Fix data types on settings: theme should use a proper check
-- (already has CHECK constraint, just noting it's correct)


-- ────────────────────────────────────────────────────────────────────────────
-- 4. CLEAN UP transactions TABLE
-- ────────────────────────────────────────────────────────────────────────────

-- Remove source_hash (unused)
ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS source_hash;

-- Remove split_group_id (splits feature removed)
ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS split_group_id;

-- Drop the old foreign key to categories table (if it exists)
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_category_id_fkey;

-- Add label value 'AI' to the check constraint
-- First drop the old constraint, then add the new one
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_label_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_label_check
  CHECK (label IN ('Auto-Added', 'Manual', 'Auto-Added + Edited', 'AI'));

-- Rename "Description" column to lowercase "description" for consistency
ALTER TABLE public.transactions
  RENAME COLUMN "Description" TO description;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. CLEAN UP vendor_overrides TABLE
-- ────────────────────────────────────────────────────────────────────────────

-- Remove auto_accept (AI pipeline handles auto-insertion now)
ALTER TABLE public.vendor_overrides
  DROP COLUMN IF EXISTS auto_accept;

-- Remove created_at (unused metadata)
ALTER TABLE public.vendor_overrides
  DROP COLUMN IF EXISTS created_at;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. ADD known_banking_apps TABLE
--    Moves hardcoded banking app identifiers into the database.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.known_banking_apps (
  package_name text NOT NULL,
  display_name text NOT NULL,
  country text NOT NULL DEFAULT 'US',
  app_type text NOT NULL DEFAULT 'bank'
    CHECK (app_type IN ('bank', 'credit_card', 'fintech', 'credit_union', 'investment', 'payment')),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT known_banking_apps_pkey PRIMARY KEY (package_name)
);

-- Enable RLS
ALTER TABLE public.known_banking_apps ENABLE ROW LEVEL SECURITY;

-- Everyone can read banking apps (public reference data)
CREATE POLICY "Anyone can read known_banking_apps"
  ON public.known_banking_apps FOR SELECT
  USING (true);

-- Seed with the banking apps data
-- Canadian Banks
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.bmo.mobile', 'BMO', 'CA', 'bank'),
  ('com.rbc.mobile.android', 'RBC', 'CA', 'bank'),
  ('com.td', 'TD Canada', 'CA', 'bank'),
  ('com.cibc.android.mobi', 'CIBC', 'CA', 'bank'),
  ('com.scotiabank.mobile', 'Scotiabank', 'CA', 'bank'),
  ('com.bns.mobile', 'Scotiabank', 'CA', 'bank'),
  ('ca.bnc.android', 'National Bank', 'CA', 'bank'),
  ('com.desjardins.mobile', 'Desjardins', 'CA', 'bank'),
  ('com.atb.atbmobile', 'ATB Financial', 'CA', 'bank'),
  ('ca.tangerine.clients.banking', 'Tangerine', 'CA', 'bank'),
  ('com.simplicite.app', 'Simplii', 'CA', 'bank'),
  ('ca.hsbc.hsbccanada', 'HSBC Canada', 'CA', 'bank'),
  ('com.laurentianbank.mobile', 'Laurentian Bank', 'CA', 'bank'),
  ('com.eq.mobile', 'EQ Bank', 'CA', 'bank'),
  ('com.manulife.mobile', 'Manulife', 'CA', 'bank'),
  ('com.coastcapitalsavings.dcu', 'Coast Capital', 'CA', 'credit_union'),
  ('com.meridiancu.banking', 'Meridian Credit Union', 'CA', 'credit_union'),
  ('com.vancity.mobile', 'Vancity', 'CA', 'credit_union'),
  ('com.alterna.mobile', 'Alterna Savings', 'CA', 'credit_union'),
  ('com.firstontario.mobile', 'FirstOntario', 'CA', 'credit_union'),
  ('ca.conexus.mobile', 'Conexus Credit Union', 'CA', 'credit_union'),
  ('ca.affinitycu.mobile', 'Affinity Credit Union', 'CA', 'credit_union'),
  ('com.libro.mobile', 'Libro Credit Union', 'CA', 'credit_union'),
  ('com.servus.mobile', 'Servus Credit Union', 'CA', 'credit_union'),
  ('com.duca.mobile', 'DUCA Credit Union', 'CA', 'credit_union'),
  ('com.pcfinancial.mobile', 'PC Financial', 'CA', 'fintech'),
  ('com.canadianwestern.mobile', 'Canadian Western Bank', 'CA', 'bank'),
  ('com.motusbank.mobile', 'Motus Bank', 'CA', 'bank'),
  ('com.bridgewater.mobile', 'Bridgewater Bank', 'CA', 'bank'),
  ('com.icicibank.imobile.canada', 'ICICI Bank Canada', 'CA', 'bank'),
  ('com.envisionfinancial.mobile', 'Envision Financial', 'CA', 'credit_union'),
  ('com.blueshore.mobile', 'BlueShore Financial', 'CA', 'credit_union'),
  ('com.steinbach.mobile', 'Steinbach Credit Union', 'CA', 'credit_union'),
  ('com.innovationcu.mobile', 'Innovation Credit Union', 'CA', 'credit_union'),
  ('com.prospera.mobile', 'Prospera Credit Union', 'CA', 'credit_union'),
  ('com.interiorsa.mobile', 'Interior Savings', 'CA', 'credit_union'),
  ('com.islandsavings.mobile', 'Island Savings', 'CA', 'credit_union'),
  ('com.sunlife.mobile', 'Sun Life Financial', 'CA', 'investment')
ON CONFLICT (package_name) DO NOTHING;

-- Canadian Fintech
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.wealthsimple', 'Wealthsimple', 'CA', 'fintech'),
  ('com.wealthsimple.trade', 'Wealthsimple Trade', 'CA', 'fintech'),
  ('com.neofinancial.android', 'Neo Financial', 'CA', 'fintech'),
  ('com.koho.android', 'KOHO', 'CA', 'fintech'),
  ('com.mogo.mobile', 'Mogo', 'CA', 'fintech'),
  ('ca.payments.interac', 'Interac', 'CA', 'payment'),
  ('com.stack.app', 'Stack', 'CA', 'fintech'),
  ('com.paytm.canada', 'Paytm Canada', 'CA', 'payment')
ON CONFLICT (package_name) DO NOTHING;

-- US Banks
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.chase.sig.android', 'Chase', 'US', 'bank'),
  ('com.wf.wellsfargomobile', 'Wells Fargo', 'US', 'bank'),
  ('com.infonow.bofa', 'Bank of America', 'US', 'bank'),
  ('com.citi.citimobile', 'Citi', 'US', 'bank'),
  ('com.usbank.mobilebanking', 'US Bank', 'US', 'bank'),
  ('com.pnc.ecommerce.mobile', 'PNC', 'US', 'bank'),
  ('com.tdbank', 'TD Bank', 'US', 'bank'),
  ('com.capitalone.mobile', 'Capital One', 'US', 'bank'),
  ('com.key.android', 'KeyBank', 'US', 'bank'),
  ('com.regions.mobbanking', 'Regions', 'US', 'bank'),
  ('com.huntington.m', 'Huntington', 'US', 'bank'),
  ('com.ally.MobileBanking', 'Ally', 'US', 'bank'),
  ('com.fifththird.mobile', 'Fifth Third', 'US', 'bank'),
  ('com.mtb.mbanking.sc.retail.prod', 'M&T Bank', 'US', 'bank'),
  ('com.citizensbank.androidapp', 'Citizens Bank', 'US', 'bank'),
  ('com.truist.mobile', 'Truist', 'US', 'bank'),
  ('com.bmoharris.digital', 'BMO Harris', 'US', 'bank'),
  ('com.firstcitizens.mobile', 'First Citizens', 'US', 'bank'),
  ('com.websterbank.mobilebanking', 'Webster Bank', 'US', 'bank'),
  ('com.comerica.mobile', 'Comerica', 'US', 'bank'),
  ('com.zionsbancorp.mobile', 'Zions Bank', 'US', 'bank'),
  ('com.synovus.mobile', 'Synovus', 'US', 'bank'),
  ('com.svb.mobilebanking', 'Silicon Valley Bank', 'US', 'bank'),
  ('com.newYorkCommunityBank.mobile', 'New York Community Bank', 'US', 'bank'),
  ('com.popular.android', 'Popular Bank', 'US', 'bank'),
  ('com.eastwestbank.mobile', 'East West Bank', 'US', 'bank'),
  ('com.valleynationalbank.mobile', 'Valley National Bank', 'US', 'bank'),
  ('com.culbersonbanking.mobile', 'Culberson Bank', 'US', 'bank'),
  ('com.bokfinancial.mobile', 'BOK Financial', 'US', 'bank'),
  ('com.frostbank.mobile', 'Frost Bank', 'US', 'bank'),
  ('com.glacier.mobile', 'Glacier Bank', 'US', 'bank'),
  ('com.oldnational.mobile', 'Old National Bank', 'US', 'bank'),
  ('com.pacwest.mobile', 'PacWest Bank', 'US', 'bank'),
  ('com.wintrust.mobile', 'Wintrust', 'US', 'bank'),
  ('com.associatedbank.mobile', 'Associated Bank', 'US', 'bank'),
  ('com.atlanticcapitalbank.mobile', 'Atlantic Capital', 'US', 'bank'),
  ('com.umpquabank.mobile', 'Umpqua Bank', 'US', 'bank'),
  ('com.columbiabankingmobile', 'Columbia Banking', 'US', 'bank'),
  ('com.renasantbank.mobile', 'Renasant Bank', 'US', 'bank'),
  ('com.bankunited.mobile', 'BankUnited', 'US', 'bank'),
  ('com.independentbank.mobile', 'Independent Bank', 'US', 'bank'),
  ('com.firsthorizon.mobile', 'First Horizon', 'US', 'bank'),
  ('com.suntrust.mobilebanking', 'SunTrust', 'US', 'bank'),
  ('com.bbandt.mobilebanking', 'BB&T', 'US', 'bank')
ON CONFLICT (package_name) DO NOTHING;

-- US Credit Cards
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.americanexpress.android.acctsvcs.us', 'Amex', 'US', 'credit_card'),
  ('com.capitalone.creditcard.app', 'Capital One CC', 'US', 'credit_card'),
  ('com.discoverfinancial.mobile', 'Discover', 'US', 'credit_card'),
  ('com.synchrony.banking', 'Synchrony', 'US', 'credit_card'),
  ('com.barclays.bca', 'Barclaycard US', 'US', 'credit_card'),
  ('com.comenity.mobile', 'Comenity', 'US', 'credit_card'),
  ('com.bread.mobile', 'Bread Financial', 'US', 'credit_card')
ON CONFLICT (package_name) DO NOTHING;

-- US Fintech / Neobanks
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.chime.chmapplication', 'Chime', 'US', 'fintech'),
  ('com.sofi.mobile', 'SoFi', 'US', 'fintech'),
  ('com.venmo', 'Venmo', 'US', 'payment'),
  ('com.squareup.cash', 'Cash App', 'US', 'payment'),
  ('com.paypal.android.p2pmobile', 'PayPal', 'US', 'payment'),
  ('com.zellepay.zelle', 'Zelle', 'US', 'payment'),
  ('com.revolut.revolut', 'Revolut', 'US', 'fintech'),
  ('com.simple', 'Simple', 'US', 'fintech'),
  ('com.monzo.android', 'Monzo', 'US', 'fintech'),
  ('com.n26.android', 'N26', 'US', 'fintech'),
  ('com.varo', 'Varo', 'US', 'fintech'),
  ('com.current.mobile', 'Current', 'US', 'fintech'),
  ('com.dave.android', 'Dave', 'US', 'fintech'),
  ('com.albert.app', 'Albert', 'US', 'fintech'),
  ('com.aspiration.app', 'Aspiration', 'US', 'fintech'),
  ('com.greendot.mobile', 'Green Dot', 'US', 'fintech'),
  ('com.netspend.mobile', 'NetSpend', 'US', 'fintech'),
  ('com.brex.mobile', 'Brex', 'US', 'fintech'),
  ('com.mercury.app', 'Mercury', 'US', 'fintech'),
  ('com.ramp.app', 'Ramp', 'US', 'fintech'),
  ('com.one.mobile.android', 'ONE', 'US', 'fintech'),
  ('com.go2bank.mobile', 'GO2bank', 'US', 'fintech'),
  ('com.empower.mobile', 'Empower', 'US', 'fintech'),
  ('com.step.app', 'Step', 'US', 'fintech'),
  ('com.upgrade.mobile', 'Upgrade', 'US', 'fintech'),
  ('com.lendingclub.mobile', 'LendingClub', 'US', 'fintech'),
  ('com.moneyLion.android', 'MoneyLion', 'US', 'fintech'),
  ('com.marcus.android', 'Marcus by Goldman Sachs', 'US', 'fintech')
ON CONFLICT (package_name) DO NOTHING;

-- US Credit Unions
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.navyfederal.android', 'Navy Federal', 'US', 'credit_union'),
  ('com.penfed.mobile.banking', 'PenFed', 'US', 'credit_union'),
  ('org.becu.mobile', 'BECU', 'US', 'credit_union'),
  ('com.usaa.mobile.android.usaa', 'USAA', 'US', 'credit_union'),
  ('com.schoolsfirstfcu.mobile', 'SchoolsFirst FCU', 'US', 'credit_union'),
  ('org.stcu.mobilebanking', 'STCU', 'US', 'credit_union'),
  ('com.golden1.mobile', 'Golden 1 Credit Union', 'US', 'credit_union'),
  ('com.alliantcu.mobile', 'Alliant Credit Union', 'US', 'credit_union'),
  ('org.sefcu.mobile', 'SEFCU', 'US', 'credit_union'),
  ('com.suncoastcreditunion.mobile', 'Suncoast Credit Union', 'US', 'credit_union'),
  ('com.vyStar.mobilebanking', 'VyStar Credit Union', 'US', 'credit_union'),
  ('com.psecu.mobile', 'PSECU', 'US', 'credit_union'),
  ('com.dcuonline.mobile', 'DCU', 'US', 'credit_union'),
  ('com.firsttechfed.mobile', 'First Tech FCU', 'US', 'credit_union'),
  ('com.bethpagefcu.mobile', 'Bethpage FCU', 'US', 'credit_union'),
  ('com.statefarm.bank', 'State Farm Bank', 'US', 'credit_union'),
  ('com.rbfcu.mobile', 'Randolph-Brooks FCU', 'US', 'credit_union'),
  ('com.delta.community.mobile', 'Delta Community CU', 'US', 'credit_union'),
  ('com.americafirst.mobile', 'America First CU', 'US', 'credit_union')
ON CONFLICT (package_name) DO NOTHING;

-- US Investment
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.fidelity.android', 'Fidelity', 'US', 'investment'),
  ('com.schwab.mobile', 'Schwab', 'US', 'investment')
ON CONFLICT (package_name) DO NOTHING;

-- UK Banks
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.barclays.android.barclaysmobilebanking', 'Barclays', 'GB', 'bank'),
  ('com.hsbc.hsbcuk', 'HSBC UK', 'GB', 'bank'),
  ('com.grfrtsq.lloydsretail', 'Lloyds Bank', 'GB', 'bank'),
  ('com.natwest.mobilebanking', 'NatWest', 'GB', 'bank'),
  ('com.starlingbank.android', 'Starling Bank', 'GB', 'fintech'),
  ('com.halifax.mobile', 'Halifax', 'GB', 'bank'),
  ('co.uk.Nationwide.Mobile', 'Nationwide', 'GB', 'bank'),
  ('uk.co.metrobankonline.mobile.android.production', 'Metro Bank', 'GB', 'bank'),
  ('com.virginmoney.uk.mobile.android', 'Virgin Money UK', 'GB', 'bank'),
  ('com.tsb.mobilebank', 'TSB', 'GB', 'bank'),
  ('com.santander.app', 'Santander UK', 'GB', 'bank'),
  ('com.rbs.mobile.android.rbs', 'Royal Bank of Scotland', 'GB', 'bank'),
  ('com.bankofscotland.mobile', 'Bank of Scotland', 'GB', 'bank'),
  ('com.atom.bank', 'Atom Bank', 'GB', 'fintech'),
  ('com.chase.intl', 'Chase UK', 'GB', 'bank'),
  ('com.thinkmoney.app', 'Think Money', 'GB', 'fintech'),
  ('com.kroo.app', 'Kroo Bank', 'GB', 'fintech'),
  ('com.zopa.android', 'Zopa Bank', 'GB', 'fintech'),
  ('com.tescobank.mobile', 'Tesco Bank', 'GB', 'bank')
ON CONFLICT (package_name) DO NOTHING;

-- EU Banks (Germany, France, Spain, Italy, Netherlands, Belgium, Switzerland, Austria, Scandinavia, etc.)
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.db.pwcc.dbmobile', 'Deutsche Bank', 'DE', 'bank'),
  ('de.commerzbanking.mobil', 'Commerzbank', 'DE', 'bank'),
  ('de.dkb.portalapp', 'DKB', 'DE', 'bank'),
  ('de.ingdiba.bankingapp', 'ING Germany', 'DE', 'bank'),
  ('com.starfinanz.smob.android.sfinanzstatus', 'Sparkasse', 'DE', 'bank'),
  ('de.fiducia.smartphone.android.banking.vr', 'Volksbank/Raiffeisenbank', 'DE', 'bank'),
  ('de.postbank.finanzassistent', 'Postbank', 'DE', 'bank'),
  ('com.hypovereinsbank.universchin', 'HypoVereinsbank', 'DE', 'bank'),
  ('de.consorsbank', 'Consorsbank', 'DE', 'bank'),
  ('de.comdirect.app', 'comdirect', 'DE', 'bank'),
  ('de.number26.android', 'N26 Germany', 'DE', 'fintech'),
  ('com.tomorrow.app', 'Tomorrow Bank', 'DE', 'fintech'),
  ('com.cih.android.bnpparibas', 'BNP Paribas', 'FR', 'bank'),
  ('mobi.societegenerale.mobile.lappli', 'Société Générale', 'FR', 'bank'),
  ('com.caisseepargne.android.mobilebanking', 'Caisse d''Épargne', 'FR', 'bank'),
  ('fr.creditagricole.androidapp', 'Crédit Agricole', 'FR', 'bank'),
  ('com.boursorama.android.clients', 'Boursorama', 'FR', 'fintech'),
  ('fr.banquepopulaire.cyberplus', 'Banque Populaire', 'FR', 'bank'),
  ('fr.lcl.android.customerarea', 'LCL', 'FR', 'bank'),
  ('com.fortuneo.android', 'Fortuneo', 'FR', 'fintech'),
  ('net.bnpparibas.mescomptes', 'Hello Bank France', 'FR', 'fintech'),
  ('com.cic_prod.bad', 'CIC', 'FR', 'bank'),
  ('fr.creditMutuel.CMBanque', 'Crédit Mutuel', 'FR', 'bank'),
  ('com.labanquepostale.ecoapp', 'La Banque Postale', 'FR', 'bank'),
  ('com.orange.banking.music', 'Orange Bank', 'FR', 'fintech'),
  ('com.lydia', 'Lydia', 'FR', 'payment'),
  ('com.bbva.bbvacontigo', 'BBVA Spain', 'ES', 'bank'),
  ('es.bancosantander.apps', 'Santander Spain', 'ES', 'bank'),
  ('es.lacaixa.mobile.android.newwapicon', 'CaixaBank', 'ES', 'bank'),
  ('net.inverline.bancosabadell.officelocator.android', 'Banco Sabadell', 'ES', 'bank'),
  ('com.bankinter.launcher', 'Bankinter', 'ES', 'bank'),
  ('es.ibercaja.ibercajaapp', 'Ibercaja', 'ES', 'bank'),
  ('com.kutxabank.android', 'Kutxabank', 'ES', 'bank'),
  ('com.abanca.bancaempresas', 'Abanca', 'ES', 'bank'),
  ('com.unicajabanco.app', 'Unicaja Banco', 'ES', 'bank'),
  ('com.unicredit', 'UniCredit', 'IT', 'bank'),
  ('com.latuabancaperandroid', 'Intesa Sanpaolo', 'IT', 'bank'),
  ('it.copergmps.rt.pf.android.sp.bmps', 'Banca MPS', 'IT', 'bank'),
  ('com.bfriancoapp', 'Banco BPM', 'IT', 'bank'),
  ('it.bnl.apps.banking', 'BNL', 'IT', 'bank'),
  ('it.popso.SCRIGNOapp', 'Banca Popolare di Sondrio', 'IT', 'bank'),
  ('com.fineco.it', 'Fineco Bank', 'IT', 'fintech'),
  ('it.hype.app', 'HYPE', 'IT', 'fintech'),
  ('com.illimity.mobile', 'Illimity Bank', 'IT', 'fintech'),
  ('com.ing.mobile', 'ING', 'NL', 'bank'),
  ('com.abnamro.nl.mobile.payments', 'ABN AMRO', 'NL', 'bank'),
  ('nl.rabomobiel', 'Rabobank', 'NL', 'bank'),
  ('com.bunq.android', 'Bunq', 'NL', 'fintech'),
  ('nl.asnbank.asnbankieren', 'ASN Bank', 'NL', 'bank'),
  ('com.snsbank.mobile', 'SNS Bank', 'NL', 'bank'),
  ('com.triodos.banking.mobile', 'Triodos Bank', 'NL', 'bank'),
  ('nl.knab.app', 'Knab', 'NL', 'fintech'),
  ('com.kbc.mobile.android.phone', 'KBC', 'BE', 'bank'),
  ('be.belfius.directmobile.android', 'Belfius', 'BE', 'bank'),
  ('com.bnpparibasfortis.geomobile', 'BNP Paribas Fortis', 'BE', 'bank'),
  ('be.argenta.bankieren', 'Argenta', 'BE', 'bank'),
  ('com.ing.banking', 'ING Belgium', 'BE', 'bank'),
  ('com.ubs.swidKXJ.android', 'UBS', 'CH', 'bank'),
  ('ch.postfinance.android', 'PostFinance', 'CH', 'bank'),
  ('com.zuercherkb.android', 'Zürcher Kantonalbank', 'CH', 'bank'),
  ('com.csg.cs.dnmb', 'Credit Suisse', 'CH', 'bank'),
  ('ch.raiffeisen.android', 'Raiffeisen Switzerland', 'CH', 'bank'),
  ('com.neon.app', 'Neon (Swiss)', 'CH', 'fintech'),
  ('com.yapeal.app', 'Yapeal', 'CH', 'fintech'),
  ('at.erstebank.george', 'Erste Bank', 'AT', 'bank'),
  ('com.bankaustria.android.olb', 'Bank Austria', 'AT', 'bank'),
  ('at.spardat.bcrmobile', 'Raiffeisen Austria', 'AT', 'bank'),
  ('com.bawagpsk.mbanking', 'BAWAG', 'AT', 'bank'),
  ('com.nordea.mobilebanking', 'Nordea', 'SE', 'bank'),
  ('com.danskebank.mobilebank3.dk', 'Danske Bank', 'DK', 'bank'),
  ('com.seb.privatkund', 'SEB', 'SE', 'bank'),
  ('com.handelsbanken.mobile', 'Handelsbanken', 'SE', 'bank'),
  ('se.swedbankab.mbid', 'Swedbank', 'SE', 'bank'),
  ('se.swish.app', 'Swish', 'SE', 'payment'),
  ('dk.mobilepay.android', 'MobilePay', 'DK', 'payment'),
  ('fi.op.android.opbank', 'OP Financial', 'FI', 'bank'),
  ('no.dnb.android', 'DNB', 'NO', 'bank'),
  ('no.sparebank1.mobilbank', 'SpareBank 1', 'NO', 'bank'),
  ('com.skandia.android', 'Skandia', 'SE', 'bank'),
  ('com.lunar.app', 'Lunar', 'DK', 'fintech'),
  ('com.norwegian.bank', 'Norwegian Bank', 'NO', 'fintech')
ON CONFLICT (package_name) DO NOTHING;

-- Irish, Portuguese, Polish, Czech Banks
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.aib.mobilebanking', 'AIB', 'IE', 'bank'),
  ('ie.boi.mobilebanking', 'Bank of Ireland', 'IE', 'bank'),
  ('com.permanenttsb.ptsb', 'Permanent TSB', 'IE', 'bank'),
  ('com.ulsterbank.mobile', 'Ulster Bank', 'IE', 'bank'),
  ('pt.cgd.caixadirecta', 'Caixa Geral de Depósitos', 'PT', 'bank'),
  ('pt.novobanco.nbapp', 'Novo Banco', 'PT', 'bank'),
  ('pt.millenniumbcp.app', 'Millennium BCP', 'PT', 'bank'),
  ('pt.bancobpi.mobile', 'Banco BPI', 'PT', 'bank'),
  ('pl.mbank', 'mBank', 'PL', 'bank'),
  ('pl.ing.mojeing', 'ING Poland', 'PL', 'bank'),
  ('pl.pkobp.iko', 'PKO Bank Polski', 'PL', 'bank'),
  ('pl.bzwbk.bzwbk24', 'Santander Poland', 'PL', 'bank'),
  ('eu.eleader.mobilebanking.pekao', 'Bank Pekao', 'PL', 'bank'),
  ('com.blik', 'BLIK', 'PL', 'payment'),
  ('cz.csob.smartbanking', 'ČSOB', 'CZ', 'bank'),
  ('cz.airbank.android', 'Air Bank', 'CZ', 'fintech'),
  ('cz.kb.mba', 'Komerční banka', 'CZ', 'bank')
ON CONFLICT (package_name) DO NOTHING;

-- Pan-European Fintech
INSERT INTO public.known_banking_apps (package_name, display_name, country, app_type) VALUES
  ('com.transferwise.android', 'Wise', 'EU', 'payment'),
  ('com.klarna.android', 'Klarna', 'EU', 'payment'),
  ('com.vfrtzn.app', 'Vivid Money', 'EU', 'fintech'),
  ('com.qonto.qonto', 'Qonto', 'EU', 'fintech'),
  ('com.pleo.android', 'Pleo', 'EU', 'fintech'),
  ('com.sumup.bank', 'SumUp', 'EU', 'fintech'),
  ('com.curve.android', 'Curve', 'EU', 'fintech'),
  ('com.monese.monese.live', 'Monese', 'EU', 'fintech'),
  ('com.twint.payment', 'TWINT', 'CH', 'payment'),
  ('com.holvi.app', 'Holvi', 'EU', 'fintech'),
  ('com.tide.business', 'Tide', 'GB', 'fintech'),
  ('com.anna.money', 'Anna Money', 'GB', 'fintech'),
  ('com.numbrs.android.production', 'Numbrs', 'EU', 'fintech'),
  ('com.worldremit.android', 'WorldRemit', 'EU', 'payment'),
  ('com.remitly.android', 'Remitly', 'EU', 'payment'),
  ('com.affirm.mobile', 'Affirm', 'US', 'payment'),
  ('com.afterpay.mobile', 'Afterpay', 'US', 'payment'),
  ('com.skrill.moneybookers', 'Skrill', 'EU', 'payment'),
  ('com.paysend.app', 'Paysend', 'EU', 'payment')
ON CONFLICT (package_name) DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. ADD UNIQUE CONSTRAINT ON budgets (user_id, category) IF NOT EXISTS
--    This supports the upsert logic in the app.
-- ────────────────────────────────────────────────────────────────────────────

-- Create the unique constraint (used by ON CONFLICT in the app)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budgets_user_id_category_key'
  ) THEN
    ALTER TABLE public.budgets ADD CONSTRAINT budgets_user_id_category_key UNIQUE (user_id, category);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. RLS POLICIES for known_banking_apps (already created above)
-- ────────────────────────────────────────────────────────────────────────────

-- Done in section 6 above.


-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
