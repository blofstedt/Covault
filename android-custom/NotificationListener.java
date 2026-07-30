package com.covault.app;

import android.app.Notification;
import android.content.Intent;
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
    private static final Pattern[] VENDOR_PATTERNS = {
        // "VENDOR - You spent $X" / "VENDOR – You charged $X" (e.g. Wealthsimple)
        // Must come first so the clean vendor name is captured before the spending phrase.
        Pattern.compile("^([A-Za-z0-9&'./# -]{2,60}?)\\s*[-\\u2013\\u2014]\\s*(?:[Yy]ou\\s+)?(?:spent|charged|paid|purchased)\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:at|from|to|@)\\s+([A-Za-z0-9\\s&'.-]+?)\\s+(?:for|on|\\$|USD|CAD|charged)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:purchase|transaction|payment)\\s+(?:at|from)\\s+([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE),
        // Vendor before dollar amount — stop before spending verbs so we don't
        // capture "AMZN MKTP CA You spent" instead of just "AMZN MKTP CA".
        Pattern.compile("([A-Z][A-Za-z0-9\\s&'.-]+?)\\s+(?:(?:you\\s+)?(?:spent|charged|paid|purchased)\\s+)?\\$[\\d,]+\\.\\d{2}", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:merchant|vendor|store)\\s*:?\\s*([A-Za-z0-9\\s&'.-]+)", Pattern.CASE_INSENSITIVE)
    };

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
        boolean fromMonitored = isMonitoredApp(packageName);
        boolean hasDollarAmount = extractAmount(fullText) != null;

        if (!fromMonitored && !hasDollarAmount) {
            return;
        }

        // Extract transaction data (best-effort; the local extraction
        // pipeline will handle extraction when native regex doesn't match)
        Double amount = extractAmount(fullText);
        String vendor = extractVendor(fullText);

        Log.i(TAG, "Financial notification from " + packageName + ": " + (amount != null ? "$" + amount : "[amount pending]") + " at " + (vendor != null ? vendor : "Unknown"));

        // Broadcast to the local TypeScript pipeline which will classify
        // as transaction or non-transaction — non-transactions will appear in
        // the rejected card so the user can see what was processed.
        boolean secured = broadcastTransaction(packageName, amount, vendor, fullText, sbn.getPostTime(), fromScan);

        maybeHideBankNotification(sbn, fromMonitored, amount, fromScan, secured);
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
    //   2. This is a live post, not a rescan. A rescan re-walks notifications
    //      that are already in the shade and already captured; clearing the
    //      shade is not its job.
    //   3. The notification came from a monitored banking app.
    //      handleNotificationPosted also forwards anything containing a
    //      dollar amount — an SMS, an email, a receipt — and we must never
    //      delete those.
    //   4. The native regex found an amount, i.e. this really does look like
    //      a purchase rather than a balance alert or a login warning.
    //   5. The notification is clearable (not an ongoing/foreground one).
    //   6. It was durably written to the pending queue. queueTransaction
    //      uses commit(), not apply(), so by the time this returns true the
    //      bytes are on disk and the JS pipeline will find them on next
    //      launch even if the process is killed a millisecond later.
    //   7. A Covault notification for this purchase is showing. If our own
    //      notifications are blocked at the OS level, or posting threw, we
    //      would be removing the user's only visible record — so we don't.
    //
    // Ordering is the safety property: persist, then notify, then dismiss.
    // The bank's notification is only ever removed after Covault holds a
    // durable copy of it and has put something in its place.
    private void maybeHideBankNotification(
        StatusBarNotification sbn,
        boolean fromMonitored,
        Double amount,
        boolean fromScan,
        boolean secured
    ) {
        if (fromScan) return;                 // (2)
        if (!fromMonitored) return;           // (3)
        if (amount == null) return;           // (4)
        if (!secured) return;                 // (6) + (7)
        if (!isHideBankNotificationsEnabled()) return;  // (1)
        try {
            if (!sbn.isClearable()) return;   // (5)
            String key = sbn.getKey();
            if (key == null) return;
            cancelNotification(key);
            Log.i(TAG, "Dismissed bank notification after capture: " + sbn.getPackageName());
        } catch (Exception e) {
            // A failure here is harmless: the bank's notification simply stays.
            Log.w(TAG, "Could not dismiss bank notification", e);
        }
    }

    private boolean isHideBankNotificationsEnabled() {
        try {
            return getSharedPreferences("covault_prefs", 0)
                .getBoolean(HIDE_BANK_NOTIFICATIONS_KEY, false);
        } catch (Exception e) {
            // Unreadable preference means we cannot prove the user opted in.
            return false;
        }
    }

    static final String HIDE_BANK_NOTIFICATIONS_KEY = "hide_bank_notifications";

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

    private String extractVendor(String text) {
        for (Pattern pattern : VENDOR_PATTERNS) {
            Matcher matcher = pattern.matcher(text);
            if (matcher.find()) {
                String vendor = matcher.group(1).trim();
                // Clean up the vendor name
                vendor = vendor.replaceAll("\\s+", " ");
                if (vendor.length() >= 2 && vendor.length() < 60) {
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

    private void ensureCaptureChannel(android.app.NotificationManager nm) {
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
     * Can a Covault capture notification actually reach the shade right now?
     *
     * Notifications can be switched off for the whole app, or this one channel
     * can be set to "None", in which case nm.notify() succeeds and shows
     * nothing. The tray-suppression path must not remove a bank's notification
     * on the strength of a replacement that is silently dropped, so it asks
     * this first.
     */
    private boolean canPostCaptureNotifications(android.app.NotificationManager nm) {
        try {
            if (!androidx.core.app.NotificationManagerCompat.from(this).areNotificationsEnabled()) {
                return false;
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
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
     * @return true if a Covault notification for this purchase is showing —
     *         either posted by this call, or posted moments ago and collapsed
     *         by the dedup below. False means the user has no Covault-side
     *         record of this purchase in the shade.
     */
    private boolean notifyCaptured(Double amount, String vendor) {
        // Nothing useful to show without an amount.
        if (amount == null) return false;
        try {
            String merchant = (vendor != null && !vendor.isEmpty()) ? vendor : "a purchase";

            // The same purchase is often announced by both the bank app and a
            // wallet app. Collapse those so the user sees one Covault
            // notification, not two.
            String dedupKey = merchant.toLowerCase() + "|" + String.format(java.util.Locale.US, "%.2f", amount);
            long now = System.currentTimeMillis();
            java.util.Iterator<java.util.Map.Entry<String, Long>> it = recentCaptureNotifications.entrySet().iterator();
            while (it.hasNext()) {
                if (now - it.next().getValue() > CAPTURE_NOTIFY_WINDOW_MS) it.remove();
            }
            if (recentCaptureNotifications.containsKey(dedupKey)) return true;

            android.app.NotificationManager nm =
                (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return false;
            ensureCaptureChannel(nm);
            if (!canPostCaptureNotifications(nm)) return false;

            recentCaptureNotifications.put(dedupKey, now);

            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            android.app.PendingIntent contentIntent = null;
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
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
     * @return true if the notification was durably queued AND a Covault
     *         notification is showing for it — the two preconditions for
     *         dismissing the bank's own notification.
     */
    private boolean broadcastTransaction(String sourceApp, Double amount, String vendor, String rawText, long postTime, boolean fromScan) {
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

            // Persist first, so the transaction survives even if no receiver is
            // listening right now (app closed/backgrounded).
            boolean queued = queueTransaction(transaction);

            // Tell the user immediately. A rescan re-walks the shade and would
            // otherwise re-notify for things already seen, so skip those.
            boolean notified = false;
            if (!fromScan) {
                notified = notifyCaptured(amount, vendor);
            }

            // Broadcast to the app
            Intent intent = new Intent("com.covault.app.TRANSACTION_DETECTED");
            intent.putExtra("transaction_data", transaction.toString());
            intent.setPackage(getPackageName());
            sendBroadcast(intent);

            Log.i(TAG, "Broadcast transaction: " + transaction.toString());

            return queued && notified;

        } catch (Exception e) {
            Log.e(TAG, "Error broadcasting transaction", e);
            return false;
        }
    }
}
