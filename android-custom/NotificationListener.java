package com.covault.app;

import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NotificationListener service that captures banking app notifications
 * and extracts transaction data (amount, vendor) for auto-filing.
 */
public class NotificationListener extends NotificationListenerService {

    private static final String TAG = "CovaultNotificationListener";

    private static volatile NotificationListener instance;

    public static NotificationListener getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (instance == this) {
            instance = null;
        }
    }

    /**
     * Called by the system when the notification listener is connected.
     * This happens when:
     *   - The user grants notification access for the first time
     *   - The device reboots and the system reconnects the listener
     *   - The app is reinstalled while permission is still granted
     *
     * We use this to immediately scan all existing notifications in the
     * shade — including ones that arrived before the app was installed or
     * before the listener was enabled.
     */
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        Log.i(TAG, "onListenerConnected: notification listener connected, scanning existing notifications");
        // Create the capture channel now rather than on the first capture.
        // Until it exists, Android's per-channel switch for it does not appear
        // in the app's notification settings, so a user sent there to turn our
        // notifications back on finds nothing to turn on — and tray suppression
        // stays off until they do. See canPostCaptureNotifications.
        ensureCaptureChannel(this);
        scanActiveNotifications();
    }

    /**
     * Re-process all active (currently visible) notifications from banking apps.
     * Called by the CovaultNotificationPlugin when the user taps the refresh button.
     * Refreshes the monitored apps list first to pick up any newly installed apps.
     */
    public void scanActiveNotifications() {
        try {
            StatusBarNotification[] activeNotifications = getActiveNotifications();
            if (activeNotifications == null) {
                Log.w(TAG, "scanActiveNotifications: no active notifications available");
                return;
            }
            Log.i(TAG, "scanActiveNotifications: scanning " + activeNotifications.length + " active notifications");
            for (StatusBarNotification sbn : activeNotifications) {
                handleNotificationPosted(sbn, true);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error scanning active notifications", e);
        }
    }

    // Packages that must NEVER be captured, whatever else they look like.
    // Checked first in handleNotificationPosted, before the "has a dollar
    // amount" fallback that would otherwise let them through.
    //
    // Google Wallet re-announces a tap-to-pay purchase that the card's own bank
    // app has already announced, worded differently. One purchase, two
    // notifications, two rows. Collapsing them afterwards by vendor similarity
    // (commit 0c0d0d7) only works when both sides happen to parse to a similar
    // vendor; not capturing the duplicate at all is what actually holds.
    //
    // Must stay in sync with EXCLUDED_APPS in lib/bankingApps.ts —
    // lib/__tests__/bankingAppsConsistency.test.ts fails the build otherwise.
    static final Set<String> EXCLUDED_APPS = new HashSet<>(Arrays.asList(
        "com.google.android.apps.walletnfcrel",  // Google Wallet
        "com.google.android.apps.wallet"         // Google Wallet (legacy)
    ));

    // Banking app package names to listen for
    // Users can configure which apps to monitor in the app
    static final Set<String> BANKING_APPS = new HashSet<>(Arrays.asList(
        // ── Canadian Banks ──────────────────────────────────────────
        "com.bmo.mobile",                  // BMO
        "com.rbc.mobile.android",          // RBC
        "com.td",                          // TD Canada
        "com.cibc.android.mobi",           // CIBC
        "com.scotiabank.mobile",           // Scotiabank
        "com.bns.mobile",                  // Scotiabank (alternate)
        "ca.bnc.android",                  // National Bank of Canada
        "com.desjardins.mobile",           // Desjardins
        "com.atb.atbmobile",              // ATB Financial
        "ca.tangerine.clients.banking",    // Tangerine
        "com.simplicite.app",              // Simplii Financial
        "ca.hsbc.hsbccanada",              // HSBC Canada
        "com.laurentianbank.mobile",       // Laurentian Bank
        "com.eq.mobile",                   // EQ Bank
        "com.manulife.mobile",             // Manulife Bank
        "com.coastcapitalsavings.dcu",     // Coast Capital
        "com.meridiancu.banking",          // Meridian Credit Union
        "com.vancity.mobile",              // Vancity
        "com.alterna.mobile",              // Alterna Savings
        "com.firstontario.mobile",         // FirstOntario
        "ca.conexus.mobile",               // Conexus Credit Union
        "ca.affinitycu.mobile",            // Affinity Credit Union
        "com.libro.mobile",                // Libro Credit Union
        "com.servus.mobile",               // Servus Credit Union
        "com.duca.mobile",                 // DUCA Credit Union
        "com.pcfinancial.mobile",          // PC Financial
        "com.canadianwestern.mobile",      // Canadian Western Bank
        "com.motusbank.mobile",            // Motus Bank
        "com.bridgewater.mobile",          // Bridgewater Bank
        "com.icicibank.imobile.canada",    // ICICI Bank Canada
        "com.envisionfinancial.mobile",    // Envision Financial
        "com.blueshore.mobile",            // BlueShore Financial
        "com.steinbach.mobile",            // Steinbach Credit Union
        "com.innovationcu.mobile",         // Innovation Credit Union
        "com.prospera.mobile",             // Prospera Credit Union
        "com.interiorsa.mobile",           // Interior Savings
        "com.islandsavings.mobile",        // Island Savings
        "com.sunlife.mobile",              // Sun Life Financial

        // ── Canadian Fintech ────────────────────────────────────────
        "com.wealthsimple",               // Wealthsimple
        "com.wealthsimple.trade",          // Wealthsimple Trade
        "com.neofinancial.android",        // Neo Financial
        "com.koho.android",               // KOHO
        "com.mogo.mobile",                // Mogo
        "ca.payments.interac",             // Interac e-Transfer
        "com.stack.app",                   // Stack
        "com.paytm.canada",               // Paytm Canada

        // ── US Banks ────────────────────────────────────────────────
        "com.chase.sig.android",           // Chase
        "com.wf.wellsfargomobile",          // Wells Fargo
        "com.infonow.bofa",                 // Bank of America
        "com.citi.citimobile",              // Citi
        "com.usbank.mobilebanking",         // US Bank
        "com.pnc.ecommerce.mobile",         // PNC
        "com.tdbank",                       // TD Bank
        "com.capitalone.mobile",            // Capital One
        "com.key.android",                  // KeyBank
        "com.regions.mobbanking",           // Regions
        "com.huntington.m",                 // Huntington
        "com.ally.MobileBanking",           // Ally Bank
        "com.fifththird.mobile",            // Fifth Third
        "com.mtb.mbanking.sc.retail.prod",  // M&T Bank
        "com.citizensbank.androidapp",      // Citizens Bank
        "com.truist.mobile",                // Truist
        "com.bmoharris.digital",            // BMO Harris
        "com.firstcitizens.mobile",         // First Citizens
        "com.websterbank.mobilebanking",    // Webster Bank
        "com.comerica.mobile",              // Comerica
        "com.zionsbancorp.mobile",          // Zions Bank
        "com.synovus.mobile",               // Synovus
        "com.svb.mobilebanking",            // Silicon Valley Bank
        "com.newYorkCommunityBank.mobile",  // New York Community Bank
        "com.popular.android",              // Popular Bank
        "com.eastwestbank.mobile",          // East West Bank
        "com.valleynationalbank.mobile",    // Valley National Bank
        "com.culbersonbanking.mobile",      // Culberson Bank
        "com.bokfinancial.mobile",          // BOK Financial
        "com.frostbank.mobile",             // Frost Bank
        "com.glacier.mobile",               // Glacier Bank
        "com.oldnational.mobile",           // Old National Bank
        "com.pacwest.mobile",               // PacWest Bank
        "com.wintrust.mobile",              // Wintrust
        "com.associatedbank.mobile",        // Associated Bank
        "com.atlanticcapitalbank.mobile",   // Atlantic Capital
        "com.umpquabank.mobile",            // Umpqua Bank
        "com.columbiabankingmobile",        // Columbia Banking
        "com.renasantbank.mobile",          // Renasant Bank
        "com.bankunited.mobile",            // BankUnited
        "com.independentbank.mobile",       // Independent Bank
        "com.firsthorizon.mobile",          // First Horizon
        "com.suntrust.mobilebanking",       // SunTrust
        "com.bbandt.mobilebanking",         // BB&T

        // ── US Credit Cards ─────────────────────────────────────────
        "com.americanexpress.android.acctsvcs.us", // Amex
        "com.capitalone.creditcard.app",   // Capital One (credit card)
        "com.discoverfinancial.mobile",    // Discover
        "com.synchrony.banking",           // Synchrony
        "com.barclays.bca",                // Barclaycard US
        "com.comenity.mobile",             // Comenity
        "com.bread.mobile",                // Bread Financial

        // ── US Fintech / Neobanks ───────────────────────────────────
        "com.chime.chmapplication",        // Chime
        "com.sofi.mobile",                 // SoFi
        "com.venmo",                       // Venmo
        "com.squareup.cash",               // Cash App
        "com.paypal.android.p2pmobile",    // PayPal
        "com.zellepay.zelle",              // Zelle
        "com.revolut.revolut",             // Revolut
        "com.simple",                      // Simple
        "com.monzo.android",               // Monzo
        "com.n26.android",                 // N26
        "com.varo",                        // Varo
        "com.current.mobile",              // Current
        "com.dave.android",                // Dave
        "com.albert.app",                  // Albert
        "com.aspiration.app",              // Aspiration
        "com.greendot.mobile",             // Green Dot
        "com.netspend.mobile",             // NetSpend
        "com.brex.mobile",                 // Brex
        "com.mercury.app",                 // Mercury
        "com.ramp.app",                    // Ramp
        "com.one.mobile.android",          // ONE
        "com.go2bank.mobile",              // GO2bank
        "com.empower.mobile",              // Empower
        "com.step.app",                    // Step
        "com.upgrade.mobile",              // Upgrade
        "com.lendingclub.mobile",          // LendingClub
        "com.moneyLion.android",           // MoneyLion
        "com.marcus.android",              // Marcus by Goldman Sachs

        // ── US Credit Unions ────────────────────────────────────────
        "com.navyfederal.android",         // Navy Federal
        "com.penfed.mobile.banking",       // PenFed
        "org.becu.mobile",                 // BECU
        "com.usaa.mobile.android.usaa",    // USAA
        "com.schoolsfirstfcu.mobile",      // SchoolsFirst FCU
        "org.stcu.mobilebanking",          // STCU
        "com.golden1.mobile",              // Golden 1 Credit Union
        "com.alliantcu.mobile",            // Alliant Credit Union
        "org.sefcu.mobile",                // SEFCU
        "com.suncoastcreditunion.mobile",  // Suncoast Credit Union
        "com.vyStar.mobilebanking",        // VyStar Credit Union
        "com.psecu.mobile",                // PSECU
        "com.dcuonline.mobile",            // DCU
        "com.firsttechfed.mobile",         // First Tech FCU
        "com.bethpagefcu.mobile",          // Bethpage FCU
        "com.statefarm.bank",              // State Farm Bank
        "com.rbfcu.mobile",                // Randolph-Brooks FCU
        "com.delta.community.mobile",      // Delta Community CU
        "com.americafirst.mobile",         // America First CU

        // ── US Banks with Brokerage + Spending ───────────────────────
        "com.fidelity.android",            // Fidelity
        "com.schwab.mobile",              // Charles Schwab

        // ── UK Banks ────────────────────────────────────────────────
        "com.barclays.android.barclaysmobilebanking", // Barclays
        "com.hsbc.hsbcuk",                 // HSBC UK
        "com.grfrtsq.lloydsretail",        // Lloyds Bank
        "com.natwest.mobilebanking",       // NatWest
        "com.starlingbank.android",        // Starling Bank
        "com.halifax.mobile",              // Halifax
        "co.uk.Nationwide.Mobile",         // Nationwide
        "uk.co.metrobankonline.mobile.android.production", // Metro Bank
        "com.virginmoney.uk.mobile.android", // Virgin Money UK
        "com.tsb.mobilebank",             // TSB
        "com.santander.app",               // Santander UK
        "com.rbs.mobile.android.rbs",      // Royal Bank of Scotland
        "com.bankofscotland.mobile",       // Bank of Scotland
        "com.atom.bank",                   // Atom Bank
        "com.chase.intl",                  // Chase UK
        "com.thinkmoney.app",              // Think Money
        "com.kroo.app",                    // Kroo Bank
        "com.zopa.android",                // Zopa Bank
        "com.tescobank.mobile",            // Tesco Bank

        // ── German Banks ────────────────────────────────────────────
        "com.db.pwcc.dbmobile",            // Deutsche Bank
        "de.commerzbanking.mobil",         // Commerzbank
        "de.dkb.portalapp",                // DKB
        "de.ingdiba.bankingapp",           // ING Germany
        "com.starfinanz.smob.android.sfinanzstatus", // Sparkasse
        "de.fiducia.smartphone.android.banking.vr",  // Volksbank/Raiffeisenbank
        "de.postbank.finanzassistent",     // Postbank
        "com.hypovereinsbank.universchin", // HypoVereinsbank
        "de.consorsbank",                  // Consorsbank
        "de.comdirect.app",                // comdirect
        "de.number26.android",             // N26 Germany
        "com.tomorrow.app",                // Tomorrow Bank

        // ── French Banks ────────────────────────────────────────────
        "com.cih.android.bnpparibas",      // BNP Paribas
        "mobi.societegenerale.mobile.lappli", // Société Générale
        "com.caisseepargne.android.mobilebanking", // Caisse d'Épargne
        "fr.creditagricole.androidapp",    // Crédit Agricole
        "com.boursorama.android.clients",  // Boursorama
        "fr.banquepopulaire.cyberplus",    // Banque Populaire
        "fr.lcl.android.customerarea",     // LCL
        "com.fortuneo.android",            // Fortuneo
        "net.bnpparibas.mescomptes",       // Hello Bank France
        "com.cic_prod.bad",                // CIC
        "fr.creditMutuel.CMBanque",        // Crédit Mutuel
        "com.labanquepostale.ecoapp",      // La Banque Postale
        "com.orange.banking.music",        // Orange Bank
        "com.lydia",                       // Lydia

        // ── Spanish Banks ───────────────────────────────────────────
        "com.bbva.bbvacontigo",            // BBVA Spain
        "es.bancosantander.apps",          // Santander Spain
        "es.lacaixa.mobile.android.newwapicon", // CaixaBank
        "net.inverline.bancosabadell.officelocator.android", // Banco Sabadell
        "com.bankinter.launcher",          // Bankinter
        "es.ibercaja.ibercajaapp",         // Ibercaja
        "com.kutxabank.android",           // Kutxabank
        "com.abanca.bancaempresas",        // Abanca
        "com.unicajabanco.app",            // Unicaja Banco

        // ── Italian Banks ───────────────────────────────────────────
        "com.unicredit",                   // UniCredit
        "com.latuabancaperandroid",        // Intesa Sanpaolo
        "it.copergmps.rt.pf.android.sp.bmps", // Banca MPS
        "com.bfriancoapp",                // Banco BPM
        "it.bnl.apps.banking",             // BNL
        "it.popso.SCRIGNOapp",             // Banca Popolare di Sondrio
        "com.fineco.it",                   // Fineco Bank
        "it.hype.app",                     // HYPE
        "com.illimity.mobile",             // Illimity Bank

        // ── Dutch Banks ─────────────────────────────────────────────
        "com.ing.mobile",                  // ING
        "com.abnamro.nl.mobile.payments",  // ABN AMRO
        "nl.rabomobiel",                   // Rabobank
        "com.bunq.android",                // Bunq
        "nl.asnbank.asnbankieren",         // ASN Bank
        "com.snsbank.mobile",              // SNS Bank
        "com.triodos.banking.mobile",      // Triodos Bank
        "nl.knab.app",                     // Knab

        // ── Belgian Banks ───────────────────────────────────────────
        "com.kbc.mobile.android.phone",    // KBC
        "be.belfius.directmobile.android", // Belfius
        "com.bnpparibasfortis.geomobile",  // BNP Paribas Fortis
        "be.argenta.bankieren",            // Argenta
        "com.ing.banking",                 // ING Belgium

        // ── Swiss Banks ─────────────────────────────────────────────
        "com.ubs.swidKXJ.android",         // UBS
        "ch.postfinance.android",          // PostFinance
        "com.zuercherkb.android",          // Zürcher Kantonalbank
        "com.csg.cs.dnmb",                // Credit Suisse
        "ch.raiffeisen.android",           // Raiffeisen Switzerland
        "com.neon.app",                    // Neon (Swiss)
        "com.yapeal.app",                  // Yapeal

        // ── Austrian Banks ──────────────────────────────────────────
        "at.erstebank.george",             // Erste Bank
        "com.bankaustria.android.olb",     // Bank Austria
        "at.spardat.bcrmobile",            // Raiffeisen Austria
        "com.bawagpsk.mbanking",           // BAWAG

        // ── Scandinavian Banks ──────────────────────────────────────
        "com.nordea.mobilebanking",        // Nordea
        "com.danskebank.mobilebank3.dk",   // Danske Bank
        "com.seb.privatkund",              // SEB
        "com.handelsbanken.mobile",        // Handelsbanken
        "se.swedbankab.mbid",              // Swedbank
        "se.swish.app",                    // Swish
        "dk.mobilepay.android",            // MobilePay
        "fi.op.android.opbank",            // OP Financial
        "no.dnb.android",                  // DNB
        "no.sparebank1.mobilbank",         // SpareBank 1
        "com.skandia.android",             // Skandia
        "com.lunar.app",                   // Lunar
        "com.norwegian.bank",             // Norwegian Bank

        // ── Irish Banks ─────────────────────────────────────────────
        "com.aib.mobilebanking",           // AIB
        "ie.boi.mobilebanking",            // Bank of Ireland
        "com.permanenttsb.ptsb",           // Permanent TSB
        "com.ulsterbank.mobile",           // Ulster Bank

        // ── Portuguese Banks ────────────────────────────────────────
        "pt.cgd.caixadirecta",             // Caixa Geral de Depósitos
        "pt.novobanco.nbapp",              // Novo Banco
        "pt.millenniumbcp.app",            // Millennium BCP
        "pt.bancobpi.mobile",              // Banco BPI

        // ── Polish Banks ────────────────────────────────────────────
        "pl.mbank",                        // mBank
        "pl.ing.mojeing",                  // ING Poland
        "pl.pkobp.iko",                    // PKO Bank Polski
        "pl.bzwbk.bzwbk24",               // Santander Poland
        "eu.eleader.mobilebanking.pekao",  // Bank Pekao
        "com.blik",                        // BLIK

        // ── Czech & Slovak Banks ────────────────────────────────────
        "cz.csob.smartbanking",            // ČSOB
        "cz.airbank.android",              // Air Bank
        "cz.kb.mba",                       // Komerční banka

        // ── Pan-European Fintech ────────────────────────────────────
        "com.transferwise.android",        // Wise
        "com.klarna.android",              // Klarna
        "com.vfrtzn.app",                  // Vivid Money
        "com.qonto.qonto",                // Qonto
        "com.pleo.android",               // Pleo
        "com.sumup.bank",                  // SumUp
        "com.curve.android",               // Curve
        "com.monese.monese.live",          // Monese
        "com.twint.payment",               // TWINT
        "com.holvi.app",                   // Holvi
        "com.tide.business",               // Tide
        "com.anna.money",                  // Anna Money
        "com.numbrs.android.production",   // Numbrs
        "com.worldremit.android",          // WorldRemit
        "com.remitly.android",             // Remitly

        // ── Buy-Now-Pay-Later / Payment Apps ────────────────────────
        "com.affirm.mobile",              // Affirm
        "com.afterpay.mobile",             // Afterpay
        "com.skrill.moneybookers",         // Skrill
        "com.paysend.app"                  // Paysend
    ));

    // Patterns to extract transaction amount
    private static final Pattern[] AMOUNT_PATTERNS = {
        Pattern.compile("\\$([\\d,]+(?:\\.\\d{1,2})?)"),                    // $123, $123.4, $123.45
        Pattern.compile("(?:USD|CAD)\\s*([\\d,]+(?:\\.\\d{1,2})?)"),        // USD 123 or CAD 123.45
        Pattern.compile("([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:USD|CAD|dollars?)"), // 123.45 USD/CAD
        Pattern.compile("(?:charged|spent|paid|purchase|transaction|withdrawal|debit)\\s*(?:of)?\\s*\\$?([\\d,]+(?:\\.\\d{1,2})?)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:amount|total)\\s*:?\\s*\\$?([\\d,]+(?:\\.\\d{1,2})?)", Pattern.CASE_INSENSITIVE)
    };

    // Patterns to extract vendor/merchant name
    // Emoji and pictographs, stripped before vendor matching.
    //
    // Banks increasingly put a category glyph in the title: "OPA001-MARKET MALL
    // 🍴 You spent $16.54 with your credit card." None of the vendor patterns
    // below include emoji in their character classes, so without this the
    // regex cannot cross the glyph to reach the spending verb — every
    // merchant-leading pattern fails, and matching resumes AFTER the emoji,
    // where the only thing left is "You spent $16.54". That is precisely how a
    // real purchase was captured as "$16.54 at You".
    //
    // Mirrors stripEmoji() in lib/deviceTransactionParser.ts.
    private static final Pattern EMOJI_PATTERN = Pattern.compile(
        "[\\x{1F000}-\\x{1FFFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}\\x{FE00}-\\x{FE0F}\\x{200D}]"
    );

    /**
     * Words that can never be a vendor on their own.
     *
     * The patterns below are greedy about finding *something*, and when they
     * land in the description rather than the merchant name what they return is
     * a pronoun or an article. lib/deviceTransactionParser.ts has rejected
     * these for a while (NON_VENDOR_WORDS); this side never did, and this side
     * is the one that posts the capture notification when the app is closed.
     */
    private static final Set<String> NON_VENDOR_WORDS = new HashSet<>(Arrays.asList(
        "you", "your", "yours", "my", "mine", "our", "ours", "i", "me", "we", "us",
        "they", "them", "their", "a", "an", "the", "with", "from", "on", "at", "to",
        "for", "and", "of", "spent", "spend", "paid", "pay", "charged", "charge",
        "purchased", "purchase", "transaction", "payment", "card", "credit", "debit",
        "none", "unknown"
    ));

    private static final Pattern[] VENDOR_PATTERNS = {
        // "VENDOR - You spent $X" / "VENDOR You spent $X" (e.g. Wealthsimple)
        // Must come first so the clean vendor name is captured before the spending phrase.
        //
        // The dash is OPTIONAL. It was mandatory here long after
        // lib/deviceTransactionParser.ts made it optional (its Pattern 5), so
        // any bank that omits the separator fell through this pattern entirely
        // and got its vendor from the far dumber amount-adjacent pattern below.
        Pattern.compile("^([A-Za-z0-9&'./# -]{2,60}?)\\s*[-\\u2013\\u2014]?\\s*(?:[Yy]ou\\s+)?(?:spent|charged|paid|purchased)\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:at|from|to|@)\\s+([A-Za-z0-9\\s&'.-]+?)\\s+(?:for|on|\\$|USD|CAD|charged)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:purchase|transaction|payment)\\s+(?:at|from)\\s+([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE),
        // Vendor before dollar amount — stop before spending verbs so we don't
        // capture "AMZN MKTP CA You spent" instead of just "AMZN MKTP CA".
        Pattern.compile("([A-Z][A-Za-z0-9\\s&'.-]+?)\\s+(?:(?:you\\s+)?(?:spent|charged|paid|purchased)\\s+)?\\$[\\d,]+\\.\\d{2}", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:merchant|vendor|store)\\s*:?\\s*([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE)
    };


    /**
     * Wording that is never a purchase, mirrored from the web parser.
     *
     * The capture notification is posted from here on the strength of a dollar
     * amount and nothing else, because with the app closed this service is the
     * only part of Covault running. Everything that decides whether an alert is
     * actually an expense lives in the web pipeline, which may not run for
     * hours — so a crypto price alert from a monitored app ("BTC is trading at
     * $104,455.73") announced itself as a captured purchase, sat in the shade
     * all afternoon, and was then rejected the moment the app was next opened.
     *
     * These are the exact patterns lib/deviceTransactionParser.ts already
     * rejects outright, before it parses anything (NON_FINANCIAL_PATTERNS).
     * Copying them here does not add a new opinion about what counts as a
     * purchase — it applies the app's existing one earlier, so the shade and
     * the review list agree from the start rather than hours later. Because
     * the two lists are identical, anything silenced here is something the
     * pipeline was always going to throw away: no purchase can be lost to it,
     * only an announcement of something that was never going to appear.
     *
     * A match makes the capture QUIET, never dropped. The alert is still
     * queued, still broadcast, still classified, and still shows up in the
     * processed list — see the ignoredByUser path, which this joins.
     *
     * Kept in step by quietNonPurchaseAlerts.test.ts, which parses both lists
     * and fails the build if they drift.
     */
    // NON_PURCHASE_PATTERNS_BEGIN
    private static final Pattern[] NON_PURCHASE_PATTERNS = {
        // Crypto price alerts: "ETH is down 5.06%", "BTC trading at $45k"
        Pattern.compile("\\b(?:ETH|BTC|SOL|ADA|DOT|DOGE|XRP|MATIC|AVAX|LINK|LTC|USDT|USDC|BNB|SHIB)\\b.*?\\b(?:up|down|trading|price|market|rally|crash|surge|drop|gain|loss|fell|rose|climb)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\b(?:is\\s+)?trading\\s+at\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bmarket\\s+cap\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bprice\\s+alert\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\b(?:up|down)\\s+\\d+(?:\\.\\d+)?%", Pattern.CASE_INSENSITIVE),
        // Promotional / marketing language
        Pattern.compile("\\b(?:limited\\s+time|act\\s+now|don't\\s+miss|exclusive\\s+offer|flash\\s+sale)\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\b(?:promo\\s+code|coupon\\s+code|discount\\s+code|referral\\s+code)\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\b(?:earn\\s+(?:up\\s+to|bonus)|free\\s+(?:shipping|trial|gift))\\b", Pattern.CASE_INSENSITIVE),
        // App feature announcements
        Pattern.compile("\\b(?:new\\s+feature|update\\s+available|what'?s\\s+new)\\b", Pattern.CASE_INSENSITIVE),
    };
    // NON_PURCHASE_PATTERNS_END

    /**
     * True when the alert is one the web parser rejects on sight.
     *
     * Only ever consulted to decide whether to ANNOUNCE a capture. Nothing
     * about queueing, broadcasting or classifying reads this.
     */
    static boolean looksNonFinancial(String text) {
        if (text == null || text.isEmpty()) return false;
        for (Pattern pattern : NON_PURCHASE_PATTERNS) {
            if (pattern.matcher(text).find()) return true;
        }
        return false;
    }

    // Keywords that indicate a transaction notification (not just a promo)
    private static final String[] TRANSACTION_KEYWORDS = {
        "purchase", "transaction", "charged", "spent", "paid", "payment",
        "withdrew", "withdrawal", "deposit", "transfer", "sent", "received",
        "debit", "credit", "authorized", "pending", "completed",
        "cost", "charge", "recurring"
    };

    /**
     * Load user-configured monitored apps from SharedPreferences.
     */
    private Set<String> getUserMonitoredApps() {
        try {
            String stored = getSharedPreferences("covault_prefs", 0)
                .getString("monitored_apps", "[]");
            Set<String> apps = new HashSet<>();
            org.json.JSONArray arr = new org.json.JSONArray(stored);
            for (int i = 0; i < arr.length(); i++) {
                String pkg = arr.optString(i, "").trim();
                if (!pkg.isEmpty()) {
                    apps.add(pkg);
                }
            }
            return apps;
        } catch (Exception e) {
            Log.w(TAG, "Error loading monitored apps", e);
            return new HashSet<>();
        }
    }

    /**
     * Check if a package is a monitored app (hardcoded banking apps OR user-configured).
     */
    private boolean isMonitoredApp(String packageName) {
        if (BANKING_APPS.contains(packageName)) return true;
        return getUserMonitoredApps().contains(packageName);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        handleNotificationPosted(sbn, false);
    }

    private void handleNotificationPosted(StatusBarNotification sbn, boolean fromScan) {
        String packageName = sbn.getPackageName();

        // Ignore our own notifications (e.g. guide notification)
        if (packageName.equals(getPackageName())) {
            return;
        }

        // Hard exclusions beat everything below, including any user-monitored
        // or user-approved list. Returning here also
        // means maybeHideBankNotification is never reached for these, so an
        // excluded app's own notification is left alone in the tray.
        if (EXCLUDED_APPS.contains(packageName)) {
            return;
        }

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        Bundle extras = notification.extras;
        if (extras == null) return;

        // Extract notification text
        String title = extras.getString(Notification.EXTRA_TITLE, "");
        String text = extras.getString(Notification.EXTRA_TEXT, "");
        String bigText = extras.getString(Notification.EXTRA_BIG_TEXT, "");

        // Prefer bigText (expanded view) when available, otherwise use the
        // short text.  Concatenating both would duplicate content because
        // bigText typically contains the same message as text.
        String body = (bigText != null && !bigText.isEmpty()) ? bigText : text;
        String fullText = title + " " + body;

        // Forward any notification that looks financial: either from a known/
        // monitored banking app, OR contains a dollar amount.  The local
        // TypeScript pipeline handles classification and rejection.
        // Only banks get captured.
        //
        // This used to also forward ANY notification containing a dollar
        // amount, on the theory that it would catch a bank nobody had listed
        // yet. What it actually caught was every other app that mentions
        // money: a Teams message quoting a price arrived as a transaction and
        // landed in the user's ledger. Chat, email, calendar, shopping and
        // delivery apps all talk about dollars, and no amount of downstream
        // classification can tell "you were charged $42" from "it'll be $42"
        // reliably enough to be worth it.
        //
        // The cost is that an unlisted bank stops being captured until it is
        // added to BANKING_APPS (and the matching list in lib/bankingApps.ts)
        // or the user picks it in notification settings, which now offers
        // unrecognised financial-looking apps for exactly this reason. That is
        // the recoverable failure — a missing capture the user is told about —
        // where the old behaviour's failure was a wrong row appearing unasked.
        boolean fromMonitored = isMonitoredApp(packageName);

        if (!fromMonitored) {
            return;
        }

        // Extract transaction data (best-effort; the local extraction
        // pipeline will handle extraction when native regex doesn't match)
        Double amount = extractAmount(fullText);
        String vendor = extractVendor(fullText);

        Log.i(TAG, "Financial notification from " + packageName + ": " + (amount != null ? "$" + amount : "[amount pending]") + " at " + (vendor != null ? vendor : "Unknown"));

        // Have we already captured THIS notification and put a Covault
        // notification in its place? See rememberSecured for why that has to
        // outlive the process.
        String securedKey = securedKeyFor(sbn);
        boolean alreadySecured = wasSecured(securedKey);

        // Something the user has already marked as "not a transaction". Still
        // captured and still handed to the pipeline — see SKIP_RULES_KEY — but
        // announced to nobody.
        boolean ignoredByUser = matchesSkipRule(this, fullText);
        if (ignoredByUser) {
            Log.i(TAG, "Matches a user skip rule; capturing quietly: " + packageName);
        }

        // A charge Covault already has on the books as a recurring one. Same
        // treatment as a skip rule — captured, handed to the pipeline, and
        // announced to nobody, because the user already knows this money is
        // going out. Tracked separately from the skip rule so the diagnostics
        // can say which of the two it was. See RECURRING_CHARGES_KEY.
        boolean knownRecurring = !ignoredByUser && matchesRecurringCharge(this, amount, fullText);
        if (knownRecurring) {
            Log.i(TAG, "Already a known recurring charge; capturing quietly: " + packageName);
        }

        // Wording the web parser rejects on sight — a crypto price alert, a
        // promo, a feature announcement. A dollar amount alone is all this
        // service has to go on, which is how "BTC is trading at $104,455.73"
        // came to announce itself as a captured purchase and then sit in the
        // shade until the app was next opened and threw it away. Same handling
        // as the two above: captured, queued, broadcast, classified — and
        // announced to nobody. See NON_PURCHASE_PATTERNS.
        boolean notAPurchase = !ignoredByUser && !knownRecurring && looksNonFinancial(fullText);
        if (notAPurchase) {
            Log.i(TAG, "Reads as a price alert or promo rather than a purchase; capturing quietly: " + packageName);
        }

        // Broadcast to the local TypeScript pipeline which will classify
        // as transaction or non-transaction — non-transactions will appear in
        // the rejected card so the user can see what was processed.
        CaptureResult result = broadcastTransaction(
            packageName, amount, vendor, fullText, sbn.getPostTime(), fromScan, alreadySecured,
            ignoredByUser || knownRecurring || notAPurchase);
        boolean secured = result.secured();

        // Recorded BEFORE the dismissal below, never after. The record is what
        // lets a later pass dismiss this notification without re-notifying; if
        // the dismissal happened first and the write then failed, the bank's
        // alert would be gone with nothing saying it had ever been replaced.
        if (secured) rememberSecured(securedKey);

        maybeHideBankNotification(
            sbn, securedKey, fromMonitored, amount, secured || alreadySecured, result,
            ignoredByUser, knownRecurring, notAPurchase);

        // Home-screen widget: nudge the donut for a purchase captured while the
        // app is closed, so it doesn't sit stale until the next app launch.
        //
        // Deliberately LAST and fully guarded. Everything above — the durable
        // queue write, the capture notification, the tray dismissal — is the
        // load-bearing path, and none of it may be affected by widget code. A
        // widget that misses a redraw is cosmetic; a capture pipeline that
        // misses a purchase is not.
        if (!fromScan && fromMonitored && amount != null) {
            try {
                if (WidgetDeltaStore.recordDelta(this, amount, vendor, sbn.getPostTime())) {
                    CovaultWidgetProvider.updateAll(this);
                }
            } catch (Throwable t) {
                Log.w(TAG, "widget delta failed (capture is unaffected)", t);
            }
        }
    }

    // ── Tray suppression ────────────────────────────────────────────────
    //
    // Optional (off by default): once Covault has captured a bank alert,
    // dismiss the bank's own notification so the shade shows one Covault
    // entry instead of two notifications for the same purchase.
    //
    // The hard requirement is that this must NEVER cost the user a spend
    // notification, so dismissal is gated on every one of the following
    // being true. Any single failure leaves the bank's notification alone,
    // which is always the recoverable outcome — a notification still in the
    // shade can be re-read by scanActiveNotifications() at any time.
    //
    //   1. The user turned the feature on.
    //   2. Covault has replaced this notification: it is durably queued AND a
    //      Covault notification for it is showing — or that was true on an
    //      earlier pass over this same notification (see rememberSecured).
    //
    //      This used to read "a live post, not a rescan", on the reasoning
    //      that a rescan only re-walks notifications already captured. That
    //      holds right up until the listener misses the live post — the
    //      service was restarted, the phone rebooted, the app was updating —
    //      and the scan is the FIRST time the notification is seen. There is
    //      no second live post, so those alerts were captured and then left in
    //      the tray forever, which is exactly the state the user sees: the
    //      purchase is in Review and the bank's alert is still sitting there.
    //   3. The notification came from a monitored banking app. This is now
    //      also the forwarding rule, so it is redundant in practice — kept
    //      because dismissing someone's notifications is the one thing here
    //      that cannot be undone, and it must not become possible again
    //      through a change made two hundred lines away.
    //   4. The native regex found an amount, i.e. this really does look like
    //      a purchase rather than a balance alert or a login warning.
    //   5. The notification is clearable (not an ongoing/foreground one).
    //      Gate 2 is the whole of what used to be gates 6 and 7: durably
    //      written to the pending queue (queueTransaction uses commit(), not
    //      apply(), so a true return means the bytes are on disk and the JS
    //      pipeline will find them on next launch even if the process is
    //      killed a millisecond later), AND a Covault notification showing. If
    //      our own notifications are blocked at the OS level, or posting
    //      threw, we would be removing the user's only visible record — so we
    //      don't, on this pass or any later one.
    //
    // Ordering is the safety property: persist, then notify, then dismiss.
    // The bank's notification is only ever removed after Covault holds a
    // durable copy of it and has put something in its place.
    //
    // Every path out of here writes down what it decided (see recordOutcome).
    // Which gate stopped a dismissal is invisible from the outside — the tray
    // looks identical whichever one it was — and the only reader of the log
    // that explains it is logcat, which needs a computer and a cable. The
    // settings screen shows these instead, so "it still isn't hiding them"
    // can be answered by looking rather than by guessing across releases.
    private void maybeHideBankNotification(
        StatusBarNotification sbn,
        String securedKey,
        boolean fromMonitored,
        Double amount,
        boolean replaced,
        CaptureResult result,
        boolean ignoredByUser,
        boolean knownRecurring,
        boolean notAPurchase
    ) {
        if (!fromMonitored) return;           // (3)
        String app = sbn.getPackageName();
        if (amount == null) {                 // (4)
            recordOutcome(securedKey, app, null, OUTCOME_NO_AMOUNT);
            return;
        }
        // Gate 2 by another name — nothing was posted in this alert's place, so
        // there is nothing to dismiss it in favour of. Reported separately
        // because it is the user's own instruction rather than a fault.
        if (ignoredByUser) {
            recordOutcome(securedKey, app, amount, OUTCOME_USER_IGNORED);
            return;
        }
        // Same shape of reason, different cause: nothing was posted because
        // Covault already had this charge on the books, so there is again
        // nothing to dismiss the bank's alert in favour of. Told apart from the
        // line above so the settings screen can explain which it was.
        if (knownRecurring) {
            recordOutcome(securedKey, app, amount, OUTCOME_KNOWN_RECURRING);
            return;
        }
        // And again: this one read as a price alert or a promo rather than a
        // purchase, so nothing was posted in its place. The bank's own alert
        // stays, which is right — Covault has no replacement to offer for
        // something it does not believe is a purchase.
        if (notAPurchase) {
            recordOutcome(securedKey, app, amount, OUTCOME_NOT_A_PURCHASE);
            return;
        }
        if (!replaced) {                      // (2)
            // The two halves fail for completely different reasons and need
            // completely different fixes, so they are never reported as one.
            recordOutcome(securedKey, app, amount,
                result.queued ? OUTCOME_BLOCKED : OUTCOME_NOT_SAVED);
            return;
        }
        if (!isHideBankNotificationsEnabled()) {  // (1)
            recordOutcome(securedKey, app, amount, OUTCOME_TOGGLE_OFF);
            return;
        }
        try {
            if (!sbn.isClearable()) {         // (5)
                recordOutcome(securedKey, app, amount, OUTCOME_NOT_CLEARABLE);
                return;
            }
            String key = sbn.getKey();
            if (key == null) {
                recordOutcome(securedKey, app, amount, OUTCOME_NOT_CLEARABLE);
                return;
            }
            cancelNotification(key);
            Log.i(TAG, "Asked to dismiss bank notification after capture: " + app);
            verifyDismissal(key, securedKey, app, amount);
        } catch (Exception e) {
            // A failure here is harmless: the bank's notification simply stays.
            Log.w(TAG, "Could not dismiss bank notification", e);
            recordOutcome(securedKey, app, amount, OUTCOME_CANCEL_IGNORED);
        }
    }

    /**
     * Check the alert actually left the shade, and ask once more if it didn't.
     *
     * `cancelNotification` is a request, not a guarantee, and it is being made
     * from inside the callback that is telling us the notification has just
     * been posted — the system can still be finishing that post, in which case
     * the cancel lands on a notification that isn't there yet and is dropped.
     * Nothing reports this: the call returns void, capture looks perfect, and
     * the bank's alert simply stays.
     *
     * So the shade is re-read a moment later. Gone means done. Still there
     * means ask again, once — and if it survives that too, record it, because
     * at that point the phone is refusing rather than racing and no amount of
     * retrying will change it.
     */
    private void verifyDismissal(String key, String securedKey, String app, Double amount) {
        dismissHandler.postDelayed(() -> {
            if (!isStillPosted(key)) {
                recordOutcome(securedKey, app, amount, OUTCOME_HIDDEN);
                return;
            }
            Log.i(TAG, "Bank notification survived the first dismissal, retrying: " + app);
            try {
                cancelNotification(key);
            } catch (Exception e) {
                Log.w(TAG, "Retry of the dismissal threw", e);
                recordOutcome(securedKey, app, amount, OUTCOME_CANCEL_IGNORED);
                return;
            }
            dismissHandler.postDelayed(() -> {
                boolean gone = !isStillPosted(key);
                if (!gone) {
                    Log.w(TAG, "Bank notification still in the tray after two dismissals: " + app);
                }
                recordOutcome(securedKey, app, amount, gone ? OUTCOME_HIDDEN : OUTCOME_CANCEL_IGNORED);
            }, DISMISS_VERIFY_DELAY_MS);
        }, DISMISS_VERIFY_DELAY_MS);
    }

    /** Is this notification still in the shade? */
    private boolean isStillPosted(String key) {
        try {
            StatusBarNotification[] active = getActiveNotifications(new String[] { key });
            return active != null && active.length > 0;
        } catch (Exception e) {
            // Unable to tell. Read as "gone" so a notification that was in fact
            // dismissed is never cancelled a second time on a guess.
            Log.w(TAG, "Could not re-read the shade", e);
            return false;
        }
    }

    private boolean isHideBankNotificationsEnabled() {
        return isHideBankNotificationsEnabled(this);
    }

    /**
     * Whether a bank's own notification should be cleared once Covault has the
     * purchase.
     *
     * On by default. Capturing the purchase is the point of the app, and
     * leaving the bank's notification sitting in the tray afterwards just means
     * reading the same thing twice. `contains` is what makes that safe to
     * assume: it separates "has never decided" from "decided no", so turning
     * the toggle off still sticks.
     *
     * The catch is deliberately NOT the same answer. An unreadable preference
     * is not consent — deleting someone's bank notifications on the strength of
     * a failed read is the one outcome here worth being timid about.
     *
     * Static and shared so the settings toggle reads exactly what the listener
     * acts on. Two copies of this default drifting apart would show the switch
     * off while notifications quietly disappeared.
     */
    static boolean isHideBankNotificationsEnabled(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences("covault_prefs", 0);
            if (!prefs.contains(HIDE_BANK_NOTIFICATIONS_KEY)) return true;
            return prefs.getBoolean(HIDE_BANK_NOTIFICATIONS_KEY, true);
        } catch (Exception e) {
            return false;
        }
    }

    static final String HIDE_BANK_NOTIFICATIONS_KEY = "hide_bank_notifications";

    // ── Alerts the user has told Covault to ignore ───────────────────────
    //
    // The user marks a capture "not a transaction" on the review page, which
    // writes a pattern to `notification_rules` in the database. The web
    // pipeline honours it, but the web pipeline is not what posts the "$X at Y
    // — captured" notification: this service does, from a cold process, before
    // anything has classified the alert. So a bank promo the user has already
    // dismissed as noise once went on announcing itself as a capture every
    // week, and the only cure was opening the app so the web layer could take
    // it back down again.
    //
    // A copy of the rules therefore lives here, mirrored from the web layer
    // (see setSkipRules in CovaultNotificationPlugin), and a match means no
    // notification is posted at all.
    //
    // What a match does NOT do is stop the capture. The alert is still queued
    // and still broadcast, so the web pipeline remains the authority on what
    // reaches the ledger and the review page still shows it among the things
    // it rejected. That asymmetry is deliberate: a badly-worded `contains` rule
    // can then only ever cost a notification, never a purchase.
    static final String SKIP_RULES_KEY = "notification_skip_rules";

    /**
     * Replace the mirrored copy of the user's skip rules.
     *
     * commit() rather than apply(): the caller is the web layer telling us the
     * user just changed their mind, and the very next notification — which can
     * arrive before a background flush lands — is the one they want silenced.
     */
    static void saveSkipRules(Context context, String rulesJson) {
        try {
            // Parse before storing so a malformed payload is rejected here
            // rather than throwing on every notification afterwards.
            String toStore = new JSONArray(rulesJson == null ? "[]" : rulesJson).toString();
            context.getSharedPreferences("covault_prefs", 0)
                .edit()
                .putString(SKIP_RULES_KEY, toStore)
                .commit();
        } catch (Exception e) {
            Log.w(TAG, "Could not store skip rules", e);
        }
    }

    /**
     * Has the user asked for alerts like this one to be ignored?
     *
     * Mirrors matchesRule in lib/notificationRules.ts exactly — an `exact` rule
     * compares the trimmed text, a `contains` rule is case-insensitive. The two
     * must agree: this decides whether a notification is posted, the web copy
     * decides whether a row is created, and a disagreement shows up as a
     * capture notification for something that never appears in Review.
     */
    static boolean matchesSkipRule(Context context, String text) {
        if (text == null) return false;
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return false;
        try {
            String stored = context.getSharedPreferences("covault_prefs", 0)
                .getString(SKIP_RULES_KEY, "[]");
            JSONArray rules = new JSONArray(stored);
            String lower = trimmed.toLowerCase();
            String textShape = shapeOf(trimmed);
            for (int i = 0; i < rules.length(); i++) {
                JSONObject rule = rules.optJSONObject(i);
                if (rule == null) continue;
                String pattern = rule.optString("pattern", "").trim();
                if (pattern.isEmpty()) continue;
                boolean contains = "contains".equals(rule.optString("pattern_type", "exact"));
                if (contains) {
                    if (lower.contains(pattern.toLowerCase())) return true;
                } else if (trimmed.equals(pattern)) {
                    return true;
                }
                // The same alert with a different number in it. See shapeOf.
                String patternShape = shapeOf(pattern);
                if (patternShape.isEmpty() || !HAS_LETTER.matcher(patternShape).find()) continue;
                if (contains ? textShape.contains(patternShape) : textShape.equals(patternShape)) {
                    return true;
                }
            }
        } catch (Exception e) {
            // An unreadable rule list means we do not know the user said ignore,
            // and the safe reading of "don't know" is to behave as before.
            Log.w(TAG, "Could not read skip rules", e);
        }
        return false;
    }

    /**
     * What a notification looks like with its numbers taken out.
     *
     * A rule is created from the whole text of the alert the user marked, and
     * that text carries the alert's own figure — so a rule made from "BTC is
     * trading at $104,455.73" could never fire again, because the next one says
     * $98,220.10. Every rule made from an alert that reports a changing number
     * was dead on arrival, while appearing in the rules list as though the app
     * were following it.
     *
     * Masking the numbers leaves something that compares: "btc is trading at
     * $#". Nothing else is masked — the merchant and every other word survive,
     * which is what stops a rule made from one shop's alert from matching
     * another's.
     *
     * Mirrors notificationShape in lib/notificationShape.ts, character for
     * character in what it produces; notificationShapeMirror.test.ts fails the
     * build if the two drift. Locale.US rather than the device locale for the
     * same reason: the web copy lowercases the ASCII way, and a Turkish phone
     * lowercasing "I" differently would put the two sides quietly out of step.
     */
    // NOTIFICATION_SHAPE_BEGIN
    private static final Pattern NUMBER_RUN = Pattern.compile("[0-9][0-9.,:/-]*");
    // Month and weekday names, masked ONLY where they sit against a number —
    // "as of Aug 21" and "as of Sep 02" are the same alert. Several of these
    // are ordinary English ("may", "march", "sat"), so masking them anywhere
    // else would rub out real words; next to a number they are a date.
    private static final String DATE_WORDS =
        "january|february|march|april|may|june|july|august|september|october|november|december|"
        + "jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec|"
        + "monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
        + "mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun";
    private static final Pattern DATE_WORD_BEFORE_NUMBER =
        Pattern.compile("\\b(?:" + DATE_WORDS + ")\\s+#");
    private static final Pattern DATE_WORD_AFTER_NUMBER =
        Pattern.compile("#\\s+(?:" + DATE_WORDS + ")\\b");
    private static final Pattern WHITESPACE_RUN = Pattern.compile("\\s+");
    private static final Pattern HAS_LETTER = Pattern.compile("[a-z]");

    static String shapeOf(String text) {
        if (text == null || text.isEmpty()) return "";
        String lowered = text.toLowerCase(java.util.Locale.US);
        String masked = NUMBER_RUN.matcher(lowered).replaceAll("#");
        masked = DATE_WORD_BEFORE_NUMBER.matcher(masked).replaceAll("# #");
        masked = DATE_WORD_AFTER_NUMBER.matcher(masked).replaceAll("# #");
        return WHITESPACE_RUN.matcher(masked).replaceAll(" ").trim();
    }
    // NOTIFICATION_SHAPE_END

    // ── Charges the app is already expecting ─────────────────────────────
    //
    // A subscription arrives twice. Covault's recurring machinery has had it on
    // the books for months and posts the month's occurrence on its due date;
    // the bank then announces the same charge, and this listener announces it
    // again as a fresh capture. The user is told about money they had already
    // accounted for, every month, for every subscription.
    //
    // The web pipeline knows better and creates no second row — but it runs
    // when the app runs, and this notification is posted the instant the alert
    // lands, with the WebView dead. So a copy of the user's recurring charges
    // lives here, mirrored from the web layer (see setRecurringCharges in
    // CovaultNotificationPlugin), and a match means nothing is announced.
    //
    // Exactly the same asymmetry as the skip rules above: a match does NOT stop
    // the capture. The alert is still queued and still broadcast, so the web
    // pipeline remains the authority on what reaches the ledger. It also leaves
    // `notified` false, which keeps tray suppression from dismissing an alert we
    // never replaced — so the bank's own notification stays in the shade and
    // nothing about the charge is hidden from the user.
    //
    // The matcher is deliberately dumber than the web one, in the same spirit
    // as WidgetDeltaStore: the amount to the cent, plus the stored vendor name
    // appearing in the alert's text once punctuation is stripped from both. A
    // name the bank words differently ("PUB MOBILE" for "Public Mobile") simply
    // fails to match, the notification is posted as before, and the web layer
    // withdraws it a moment later.
    static final String RECURRING_CHARGES_KEY = "recurring_charges";

    /** Cents, so a rounding difference cannot call two equal amounts different. */
    private static final double RECURRING_AMOUNT_TOLERANCE = 0.005;

    /**
     * Shortest normalised vendor name allowed to match.
     *
     * The comparison below strips punctuation and spaces out of BOTH sides,
     * which is what makes "Netflix*" on the books recognise "NETFLIX.COM" in the
     * alert — but it also destroys word boundaries, so a two- or three-letter
     * name could match inside an unrelated word. Anything that short is left to
     * the web layer.
     */
    private static final int RECURRING_MIN_VENDOR_LENGTH = 4;

    /** Lowercase letters and digits only — the form both sides are compared in. */
    private static String normaliseForRecurring(String value) {
        if (value == null) return "";
        return value.toLowerCase().replaceAll("[^a-z0-9]", "");
    }

    /**
     * Replace the mirrored copy of the user's recurring charges.
     *
     * commit() rather than apply(): the next notification can arrive before a
     * background flush lands, and that notification is the one this exists to
     * silence.
     */
    static void saveRecurringCharges(Context context, String chargesJson) {
        try {
            // Parse before storing so a malformed payload is rejected here
            // rather than throwing on every notification afterwards.
            String toStore = new JSONArray(chargesJson == null ? "[]" : chargesJson).toString();
            context.getSharedPreferences("covault_prefs", 0)
                .edit()
                .putString(RECURRING_CHARGES_KEY, toStore)
                .commit();
        } catch (Exception e) {
            Log.w(TAG, "Could not store recurring charges", e);
        }
    }

    /**
     * Is this alert a charge Covault is already expecting?
     *
     * Both halves have to agree. The amount is the anchor — a subscription
     * bills the same figure every month — and the vendor keeps a coincidentally
     * equal amount at another merchant from being silenced.
     */
    static boolean matchesRecurringCharge(Context context, Double amount, String text) {
        if (amount == null || text == null) return false;
        // Punctuation stripped from the alert as well as from the stored name,
        // because the two are almost never punctuated the same way: the books
        // say "Netflix*" and the bank says "NETFLIX.COM".
        String haystack = normaliseForRecurring(text);
        if (haystack.isEmpty()) return false;
        try {
            String stored = context.getSharedPreferences("covault_prefs", 0)
                .getString(RECURRING_CHARGES_KEY, "[]");
            JSONArray charges = new JSONArray(stored);
            for (int i = 0; i < charges.length(); i++) {
                JSONObject charge = charges.optJSONObject(i);
                if (charge == null) continue;
                double chargeAmount = charge.optDouble("amount", Double.NaN);
                if (Double.isNaN(chargeAmount)) continue;
                if (Math.abs(chargeAmount - amount) > RECURRING_AMOUNT_TOLERANCE) continue;
                String vendor = normaliseForRecurring(charge.optString("vendor", ""));
                if (vendor.length() < RECURRING_MIN_VENDOR_LENGTH) continue;
                if (haystack.contains(vendor)) return true;
            }
        } catch (Exception e) {
            // Not knowing means behaving as before: announce the capture, and
            // let the web layer take it back down if it turns out to be one of
            // these after all.
            Log.w(TAG, "Could not read recurring charges", e);
        }
        return false;
    }

    // ── What happened to each bank alert ─────────────────────────────────
    //
    // Suppression has several ways to decline and they all look the same from the
    // outside: the alert stays. Told only through logcat, "it still isn't
    // hiding them" costs a release per guess. So each bank alert's outcome is
    // written down and the settings screen reads it back in plain English.
    //
    // Keyed by the notification's identity and replaced rather than appended,
    // so one alert is one row however many passes walk it — and a later pass
    // that manages to dismiss what an earlier one couldn't updates the answer
    // instead of leaving a stale complaint behind it.
    //
    // apply() rather than commit() here, deliberately and unlike everything
    // else in this file: nothing acts on this record. Losing it costs an empty
    // diagnostics list, never a purchase, so it must not make the capture path
    // wait on a disk write.
    private static final String CAPTURE_LOG_PREF = "capture_outcomes";
    private static final int MAX_CAPTURE_LOG = 8;
    private static final Object CAPTURE_LOG_LOCK = new Object();

    /** Dismissed, and confirmed gone from the shade. */
    static final String OUTCOME_HIDDEN = "hidden";
    /** Android is refusing to let Covault post its replacement notification. */
    static final String OUTCOME_BLOCKED = "blocked";
    /** The durable queue write failed, so there is nothing to fall back on. */
    static final String OUTCOME_NOT_SAVED = "not_saved";
    /** The user has the toggle off. */
    static final String OUTCOME_TOGGLE_OFF = "toggle_off";
    /** The native regex found no amount, so this may not be a purchase. */
    static final String OUTCOME_NO_AMOUNT = "no_amount";
    /** An ongoing notification the system does not allow anyone to clear. */
    static final String OUTCOME_NOT_CLEARABLE = "not_clearable";
    /** Dismissal was asked for twice and the alert is still in the tray. */
    static final String OUTCOME_CANCEL_IGNORED = "cancel_ignored";
    /**
     * The user told Covault to ignore alerts like this one, so nothing was
     * posted in its place — and an alert we have not replaced is one we must
     * not remove.
     */
    static final String OUTCOME_USER_IGNORED = "user_ignored";
    /**
     * Covault already had this charge on the books as a recurring one, so it
     * announced nothing — and again, an alert we have not replaced is one we
     * must not remove.
     */
    static final String OUTCOME_KNOWN_RECURRING = "known_recurring";

    /**
     * The alert read as a price alert, a promo or an announcement rather than a
     * purchase, so nothing was posted in its place — and an alert we have not
     * replaced is one we must not remove.
     */
    static final String OUTCOME_NOT_A_PURCHASE = "not_a_purchase";

    private static final long DISMISS_VERIFY_DELAY_MS = 700L;
    private final android.os.Handler dismissHandler =
        new android.os.Handler(android.os.Looper.getMainLooper());

    private void recordOutcome(String securedKey, String app, Double amount, String outcome) {
        try {
            synchronized (CAPTURE_LOG_LOCK) {
                SharedPreferences prefs = getSharedPreferences("covault_prefs", 0);
                JSONArray stored;
                try {
                    stored = new JSONArray(prefs.getString(CAPTURE_LOG_PREF, "[]"));
                } catch (Exception e) {
                    stored = new JSONArray();
                }

                JSONObject entry = new JSONObject();
                entry.put("key", securedKey == null ? "" : securedKey);
                entry.put("at", System.currentTimeMillis());
                entry.put("app", app == null ? "" : app);
                if (amount != null) entry.put("amount", amount);
                entry.put("outcome", outcome);

                // Rebuild without any earlier row for this same alert, then put
                // the new answer last — newest at the end, one row per alert.
                JSONArray next = new JSONArray();
                for (int i = 0; i < stored.length(); i++) {
                    JSONObject row = stored.optJSONObject(i);
                    if (row == null) continue;
                    if (securedKey != null && securedKey.equals(row.optString("key", null))) continue;
                    next.put(row);
                }
                next.put(entry);

                JSONArray trimmed = next;
                if (next.length() > MAX_CAPTURE_LOG) {
                    trimmed = new JSONArray();
                    for (int i = next.length() - MAX_CAPTURE_LOG; i < next.length(); i++) {
                        trimmed.put(next.get(i));
                    }
                }
                prefs.edit().putString(CAPTURE_LOG_PREF, trimmed.toString()).apply();
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not record the capture outcome", e);
        }
    }

    /**
     * The recent outcomes as a JSON array string, newest last.
     *
     * Handed over as text rather than a parsed structure so the shape lives in
     * exactly one place — the JS side already has to validate whatever arrives.
     */
    static String readCaptureOutcomes(Context context) {
        try {
            synchronized (CAPTURE_LOG_LOCK) {
                return context.getSharedPreferences("covault_prefs", 0)
                    .getString(CAPTURE_LOG_PREF, "[]");
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read the capture outcomes", e);
            return "[]";
        }
    }

    // ── The record of what Covault has already replaced ──────────────────
    //
    // A notification can be walked more than once: the live post, then a scan
    // every time the listener reconnects. Only the first pass should tell the
    // user about it — but every pass should be allowed to clear it out of the
    // tray, because the pass that captured it may have been unable to (the
    // toggle was off then, the dismissal threw, the notification was not
    // clearable yet).
    //
    // Deciding that from `fromScan` alone cannot work: that flag says how we
    // arrived, not whether the user has been told. So the answer is written
    // down instead, and it has to survive the process — the listener service
    // is killed and restarted freely, and an in-memory set would forget on
    // every restart and re-notify for everything still in the shade.
    //
    // Only keys that were fully secured are recorded (durably queued AND a
    // Covault notification posted). A key in here is therefore a promise that
    // the user has already seen this purchase, which is what makes dismissing
    // the bank's copy on a later pass safe.
    private static final String SECURED_KEYS_PREF = "secured_notifications";
    private static final int MAX_SECURED_KEYS = 200;
    private static final Object SECURED_LOCK = new Object();

    /**
     * Identity of one notification, stable across rescans.
     *
     * getKey() alone is not enough: a bank reuses the same notification id for
     * the next alert, so a second purchase would look like one already handled
     * and be silently dismissed without ever being announced. The post time is
     * what separates them, and it does not change when the shade is re-walked.
     */
    private static String securedKeyFor(StatusBarNotification sbn) {
        String key = sbn.getKey();
        return (key == null ? sbn.getPackageName() : key) + "|" + sbn.getPostTime();
    }

    private boolean wasSecured(String securedKey) {
        if (securedKey == null) return false;
        try {
            synchronized (SECURED_LOCK) {
                String stored = getSharedPreferences("covault_prefs", 0)
                    .getString(SECURED_KEYS_PREF, "[]");
                JSONArray keys = new JSONArray(stored);
                for (int i = 0; i < keys.length(); i++) {
                    if (securedKey.equals(keys.optString(i, null))) return true;
                }
            }
        } catch (Exception e) {
            // An unreadable record is not a promise that the user was told, so
            // it must read as "no". The cost is one extra capture notification.
            Log.w(TAG, "Could not read the secured-notification record", e);
        }
        return false;
    }

    /**
     * Remember that this notification has been captured and replaced.
     *
     * commit(), not apply(), for the same reason the pending queue uses it: a
     * later pass dismisses the bank's notification on the strength of this
     * record, so it has to mean "written", not "queued to be written".
     */
    private void rememberSecured(String securedKey) {
        if (securedKey == null) return;
        try {
            synchronized (SECURED_LOCK) {
                SharedPreferences prefs = getSharedPreferences("covault_prefs", 0);
                JSONArray keys;
                try {
                    keys = new JSONArray(prefs.getString(SECURED_KEYS_PREF, "[]"));
                } catch (Exception e) {
                    keys = new JSONArray();
                }
                for (int i = 0; i < keys.length(); i++) {
                    if (securedKey.equals(keys.optString(i, null))) return;
                }
                keys.put(securedKey);
                if (keys.length() > MAX_SECURED_KEYS) {
                    JSONArray trimmed = new JSONArray();
                    for (int i = keys.length() - MAX_SECURED_KEYS; i < keys.length(); i++) {
                        trimmed.put(keys.get(i));
                    }
                    keys = trimmed;
                }
                prefs.edit().putString(SECURED_KEYS_PREF, keys.toString()).commit();
            }
        } catch (Exception e) {
            // Losing the record costs one duplicate capture notification the
            // next time the shade is walked. It never costs a purchase.
            Log.w(TAG, "Could not record the secured notification", e);
        }
    }

    /**
     * Where a tapped notification should land the user.
     *
     * Carried as an intent extra rather than a deep-link URI so it can't be
     * confused with the OAuth callback that already uses the com.covault.app
     * scheme, and so it works identically on a cold start (MainActivity.onCreate)
     * and a warm one (onNewIntent).
     */
    static final String ROUTE_EXTRA = "covault_route";
    static final String ROUTE_REVIEW = "review";
    /**
     * "budget:Groceries" — open the dashboard with that budget expanded.
     *
     * A prefix rather than a second extra so the whole destination stays one
     * string. MainActivity parks it, the plugin hands it over, and the web
     * layer decides what it means; nothing in between has to learn a new shape
     * when another destination is added.
     */
    static final String ROUTE_BUDGET_PREFIX = "budget:";
    /** SharedPreferences key MainActivity parks the route in until JS asks. */
    static final String PENDING_ROUTE_KEY = "pending_route";

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Not needed for our use case
    }

    private boolean isTransactionNotification(String text) {
        String lowerText = text.toLowerCase();
        for (String keyword : TRANSACTION_KEYWORDS) {
            if (lowerText.contains(keyword)) {
                return true;
            }
        }
        // Also treat as a transaction if the notification contains a dollar amount.
        // Banking app notifications with dollar amounts are almost certainly transactions,
        // even without explicit keywords (e.g. Wealthsimple: "$12.34 at Tim Hortons").
        for (Pattern pattern : AMOUNT_PATTERNS) {
            if (pattern.matcher(text).find()) {
                return true;
            }
        }
        return false;
    }

    private Double extractAmount(String text) {
        for (Pattern pattern : AMOUNT_PATTERNS) {
            Matcher matcher = pattern.matcher(text);
            if (matcher.find()) {
                try {
                    String amountStr = matcher.group(1).replace(",", "");
                    return Double.parseDouble(amountStr);
                } catch (NumberFormatException e) {
                    Log.w(TAG, "Failed to parse amount: " + matcher.group(1));
                }
            }
        }
        return null;
    }

    /** Remove emoji/pictographs so the vendor patterns can match across them. */
    private static String stripEmoji(String text) {
        if (text == null) return "";
        return EMOJI_PATTERN.matcher(text).replaceAll(" ").replaceAll("\\s{2,}", " ").trim();
    }

    /**
     * True if every token is a pronoun, article or verb — i.e. the pattern
     * landed in the description instead of the merchant name.
     */
    private static boolean isNonVendor(String candidate) {
        String[] tokens = candidate.toLowerCase().split("[^a-z0-9']+");
        boolean sawToken = false;
        for (String token : tokens) {
            if (token.isEmpty()) continue;
            sawToken = true;
            if (!NON_VENDOR_WORDS.contains(token)) return false;
        }
        return sawToken;
    }

    private String extractVendor(String text) {
        // Strip emoji FIRST. See EMOJI_PATTERN — a category glyph between the
        // merchant name and the spending verb otherwise defeats every
        // merchant-leading pattern.
        String cleaned = stripEmoji(text);

        for (Pattern pattern : VENDOR_PATTERNS) {
            Matcher matcher = pattern.matcher(cleaned);
            if (matcher.find()) {
                String vendor = matcher.group(1).trim();
                // Clean up the vendor name
                vendor = vendor.replaceAll("\\s+", " ");
                // Keep trying later patterns rather than returning "You" or
                // "a purchase". Returning null is better than a wrong name:
                // the TS pipeline re-parses the raw text anyway, and a wrong
                // vendor is worse than none because the cross-app duplicate
                // check compares vendor names to decide what to collapse.
                if (vendor.length() >= 2 && vendor.length() < 60 && !isNonVendor(vendor)) {
                    return vendor;
                }
            }
        }
        return null;
    }

    /**
     * Persist a captured notification so it survives the app being closed.
     *
     * This service runs independently of the WebView. When a notification
     * arrives while the app is not running, sendBroadcast() has no receiver and
     * the transaction is dropped; if the user then swipes the notification away,
     * scanActiveNotifications() can never find it either, so the purchase is
     * lost outright. Queuing here means the JS side can drain it on next launch.
     *
     * The queue is bounded and drained-and-cleared by the plugin. Delivering the
     * same notification twice is harmless — the JS pipeline's in-memory and
     * persistent dedup collapse it.
     */
    private static final String PENDING_QUEUE_KEY = "pending_notifications";
    private static final int MAX_PENDING = 200;

    /**
     * Guards the pending queue's read-modify-write.
     *
     * The service appends to the queue and the plugin drains-and-clears it,
     * both in this process and on different threads. Without a lock the two
     * interleave: the plugin reads the stored array, the service commits an
     * appended copy, then the plugin's clear lands and the just-appended entry
     * is gone. That used to be survivable — the notification was still sitting
     * in the shade for scanActiveNotifications() to find. With tray
     * suppression on, that notification has been dismissed, so the queue is
     * the only copy and losing an entry means losing the purchase.
     */
    static final Object QUEUE_LOCK = new Object();

    /**
     * Atomically take everything in the pending queue and clear it.
     * Called by the plugin on the JS side's behalf.
     *
     * Clearing before the caller has processed the batch is deliberate (see
     * CovaultNotificationPlugin.drainPendingNotifications) — the point of the
     * lock is only that a concurrent append cannot be swallowed by the clear.
     */
    static String drainPendingQueue(android.content.Context context) {
        synchronized (QUEUE_LOCK) {
            android.content.SharedPreferences prefs =
                context.getSharedPreferences("covault_prefs", 0);
            String stored = prefs.getString(PENDING_QUEUE_KEY, "[]");
            prefs.edit().remove(PENDING_QUEUE_KEY).commit();
            return stored;
        }
    }

    /**
     * Post a Covault notification the moment a purchase is captured.
     *
     * The parsing/categorising pipeline lives in JS, which only runs while the
     * WebView is alive — so a notification posted from there appears only once
     * the user opens the app. This service, by contrast, runs whenever the
     * listener permission is granted, so posting here is what makes capture
     * feel immediate. The amount and vendor come from the native regex pass
     * that already ran above; the JS pipeline still does the real
     * categorisation and insert when it next runs.
     */
    private static final String CAPTURE_CHANNEL_ID = "covault_captures";
    private static final long CAPTURE_NOTIFY_WINDOW_MS = 60_000L;
    private final java.util.Map<String, Long> recentCaptureNotifications = new java.util.HashMap<>();

    private static void ensureCaptureChannel(android.app.NotificationManager nm) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CAPTURE_CHANNEL_ID) != null) return;
        android.app.NotificationChannel channel = new android.app.NotificationChannel(
            CAPTURE_CHANNEL_ID,
            "Captured transactions",
            android.app.NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Shown when Covault captures a transaction from a bank alert");
        nm.createNotificationChannel(channel);
    }

    /**
     * Same, from anywhere — the settings screen creates the channel before it
     * sends the user to Android to re-enable it.
     */
    static void ensureCaptureChannel(Context context) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) ensureCaptureChannel(nm);
        } catch (Exception e) {
            Log.w(TAG, "Could not create the capture channel", e);
        }
    }

    /**
     * Can a Covault capture notification actually reach the shade right now?
     *
     * Notifications can be switched off for the whole app, or this one channel
     * can be set to "None", in which case nm.notify() succeeds and shows
     * nothing. The tray-suppression path must not remove a bank's notification
     * on the strength of a replacement that is silently dropped, so it asks
     * this first.
     */
    private boolean canPostCaptureNotifications(android.app.NotificationManager nm) {
        return canPostCaptureNotifications(this, nm);
    }

    /**
     * Same question, asked from the settings screen instead of the capture
     * path — so the "Hide bank alerts after capture" toggle can say that
     * Android is the reason nothing is being hidden.
     *
     * Static and shared for the same reason the preference read is: a second
     * copy of this could say "fine" while the capture path was bailing out.
     */
    static boolean canPostCaptureNotifications(Context context) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
            return canPostCaptureNotifications(context, nm);
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean canPostCaptureNotifications(
        Context context,
        android.app.NotificationManager nm
    ) {
        try {
            if (!androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                return false;
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                if (nm == null) return false;
                android.app.NotificationChannel channel = nm.getNotificationChannel(CAPTURE_CHANNEL_ID);
                if (channel != null
                    && channel.getImportance() == android.app.NotificationManager.IMPORTANCE_NONE) {
                    return false;
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * The key that decides whether two captures are the same purchase, and —
     * via its hash — which notification id the capture is posted under.
     *
     * The same purchase is often announced by both the bank app and a wallet
     * app. Collapse those so the user sees one Covault notification, not two.
     *
     * The key must NOT be built from the "a purchase" placeholder when the
     * vendor is unknown. That is a constant, so every unparsed capture would
     * land in one bucket keyed on the amount alone: two different shops
     * charging the same price within CAPTURE_NOTIFY_WINDOW_MS would collide,
     * and the second would hit the containsKey check in notifyCaptured and
     * return early — reporting success while posting nothing. The user simply
     * never hears about the second purchase.
     *
     * That became much more likely once extractVendor started returning null
     * instead of a junk value like "You": junk names at least differed from
     * each other, so they collided far less often.
     *
     * With no vendor to key on, fall back to the raw notification text, which
     * is what actually distinguishes two purchases at the same price. Hashed
     * rather than concatenated to keep the key bounded.
     *
     * Static and shared with captureNotificationId so the id handed to the web
     * layer is provably the id the notification was posted under. The web layer
     * cancels by that id when the pipeline decides the alert was not a purchase
     * after all, and a second copy of this arithmetic drifting apart would mean
     * cancelling a notification that isn't there while the wrong one stays.
     */
    private static String captureDedupKey(Double amount, String vendor, String rawText) {
        boolean haveVendor = vendor != null && !vendor.isEmpty();
        String dedupBasis = haveVendor
            ? vendor.toLowerCase()
            : "raw:" + Integer.toHexString((rawText == null ? "" : rawText).hashCode());
        return dedupBasis + "|" + String.format(java.util.Locale.US, "%.2f", amount == null ? 0d : amount);
    }

    /**
     * The Android notification id a capture is (or would be) posted under.
     *
     * Computed from the inputs alone, so it can be written into the durable
     * queue before the post is attempted — the queue entry outlives the
     * process, and the web layer that drains it hours later needs to be able to
     * take the notification back down.
     */
    static int captureNotificationId(Double amount, String vendor, String rawText) {
        return captureDedupKey(amount, vendor, rawText).hashCode();
    }

    /**
     * @return true if a Covault notification for this purchase is showing —
     *         either posted by this call, or posted moments ago and collapsed
     *         by the dedup below. False means the user has no Covault-side
     *         record of this purchase in the shade.
     */
    private boolean notifyCaptured(Double amount, String vendor, String rawText) {
        // Nothing useful to show without an amount.
        if (amount == null) {
            Log.w(TAG, "CAPTURE-DIAG notify=skipped reason=no-amount");
            return false;
        }
        try {
            boolean haveVendor = vendor != null && !vendor.isEmpty();
            String merchant = haveVendor ? vendor : "a purchase";

            String dedupKey = captureDedupKey(amount, vendor, rawText);
            long now = System.currentTimeMillis();
            // Locked because cancelCaptureNotification prunes the same map from
            // whichever thread the web layer's cancel arrives on.
            synchronized (recentCaptureNotifications) {
                java.util.Iterator<java.util.Map.Entry<String, Long>> it = recentCaptureNotifications.entrySet().iterator();
                while (it.hasNext()) {
                    if (now - it.next().getValue() > CAPTURE_NOTIFY_WINDOW_MS) it.remove();
                }
                if (recentCaptureNotifications.containsKey(dedupKey)) return true;
            }

            android.app.NotificationManager nm =
                (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) {
                Log.w(TAG, "CAPTURE-DIAG notify=skipped reason=no-notification-manager");
                return false;
            }
            ensureCaptureChannel(nm);
            if (!canPostCaptureNotifications(nm)) {
                // The single most confusing failure in this whole path, and it
                // used to be silent. Returning false here makes `secured` false
                // in broadcastTransaction, which in turn makes
                // maybeHideBankNotification bail — so losing permission to POST
                // notifications ALSO silently disables tray suppression, and
                // the app looks completely dead while the listener is in fact
                // running fine.
                //
                // Note this is a DIFFERENT permission from notification-listener
                // access: reading other apps' notifications is granted in
                // "Notification access", posting our own needs POST_NOTIFICATIONS
                // (Android 13+), which a reinstall can revoke on its own.
                Log.w(TAG, "CAPTURE-DIAG notify=skipped reason=post-notifications-blocked "
                    + "(check POST_NOTIFICATIONS permission and the Captures channel)");
                return false;
            }

            synchronized (recentCaptureNotifications) {
                recentCaptureNotifications.put(dedupKey, now);
            }

            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            android.app.PendingIntent contentIntent = null;
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                // The notification says "tap to review", so say where to land.
                // MainActivity stashes this for the WebView to pick up, since
                // JS isn't running yet on a cold start. See MainActivity and
                // CovaultNotificationPlugin.consumePendingRoute.
                open.putExtra(ROUTE_EXTRA, ROUTE_REVIEW);
                contentIntent = android.app.PendingIntent.getActivity(
                    this, 0, open,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
                );
            }

            int smallIcon = getResources().getIdentifier("ic_stat_dollar", "drawable", getPackageName());
            if (smallIcon == 0) smallIcon = android.R.drawable.ic_menu_info_details;

            androidx.core.app.NotificationCompat.Builder b =
                new androidx.core.app.NotificationCompat.Builder(this, CAPTURE_CHANNEL_ID)
                    .setSmallIcon(smallIcon)
                    .setContentTitle(String.format(java.util.Locale.US, "$%.2f at %s", amount, merchant))
                    .setContentText("Captured — tap to review")
                    .setAutoCancel(true)
                    .setPriority(androidx.core.app.NotificationCompat.PRIORITY_DEFAULT);
            if (contentIntent != null) b.setContentIntent(contentIntent);

            nm.notify(dedupKey.hashCode(), b.build());
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Error posting capture notification", e);
            return false;
        }
    }

    /**
     * Take a capture notification back down.
     *
     * The notification is posted from here, before anything has decided whether
     * the alert was a purchase at all — it has to be, because this service is
     * the only part of Covault running when the app is closed, and tray
     * suppression may only dismiss a bank's alert once ours is in its place.
     * The classifying happens in the web layer, which may be minutes or hours
     * behind. When it concludes the alert was not an expense, this is how the
     * "$X at Y — captured" that was posted on spec gets withdrawn.
     *
     * The dedup entry goes with it. Leaving it behind would mean the next
     * genuine purchase at the same merchant for the same amount inside
     * CAPTURE_NOTIFY_WINDOW_MS silently posts nothing, having "already"
     * notified — the exact failure the raw-text fallback in captureDedupKey
     * exists to prevent.
     */
    static void cancelCaptureNotification(Context context, int id) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(id);
        } catch (Exception e) {
            Log.w(TAG, "Could not cancel capture notification " + id, e);
        }
        NotificationListener live = getInstance();
        if (live == null) return;
        try {
            synchronized (live.recentCaptureNotifications) {
                java.util.Iterator<java.util.Map.Entry<String, Long>> it =
                    live.recentCaptureNotifications.entrySet().iterator();
                while (it.hasNext()) {
                    if (it.next().getKey().hashCode() == id) it.remove();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not clear the dedup entry for " + id, e);
        }
    }

    /**
     * @return true only once the entry is durably on disk.
     *
     * This uses commit() rather than apply() deliberately. apply() returns
     * immediately and flushes on a background thread, so a true return would
     * say nothing about whether the write survived. The tray-suppression path
     * dismisses the bank's own notification on the strength of this return
     * value, so it has to mean "written", not "queued to be written".
     */
    private boolean queueTransaction(JSONObject transaction) {
        try {
            synchronized (QUEUE_LOCK) {
                android.content.SharedPreferences prefs = getSharedPreferences("covault_prefs", 0);
                JSONArray queue;
                try {
                    queue = new JSONArray(prefs.getString(PENDING_QUEUE_KEY, "[]"));
                } catch (Exception e) {
                    queue = new JSONArray();
                }
                queue.put(transaction);

                // Drop the oldest entries if we're over the cap.
                if (queue.length() > MAX_PENDING) {
                    JSONArray trimmed = new JSONArray();
                    for (int i = queue.length() - MAX_PENDING; i < queue.length(); i++) {
                        trimmed.put(queue.get(i));
                    }
                    queue = trimmed;
                }
                return prefs.edit().putString(PENDING_QUEUE_KEY, queue.toString()).commit();
            }
        } catch (Exception e) {
            Log.e(TAG, "Error queueing transaction", e);
            return false;
        }
    }

    /**
     * The two preconditions for dismissing a bank's own notification, kept
     * apart rather than reduced to one boolean.
     *
     * Both failures leave the alert in the tray and look identical there, but
     * one means "the purchase isn't safely written down" and the other means
     * "Android won't let us tell you about it". They need different fixes, so
     * the caller is told which it was.
     */
    private static final class CaptureResult {
        final boolean queued;
        final boolean notified;

        CaptureResult(boolean queued, boolean notified) {
            this.queued = queued;
            this.notified = notified;
        }

        boolean secured() {
            return queued && notified;
        }
    }

    /**
     * @return whether the notification was durably queued, and whether a
     *         Covault notification is showing for it — the two preconditions
     *         for dismissing the bank's own notification.
     */
    private CaptureResult broadcastTransaction(String sourceApp, Double amount, String vendor, String rawText, long postTime, boolean fromScan, boolean alreadySecured, boolean captureQuietly) {
        try {
            JSONObject transaction = new JSONObject();
            transaction.put("source_app", sourceApp);
            if (amount != null) {
                transaction.put("amount", amount);
            }
            transaction.put("vendor", vendor != null ? vendor : "Unknown Merchant");
            transaction.put("raw_text", rawText);
            // Use the notification's original post time (stable across rescans)
            // instead of System.currentTimeMillis() which changes each time
            transaction.put("timestamp", postTime);
            transaction.put("from_scan", fromScan);
            // Which notification announced this capture, so the web layer can
            // take it back down if it turns out not to be an expense. Written
            // before the post is attempted — and so before the queue write —
            // because the queue is what survives the process, and a capture
            // drained hours later still needs to be able to clear the shade.
            // Computed from the same inputs the post uses, so it is right
            // whether the post succeeded, was collapsed as a duplicate, or was
            // skipped for a skip rule.
            transaction.put("capture_notification_id",
                captureNotificationId(amount, vendor, rawText));

            // Persist first, so the transaction survives even if no receiver is
            // listening right now (app closed/backgrounded).
            boolean queued = queueTransaction(transaction);

            // Tell the user immediately. A rescan re-walks the shade and would
            // otherwise re-notify for things already seen — but "seen" means
            // we actually told them once, not merely that we arrived via a
            // scan. A notification the listener never got a live post for (the
            // service was restarted, the phone rebooted) is new to the user
            // however we found it, and staying silent about it also left it
            // undismissable, since suppression needs a replacement to exist.
            //
            // Unless this is one of the quiet captures — an alert the user
            // has told us to ignore, a subscription already on the books, or
            // wording the parser rejects on sight — in which case the whole
            // point is that nothing is announced. Note this leaves `notified`
            // false, which is what keeps tray suppression from dismissing an
            // alert we never replaced.
            boolean notified = false;
            if (!captureQuietly && (!fromScan || !alreadySecured)) {
                notified = notifyCaptured(amount, vendor, rawText);
            }

            // Broadcast to the app
            Intent intent = new Intent("com.covault.app.TRANSACTION_DETECTED");
            intent.putExtra("transaction_data", transaction.toString());
            intent.setPackage(getPackageName());
            sendBroadcast(intent);

            Log.i(TAG, "Broadcast transaction: " + transaction.toString());

            // One line that explains the whole capture, so a single logcat
            // filter answers "why did nothing happen?" without reading code.
            // `secured` is what gates tray suppression downstream, so print the
            // two things it is built from rather than just the result.
            boolean secured = queued && notified;
            Log.i(TAG, "CAPTURE-DIAG pkg=" + sourceApp
                + " amount=" + amount
                + " vendor=" + (vendor == null ? "<null>" : vendor)
                + " queued=" + queued
                + " notified=" + notified
                + " fromScan=" + fromScan
                + " alreadySecured=" + alreadySecured
                + " secured=" + secured
                + ((secured || alreadySecured) ? "" : " -> tray suppression will be SKIPPED"));

            return new CaptureResult(queued, notified);

        } catch (Exception e) {
            Log.e(TAG, "Error broadcasting transaction", e);
            return new CaptureResult(false, false);
        }
    }
}