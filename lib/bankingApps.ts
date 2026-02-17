// Known banking app package names (must match NotificationListener.java)
export const KNOWN_BANKING_APPS: Record<string, string> = {
  // Canadian Banks
  'com.bmo.mobile': 'BMO',
  'com.rbc.mobile.android': 'RBC',
  'com.td': 'TD Canada',
  'com.cibc.android.mobi': 'CIBC',
  'com.scotiabank.mobile': 'Scotiabank',
  'com.bns.mobile': 'Scotiabank',
  'ca.bnc.android': 'National Bank',
  'com.desjardins.mobile': 'Desjardins',
  'com.atb.atbmobile': 'ATB Financial',
  'ca.tangerine.clients.banking': 'Tangerine',
  'com.simplicite.app': 'Simplii',
  'ca.hsbc.hsbccanada': 'HSBC Canada',
  'com.laurentianbank.mobile': 'Laurentian Bank',
  'com.eq.mobile': 'EQ Bank',
  'com.manulife.mobile': 'Manulife',
  // Canadian Fintech
  'com.wealthsimple': 'Wealthsimple',
  'com.wealthsimple.trade': 'Wealthsimple Trade',
  'com.neofinancial.android': 'Neo Financial',
  'com.koho.android': 'KOHO',
  'com.mogo.mobile': 'Mogo',
  'ca.payments.interac': 'Interac',
  'com.questrade.questmobile': 'Questrade',
  // US Banks
  'com.chase.sig.android': 'Chase',
  'com.wf.wellsfargomobile': 'Wells Fargo',
  'com.infonow.bofa': 'Bank of America',
  'com.citi.citimobile': 'Citi',
  'com.usbank.mobilebanking': 'US Bank',
  'com.pnc.ecommerce.mobile': 'PNC',
  'com.tdbank': 'TD Bank',
  'com.capitalone.mobile': 'Capital One',
  'com.key.android': 'KeyBank',
  'com.regions.mobbanking': 'Regions',
  'com.huntington.m': 'Huntington',
  'com.ally.MobileBanking': 'Ally',
  // Credit Cards
  'com.americanexpress.android.acctsvcs.us': 'Amex',
  'com.capitalone.creditcard.app': 'Capital One CC',
  'com.discoverfinancial.mobile': 'Discover',
  'com.synchrony.banking': 'Synchrony',
  // Fintech
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
  // Credit Unions
  'com.navyfederal.android': 'Navy Federal',
  'com.penfed.mobile.banking': 'PenFed',
  'org.becu.mobile': 'BECU',
  // Investment
  'com.robinhood.android': 'Robinhood',
  'com.fidelity.android': 'Fidelity',
  'com.schwab.mobile': 'Schwab',
};

export interface CovaultNotificationPlugin {
  requestAccess(): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
  getInstalledApps(): Promise<{ apps: Array<{ packageName: string; name: string }> }>;
  saveMonitoredApps(options: { apps: any }): Promise<void>;
  getMonitoredApps(): Promise<{ apps: string[] }>;
}
