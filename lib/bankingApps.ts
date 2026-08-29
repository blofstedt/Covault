import { log } from './log';
import { restFetch } from './apiHelpers';
// Known banking app package names (must match NotificationListener.java)
/*
 * A package name here only does something if it is exactly right. There is no
 * partial match and no error: a typo means that bank is never captured, in
 * silence, and the user has no way to tell that apart from the feature being
 * broken. Some of this list was assembled by pattern rather than by looking,
 * and several entries turned out to be plausible-looking guesses — Tangerine's
 * was one character short of the real one.
 *
 * Entries marked "verified" were checked against the app's actual Play Store
 * listing. Unmarked ones have not been, and should be treated as unproven
 * rather than trusted. Where a check found a different package the correct one
 * is ADDED rather than swapped in: an unused package name matches nothing and
 * costs nothing, while removing one that turns out to be a legacy or regional
 * build would take a working capture away from somebody.
 *
 * The user-facing answer to a bank that is missing or wrong is the same either
 * way, and does not need a release: notification settings offers every
 * installed app that looks financial, and approving one there reaches the
 * native listener as well as this list.
 */
export const KNOWN_BANKING_APPS: Record<string, string> = {
  // ── Canadian Banks ──────────────────────────────────────────────────
  'com.bmo.mobile': 'BMO',
  'com.rbc.mobile.android': 'RBC',
  'com.td': 'TD Canada',
  'com.cibc.android.mobi': 'CIBC',
  'com.scotiabank.mobile': 'Scotiabank',
  'com.scotiabank.banking': 'Scotiabank', // verified
  'com.bns.mobile': 'Scotiabank',
  'ca.bnc.android': 'National Bank',
  'com.desjardins.mobile': 'Desjardins',
  'com.atb.atbmobile': 'ATB Financial',
  'ca.tangerine.clients.banking': 'Tangerine',
  'ca.tangerine.clients.banking.app': 'Tangerine', // verified
  'com.simplicite.app': 'Simplii',
  'ca.hsbc.hsbccanada': 'HSBC Canada',
  'com.laurentianbank.mobile': 'Laurentian Bank',
  'com.eq.mobile': 'EQ Bank',
  'com.eqbank.eqbank': 'EQ Bank', // verified
  'com.manulife.mobile': 'Manulife',
  'com.coastcapitalsavings.dcu': 'Coast Capital',
  'com.meridiancu.banking': 'Meridian Credit Union',
  'com.vancity.mobile': 'Vancity',
  'com.alterna.mobile': 'Alterna Savings',
  'com.firstontario.mobile': 'FirstOntario',
  'ca.conexus.mobile': 'Conexus Credit Union',
  'ca.affinitycu.mobile': 'Affinity Credit Union',
  'com.libro.mobile': 'Libro Credit Union',
  'com.servus.mobile': 'Servus Credit Union',
  'com.duca.mobile': 'DUCA Credit Union',
  'com.pcfinancial.mobile': 'Simplii Financial', // verified — Simplii kept PC Financial's package
  'com.canadianwestern.mobile': 'Canadian Western Bank',
  'com.motusbank.mobile': 'Motus Bank',
  'com.bridgewater.mobile': 'Bridgewater Bank',
  'com.icicibank.imobile.canada': 'ICICI Bank Canada',
  'com.envisionfinancial.mobile': 'Envision Financial',
  'com.blueshore.mobile': 'BlueShore Financial',
  'com.steinbach.mobile': 'Steinbach Credit Union',
  'com.innovationcu.mobile': 'Innovation Credit Union',
  'com.prospera.mobile': 'Prospera Credit Union',
  'com.interiorsa.mobile': 'Interior Savings',
  'com.islandsavings.mobile': 'Island Savings',
  'com.sunlife.mobile': 'Sun Life Financial',

  // ── Canadian Fintech ────────────────────────────────────────────────
  'com.wealthsimple': 'Wealthsimple',
  'com.wealthsimple.trade': 'Wealthsimple Trade',
  'com.neofinancial.android': 'Neo Financial',
  'com.neofinancial.neo': 'Neo Financial', // verified
  'com.koho.android': 'KOHO',
  'ca.koho': 'KOHO', // verified
  'com.mogo.mobile': 'Mogo',
  'ca.payments.interac': 'Interac',
  'com.stack.app': 'Stack',
  'com.paytm.canada': 'Paytm Canada',

  // ── US Banks ────────────────────────────────────────────────────────
  'com.chase.sig.android': 'Chase',
  'com.wf.wellsfargomobile': 'Wells Fargo',
  'com.infonow.bofa': 'Bank of America',
  'com.citi.citimobile': 'Citi',
  'com.usbank.mobilebanking': 'US Bank',
  'com.pnc.ecommerce.mobile': 'PNC',
  'com.tdbank': 'TD Bank',
  'com.capitalone.mobile': 'Capital One',
  'com.konylabs.capitalone': 'Capital One', // verified
  'com.key.android': 'KeyBank',
  'com.regions.mobbanking': 'Regions',
  'com.huntington.m': 'Huntington',
  'com.ally.MobileBanking': 'Ally',
  'com.fifththird.mobile': 'Fifth Third',
  'com.mtb.mbanking.sc.retail.prod': 'M&T Bank',
  'com.citizensbank.androidapp': 'Citizens Bank',
  'com.truist.mobile': 'Truist',
  'com.bmoharris.digital': 'BMO Harris',
  'com.firstcitizens.mobile': 'First Citizens',
  'com.websterbank.mobilebanking': 'Webster Bank',
  'com.comerica.mobile': 'Comerica',
  'com.zionsbancorp.mobile': 'Zions Bank',
  'com.synovus.mobile': 'Synovus',
  'com.svb.mobilebanking': 'Silicon Valley Bank',
  'com.newYorkCommunityBank.mobile': 'New York Community Bank',
  'com.popular.android': 'Popular Bank',
  'com.eastwestbank.mobile': 'East West Bank',
  'com.valleynationalbank.mobile': 'Valley National Bank',
  'com.culbersonbanking.mobile': 'Culberson Bank',
  'com.bokfinancial.mobile': 'BOK Financial',
  'com.frostbank.mobile': 'Frost Bank',
  'com.glacier.mobile': 'Glacier Bank',
  'com.oldnational.mobile': 'Old National Bank',
  'com.pacwest.mobile': 'PacWest Bank',
  'com.wintrust.mobile': 'Wintrust',
  'com.associatedbank.mobile': 'Associated Bank',
  'com.atlanticcapitalbank.mobile': 'Atlantic Capital',
  'com.umpquabank.mobile': 'Umpqua Bank',
  'com.columbiabankingmobile': 'Columbia Banking',
  'com.renasantbank.mobile': 'Renasant Bank',
  'com.bankunited.mobile': 'BankUnited',
  'com.independentbank.mobile': 'Independent Bank',
  'com.firsthorizon.mobile': 'First Horizon',
  'com.suntrust.mobilebanking': 'SunTrust',
  'com.bbandt.mobilebanking': 'BB&T',

  // ── US Credit Cards ─────────────────────────────────────────────────
  'com.americanexpress.android.acctsvcs.us': 'Amex',
  'com.capitalone.creditcard.app': 'Capital One CC',
  'com.discoverfinancial.mobile': 'Discover',
  'com.synchrony.banking': 'Synchrony',
  'com.barclays.bca': 'Barclaycard US',
  'com.comenity.mobile': 'Comenity',
  'com.bread.mobile': 'Bread Financial',

  // ── US Fintech / Neobanks ───────────────────────────────────────────
  'com.chime.chmapplication': 'Chime',
  'com.sofi.mobile': 'SoFi',
  'com.venmo': 'Venmo',
  'com.squareup.cash': 'Cash App',
  'com.paypal.android.p2pmobile': 'PayPal',
  'com.zellepay.zelle': 'Zelle',
  'com.revolut.revolut': 'Revolut',
  'com.simple': 'Simple',
  'com.monzo.android': 'Monzo',
  'com.n26.android': 'N26',
  'com.varo': 'Varo',
  'com.current.mobile': 'Current',
  'com.dave.android': 'Dave',
  'com.albert.app': 'Albert',
  'com.aspiration.app': 'Aspiration',
  'com.greendot.mobile': 'Green Dot',
  'com.netspend.mobile': 'NetSpend',
  'com.brex.mobile': 'Brex',
  'com.mercury.app': 'Mercury',
  'com.ramp.app': 'Ramp',
  'com.one.mobile.android': 'ONE',
  'com.go2bank.mobile': 'GO2bank',
  'com.empower.mobile': 'Empower',
  'com.step.app': 'Step',
  'com.upgrade.mobile': 'Upgrade',
  'com.lendingclub.mobile': 'LendingClub',
  'com.moneyLion.android': 'MoneyLion',
  'com.marcus.android': 'Marcus by Goldman Sachs',

  // ── US Credit Unions ────────────────────────────────────────────────
  'com.navyfederal.android': 'Navy Federal',
  'com.penfed.mobile.banking': 'PenFed',
  'org.becu.mobile': 'BECU',
  'com.usaa.mobile.android.usaa': 'USAA',
  'com.schoolsfirstfcu.mobile': 'SchoolsFirst FCU',
  'org.stcu.mobilebanking': 'STCU',
  'com.golden1.mobile': 'Golden 1 Credit Union',
  'com.alliantcu.mobile': 'Alliant Credit Union',
  'org.sefcu.mobile': 'SEFCU',
  'com.suncoastcreditunion.mobile': 'Suncoast Credit Union',
  'com.vyStar.mobilebanking': 'VyStar Credit Union',
  'com.psecu.mobile': 'PSECU',
  'com.dcuonline.mobile': 'DCU',
  'com.firsttechfed.mobile': 'First Tech FCU',
  'com.bethpagefcu.mobile': 'Bethpage FCU',
  'com.statefarm.bank': 'State Farm Bank',
  'com.rbfcu.mobile': 'Randolph-Brooks FCU',
  'com.delta.community.mobile': 'Delta Community CU',
  'com.americafirst.mobile': 'America First CU',

  // ── US Banks with Brokerage + Spending ────────────────────────────
  'com.fidelity.android': 'Fidelity',
  'com.schwab.mobile': 'Schwab',

  // ── UK Banks ────────────────────────────────────────────────────────
  'com.barclays.android.barclaysmobilebanking': 'Barclays',
  'com.hsbc.hsbcuk': 'HSBC UK',
  'com.grfrtsq.lloydsretail': 'Lloyds Bank',
  'com.natwest.mobilebanking': 'NatWest',
  'com.starlingbank.android': 'Starling Bank',
  'com.halifax.mobile': 'Halifax',
  'co.uk.Nationwide.Mobile': 'Nationwide',
  'uk.co.metrobankonline.mobile.android.production': 'Metro Bank',
  'com.virginmoney.uk.mobile.android': 'Virgin Money UK',
  'com.tsb.mobilebank': 'TSB',
  'com.santander.app': 'Santander UK',
  'com.rbs.mobile.android.rbs': 'Royal Bank of Scotland',
  'com.bankofscotland.mobile': 'Bank of Scotland',
  'com.atom.bank': 'Atom Bank',
  'com.chase.intl': 'Chase UK',
  'com.thinkmoney.app': 'Think Money',
  'com.kroo.app': 'Kroo Bank',
  'com.zopa.android': 'Zopa Bank',
  'com.tescobank.mobile': 'Tesco Bank',

  // ── German Banks ────────────────────────────────────────────────────
  'com.db.pwcc.dbmobile': 'Deutsche Bank',
  'de.commerzbanking.mobil': 'Commerzbank',
  'de.dkb.portalapp': 'DKB',
  'de.ingdiba.bankingapp': 'ING Germany',
  'com.starfinanz.smob.android.sfinanzstatus': 'Sparkasse',
  'de.fiducia.smartphone.android.banking.vr': 'Volksbank/Raiffeisenbank',
  'de.postbank.finanzassistent': 'Postbank',
  'com.hypovereinsbank.universchin': 'HypoVereinsbank',
  'de.consorsbank': 'Consorsbank',
  'de.comdirect.app': 'comdirect',
  'de.number26.android': 'N26 Germany',
  'com.tomorrow.app': 'Tomorrow Bank',

  // ── French Banks ────────────────────────────────────────────────────
  'com.cih.android.bnpparibas': 'BNP Paribas',
  'mobi.societegenerale.mobile.lappli': 'Société Générale',
  'com.caisseepargne.android.mobilebanking': "Caisse d'Épargne",
  'fr.creditagricole.androidapp': 'Crédit Agricole',
  'com.boursorama.android.clients': 'Boursorama',
  'fr.banquepopulaire.cyberplus': 'Banque Populaire',
  'fr.lcl.android.customerarea': 'LCL',
  'com.fortuneo.android': 'Fortuneo',
  'net.bnpparibas.mescomptes': 'Hello Bank France',
  'com.cic_prod.bad': 'CIC',
  'fr.creditMutuel.CMBanque': 'Crédit Mutuel',
  'com.labanquepostale.ecoapp': 'La Banque Postale',
  'com.orange.banking.music': 'Orange Bank',
  'com.lydia': 'Lydia',

  // ── Spanish Banks ───────────────────────────────────────────────────
  'com.bbva.bbvacontigo': 'BBVA Spain',
  'es.bancosantander.apps': 'Santander Spain',
  'es.lacaixa.mobile.android.newwapicon': 'CaixaBank',
  'net.inverline.bancosabadell.officelocator.android': 'Banco Sabadell',
  'com.bankinter.launcher': 'Bankinter',
  'es.ibercaja.ibercajaapp': 'Ibercaja',
  'com.kutxabank.android': 'Kutxabank',
  'com.abanca.bancaempresas': 'Abanca',
  'com.unicajabanco.app': 'Unicaja Banco',

  // ── Italian Banks ───────────────────────────────────────────────────
  'com.unicredit': 'UniCredit',
  'com.latuabancaperandroid': 'Intesa Sanpaolo',
  'it.copergmps.rt.pf.android.sp.bmps': 'Banca MPS',
  'com.bfriancoapp': 'Banco BPM',
  'it.bnl.apps.banking': 'BNL',
  'it.popso.SCRIGNOapp': 'Banca Popolare di Sondrio',
  'com.fineco.it': 'Fineco Bank',
  'it.hype.app': 'HYPE',
  'com.illimity.mobile': 'Illimity Bank',

  // ── Dutch Banks ─────────────────────────────────────────────────────
  'com.ing.mobile': 'ING',
  'com.abnamro.nl.mobile.payments': 'ABN AMRO',
  'nl.rabomobiel': 'Rabobank',
  'com.bunq.android': 'Bunq',
  'nl.asnbank.asnbankieren': 'ASN Bank',
  'com.snsbank.mobile': 'SNS Bank',
  'com.triodos.banking.mobile': 'Triodos Bank',
  'nl.knab.app': 'Knab',

  // ── Belgian Banks ───────────────────────────────────────────────────
  'com.kbc.mobile.android.phone': 'KBC',
  'be.belfius.directmobile.android': 'Belfius',
  'com.bnpparibasfortis.geomobile': 'BNP Paribas Fortis',
  'be.argenta.bankieren': 'Argenta',
  'com.ing.banking': 'ING Belgium',

  // ── Swiss Banks ─────────────────────────────────────────────────────
  'com.ubs.swidKXJ.android': 'UBS',
  'ch.postfinance.android': 'PostFinance',
  'com.zuercherkb.android': 'Zürcher Kantonalbank',
  'com.csg.cs.dnmb': 'Credit Suisse',
  'ch.raiffeisen.android': 'Raiffeisen Switzerland',
  'com.neon.app': 'Neon (Swiss)',
  'com.yapeal.app': 'Yapeal',

  // ── Austrian Banks ──────────────────────────────────────────────────
  'at.erstebank.george': 'Erste Bank',
  'com.bankaustria.android.olb': 'Bank Austria',
  'at.spardat.bcrmobile': 'Raiffeisen Austria',
  'com.bawagpsk.mbanking': 'BAWAG',

  // ── Scandinavian Banks ──────────────────────────────────────────────
  'com.nordea.mobilebanking': 'Nordea',
  'com.danskebank.mobilebank3.dk': 'Danske Bank',
  'com.seb.privatkund': 'SEB',
  'com.handelsbanken.mobile': 'Handelsbanken',
  'se.swedbankab.mbid': 'Swedbank',
  'se.swish.app': 'Swish',
  'dk.mobilepay.android': 'MobilePay',
  'fi.op.android.opbank': 'OP Financial',
  'no.dnb.android': 'DNB',
  'no.sparebank1.mobilbank': 'SpareBank 1',
  'com.skandia.android': 'Skandia',
  'com.lunar.app': 'Lunar',
  'com.norwegian.bank': 'Norwegian Bank',

  // ── Irish Banks ─────────────────────────────────────────────────────
  'com.aib.mobilebanking': 'AIB',
  'ie.boi.mobilebanking': 'Bank of Ireland',
  'com.permanenttsb.ptsb': 'Permanent TSB',
  'com.ulsterbank.mobile': 'Ulster Bank',

  // ── Portuguese Banks ────────────────────────────────────────────────
  'pt.cgd.caixadirecta': 'Caixa Geral de Depósitos',
  'pt.novobanco.nbapp': 'Novo Banco',
  'pt.millenniumbcp.app': 'Millennium BCP',
  'pt.bancobpi.mobile': 'Banco BPI',

  // ── Polish Banks ────────────────────────────────────────────────────
  'pl.mbank': 'mBank',
  'pl.ing.mojeing': 'ING Poland',
  'pl.pkobp.iko': 'PKO Bank Polski',
  'pl.bzwbk.bzwbk24': 'Santander Poland',
  'eu.eleader.mobilebanking.pekao': 'Bank Pekao',
  'com.blik': 'BLIK',

  // ── Czech & Slovak Banks ────────────────────────────────────────────
  'cz.csob.smartbanking': 'ČSOB',
  'cz.airbank.android': 'Air Bank',
  'cz.kb.mba': 'Komerční banka',

  // ── Pan-European Fintech ────────────────────────────────────────────
  'com.transferwise.android': 'Wise',
  'com.klarna.android': 'Klarna',
  'com.vfrtzn.app': 'Vivid Money',
  'com.qonto.qonto': 'Qonto',
  'com.pleo.android': 'Pleo',
  'com.sumup.bank': 'SumUp',
  'com.curve.android': 'Curve',
  'com.monese.monese.live': 'Monese',
  'com.twint.payment': 'TWINT',
  'com.holvi.app': 'Holvi',
  'com.tide.business': 'Tide',
  'com.anna.money': 'Anna Money',
  'com.numbrs.android.production': 'Numbrs',
  'com.worldremit.android': 'WorldRemit',
  'com.remitly.android': 'Remitly',

  // ── Buy-Now-Pay-Later / Payment Apps ──────────────────────────────
  'com.affirm.mobile': 'Affirm',
  'com.afterpay.mobile': 'Afterpay',
  'com.skrill.moneybookers': 'Skrill',
  'com.paysend.app': 'Paysend',
};

/**
 * Packages whose notifications are NEVER captured, even though they talk about
 * money — checked before anything else, and it beats every other rule.
 *
 * This exists because of a hole in `NotificationListener.java`. Forwarding is
 * Google Wallet is listed here rather than simply being left off the banking
 * list because it would otherwise be a plausible thing to add: it is a money
 * app, a user could reasonably approve it by hand, and this beats that.
 *
 * Google Wallet announces the same tap-to-pay purchase the card's own bank app
 * already announced, in different wording. One purchase, two notifications, two
 * captured rows. Commit 0c0d0d7 tried to collapse those after the fact by
 * comparing vendor names; that only works when both sides parse to a similar
 * vendor, and it fails the moment either one parses badly. Not capturing the
 * duplicate in the first place is the reliable fix.
 *
 * Trade-off, accepted deliberately: a card that ONLY ever notifies through
 * Wallet — tap-to-pay with no issuer app installed — will stop being captured.
 *
 * Must stay in sync with EXCLUDED_APPS in NotificationListener.java;
 * lib/__tests__/bankingAppsConsistency.test.ts fails the build otherwise.
 */
export const EXCLUDED_APPS: Record<string, string> = {
  'com.google.android.apps.walletnfcrel': 'Google Wallet',
  'com.google.android.apps.wallet': 'Google Wallet (legacy)',
};

/**
 * True if this package must never produce a capture.
 *
 * Checked on the JS side as well as in Java. The Java check is what actually
 * saves the work; this one is the backstop for notifications that reach the
 * pipeline another way (the offline queue, a rescan, an older native build
 * still installed on the device).
 */
export function isExcludedApp(packageName: string | null | undefined): boolean {
  if (!packageName) return false;
  return Object.prototype.hasOwnProperty.call(EXCLUDED_APPS, packageName.trim());
}

// ── User-approved capture sources ────────────────────────────────────────────
//
// Capture is restricted to banks, which leaves a gap: a bank Covault has never
// heard of stops being captured entirely. The notification settings screen
// closes that gap by letting the user approve an unrecognised app themselves
// (see suggestUnknownBankApps below). Their choices live here.
//
// Device-local, because the native listener's monitored-app list is device-local
// too — approving an app is a statement about the phone in your hand, not about
// the account. Kept separate from the DB-sourced bank list so a bad manual
// approval can never propagate to anyone else.

const APPROVED_SOURCES_KEY = 'covault_approved_capture_sources_v1';

function readApprovedSources(): string[] {
  try {
    const raw = localStorage.getItem(APPROVED_SOURCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Package names the user has approved by hand on this device. */
export function getApprovedCaptureSources(): string[] {
  return readApprovedSources();
}

/**
 * Approve or un-approve an app as a capture source.
 *
 * Excluded apps are refused outright — the exclusion list exists to stop a
 * specific, known duplicate-capture problem, and a tap in settings is not a
 * reason to reopen it.
 */
export function setCaptureSourceApproved(packageName: string, approved: boolean): void {
  const pkg = (packageName || '').trim().toLowerCase();
  if (!pkg || isExcludedApp(pkg)) return;
  const current = new Set(readApprovedSources());
  if (approved) current.add(pkg);
  else current.delete(pkg);
  try {
    localStorage.setItem(APPROVED_SOURCES_KEY, JSON.stringify(Array.from(current)));
  } catch {
    log.warn('[bankingApps] Could not persist approved capture sources');
  }
  bankingKeyCache = null;
}

/**
 * Words that make an installed app worth *offering* as a capture source.
 *
 * Only ever used to build a suggestion the user must confirm — nothing here
 * enables capture on its own. That is why it can afford to be broader than the
 * fuel-merchant list: the cost of a wrong guess is one ignorable row in
 * settings, not a wrong number in the ledger.
 */
const BANKISH_RE = /\b(?:bank|banking|banque|credit\s*union|creditunion|\bcu\b|caisse|financial|finance|savings|trust|federal|fcu|card|visa|mastercard|amex|american\s*express|discover|wallet|pay|money|cash|invest|brokerage)\b/i;

export interface UnknownBankSuggestion {
  packageName: string;
  /** The app's own label, as Android reports it. */
  name: string;
}

/**
 * Installed apps that look financial but are not on any list yet.
 *
 * This is the visible half of the bank-only rule. Restricting capture to known
 * banks means an unlisted bank fails silently, and a silent failure is the one
 * kind the user cannot act on — so the app has to volunteer what it might be
 * missing. Matching on the app's own name is deliberate: it never reads a
 * notification to decide, so nothing about an unapproved app's contents is
 * examined, let alone captured.
 */
export function suggestUnknownBankApps(
  installed: Array<{ packageName: string; name: string }>,
): UnknownBankSuggestion[] {
  const known = bankingPackageKeys();
  const seen = new Set<string>();
  const out: UnknownBankSuggestion[] = [];

  for (const app of installed || []) {
    const pkg = (app?.packageName || '').trim().toLowerCase();
    const name = (app?.name || '').trim();
    if (!pkg || !name) continue;
    if (known.has(pkg) || isExcludedApp(pkg) || seen.has(pkg)) continue;
    if (!BANKISH_RE.test(name)) continue;
    seen.add(pkg);
    out.push({ packageName: pkg, name });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * True if this package may produce a capture: a bank, a card issuer, or an app
 * the user approved by hand.
 *
 * This is the JS half of "only banks get captured". The Java listener stops
 * everything else before it is ever broadcast; this backstops the paths that do
 * not come through a live broadcast — the offline queue, a rescan, and a phone
 * still running an older APK than its web bundle.
 *
 * Checked against the DB-sourced list AND the hardcoded one, deliberately. The
 * DB list replaces the cache wholesale when it loads, so consulting it alone
 * would mean a short or partially-populated `banks` table silently switching
 * capture off for a bank the app has always known about.
 */
export function isBankingApp(packageName: string | null | undefined): boolean {
  if (!packageName) return false;
  const pkg = packageName.trim().toLowerCase();
  if (!pkg) return false;
  if (isExcludedApp(pkg)) return false;
  return bankingPackageKeys().has(pkg);
}

/**
 * Lowercased package names of every app the JS side will accept a capture from.
 *
 * Case-folded because a dozen entries in KNOWN_BANKING_APPS are camelCase
 * ('com.ally.MobileBanking', 'co.uk.Nationwide.Mobile') while the pipeline
 * lowercases every incoming package id. A case-sensitive lookup would refuse
 * those banks outright. Rebuilt when the DB cache is replaced or the user
 * approves an app.
 */
let bankingKeyCache: Set<string> | null = null;
let bankingKeyCacheSource: Record<string, string> | null = null;

function bankingPackageKeys(): Set<string> {
  if (bankingKeyCache && bankingKeyCacheSource === cachedBankingApps) return bankingKeyCache;
  const keys = new Set<string>();
  for (const pkg of Object.keys(KNOWN_BANKING_APPS)) keys.add(pkg.toLowerCase());
  for (const pkg of Object.keys(cachedBankingApps)) keys.add(pkg.toLowerCase());
  for (const pkg of readApprovedSources()) keys.add(pkg.toLowerCase());
  bankingKeyCache = keys;
  bankingKeyCacheSource = cachedBankingApps;
  return keys;
}

/**
 * Module-level cache of banking apps loaded from Supabase.
 * Populated by loadBankingAppsFromDB() on app start.
 * Falls back to KNOWN_BANKING_APPS until the DB load completes.
 */
let cachedBankingApps: Record<string, string> = { ...KNOWN_BANKING_APPS };

/**
 * Get the current banking apps map (DB-sourced after load, hardcoded fallback before).
 * Synchronous — safe to call from render paths and event handlers.
 */
export function getBankingApps(): Record<string, string> {
  return cachedBankingApps;
}

/**
 * Load banking apps from the public.banks table in Supabase.
 * Updates the module-level cache so subsequent getBankingApps() calls
 * return DB data. Falls back to the hardcoded list if the DB is unavailable.
 */
export async function loadBankingAppsFromDB(): Promise<Record<string, string>> {
  try {
    const res = await restFetch(`/banks?select=package_name,display_name`);

    if (!res.ok) {
      log.warn('[loadBankingApps] DB unavailable, using hardcoded fallback');
      return cachedBankingApps;
    }
    const rows: Array<{ package_name: string; display_name: string }> = await res.json();
    if (!rows || rows.length === 0) {
      return cachedBankingApps;
    }
    const apps: Record<string, string> = {};
    for (const row of rows) {
      apps[row.package_name] = row.display_name;
    }
    cachedBankingApps = apps;
    return apps;
  } catch {
    log.warn('[loadBankingApps] Error loading from DB, using hardcoded fallback');
    return cachedBankingApps;
  }
}