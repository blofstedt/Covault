import React from 'react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">Last updated: September 7, 2026</p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
            <p>
              Welcome to Covault ("we", "our", or "us"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains what information we collect, how we use it, and what rights you have in relation to it.
            </p>
            <p className="mt-2">
              Covault reads the notifications your banking apps post to your phone in order to record your spending for you. That is the most sensitive thing this app does, so it is described in full in section 3 rather than buried in a list.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
            <p className="mb-2">We may collect the following types of information when you use our application:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Account Information:</strong> When you sign up, we collect your name, email address, and authentication credentials via third-party providers (e.g., Google).</li>
              <li><strong>Financial Data:</strong> Budget categories, limits, your stated monthly income, transaction amounts, shop names, dates and related financial information — whether you typed them in or Covault captured them from an alert.</li>
              <li><strong>Alert Content:</strong> Where a purchase was captured from a notification, the text of that notification is stored alongside the transaction so you can check what Covault read. You can see it on the Review page, and deleting the transaction deletes it.</li>
              <li><strong>Capture Settings:</strong> Which apps you have chosen to let Covault read, and the time each of those apps last sent something. This is what lets the app warn you when a bank has gone quiet.</li>
              <li><strong>Usage Data:</strong> We may collect information about how you interact with the app, including device type, browser type, and general usage patterns.</li>
              <li><strong>Device Information:</strong> If you use our mobile app, we may collect device identifiers and push notification tokens for delivering notifications.</li>
            </ul>
            <p className="mt-2">
              Covault never asks for, and cannot see, your online banking credentials. It has no connection to your bank, no access to your accounts, and cannot move money.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. How Covault Reads Your Bank Alerts</h2>
            <p className="mb-2">
              On Android, Covault can use the system's notification access permission. This is a permission you grant yourself, in Android's own settings, and you can withdraw it at any time in the same place. Here is exactly what it is used for:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Only the apps you pick.</strong> Covault reads notifications from the banking and email apps on your own list. A notification from any other app is ignored without being examined.</li>
              <li><strong>Only spending.</strong> The alert is checked for a purchase. Deposits, pay, transfers in, declined cards, balance and statement reminders and promotional messages are all rejected, and nothing is recorded for them.</li>
              <li><strong>Read on your phone.</strong> The reading is done on the device, by pattern matching and by a small AI model that runs locally. Notification text is not sent anywhere to be read.</li>
              <li><strong>What leaves your phone.</strong> When a purchase is found, the resulting transaction — amount, shop, date, category, and the alert text it came from — is saved to your Covault account so it is there on your other devices and for anyone sharing your vault. Alerts that are not purchases produce nothing and are not stored or transmitted.</li>
              <li><strong>Hiding your bank's own alerts.</strong> If you turn that option on, Covault dismisses a bank notification from your tray after it has recorded the purchase. It is removed from your phone's notification tray only; nothing is deleted at your bank, and your bank is not contacted.</li>
              <li><strong>Email.</strong> If you let Covault read a mail app, only messages from senders it recognises as banks are examined. Everything else is ignored unread, and Covault never hides, moves, marks, or replies to your mail.</li>
            </ul>
            <p className="mt-2">
              Turning capture off, or removing an app from your list, stops all of this immediately for that app.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>To provide, maintain, and improve the Covault budgeting service.</li>
              <li>To authenticate your identity and manage your account.</li>
              <li>To send you notifications related to your budgets and transactions (if enabled).</li>
              <li>To generate insights and reports about your spending.</li>
              <li>To respond to your requests or questions.</li>
            </ul>
            <p className="mt-2">
              We do not use your financial data or your alert content for advertising, and we do not sell it. It is not used to train any AI model — the model Covault uses is a fixed, pre-existing one that runs on your phone and learns nothing from you.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Data Storage and Security</h2>
            <p>
              Your data is stored using Supabase, a secure cloud database platform. We use industry-standard security measures, including encryption in transit and at rest, and database rules that mean your rows can only be read by your own account and by a partner you have linked. However, no method of electronic transmission or storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. What Stays on Your Phone</h2>
            <p className="mb-2">Some things are deliberately kept on the device and never sent to us:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>The AI model used to read alerts, once downloaded, and everything it reads.</li>
              <li>Notifications from apps that are not on your list — these are never examined at all.</li>
              <li>Your theme, and small local preferences such as whether you have seen the walkthrough.</li>
              <li>The figures drawn on the home-screen widget, which are rendered on the phone from data already on it.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Sharing a Vault</h2>
            <p>
              If you link with a partner, the two of you share one budget. Each of you can see the other's transactions in that vault — shop, amount, date and category — along with each other's budget limits and stated income. Linking requires both people to act, and either of you can unlink at any time, which stops any further sharing from that moment. Transactions already recorded in the shared vault remain in it.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Third-Party Services</h2>
            <p className="mb-2">We use the following third-party services to operate the app:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Google (Authentication):</strong> For sign-in via OAuth.</li>
              <li><strong>Supabase:</strong> For data storage and authentication.</li>
              <li><strong>Hugging Face and jsDelivr:</strong> Covault reads your bank alerts using a small AI model that runs on your own phone. These two services host the model file and the code that runs it, which your phone downloads once and then keeps. <strong>No transaction, notification, or other personal information is ever sent to them</strong> — the reading happens entirely on your device.</li>
              <li><strong>GitHub:</strong> To check whether a newer version of the app is available, and to download it.</li>
            </ul>
            <p className="mt-2">
              These services have their own privacy policies, and we encourage you to review them.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">9. Data Sharing</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties. We may share data only in the following circumstances:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>With your consent or at your direction (e.g., linking a partner account, or turning on shared rules — see below).</li>
              <li>To comply with legal obligations or respond to lawful requests.</li>
              <li>To protect our rights, privacy, safety, or property.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Shared Rules</h2>
            <p className="mb-2">
              Covault can suggest a category for a shop based on what other households have chosen for the same shop. Receiving those suggestions sends nothing about you: the list is downloaded to your phone and matched there, so we are never told where or when you have shopped.
            </p>
            <p className="mb-2">
              Contributing to that list is <strong>off unless you turn it on</strong>, in Settings. If you do turn it on, what is sent is the name of the shop and the category you filed it under — nothing else. We do not send amounts, dates, your bank, your own wording, or anything about how often you shop anywhere. What you send cannot be read by other users; only the combined result is published, and a shop appears in it only once several separate households have independently agreed on it, so a shop only you go to is never passed on.
            </p>
            <p>
              Turning the setting off again removes everything you have already contributed. A suggestion from the shared list never files a purchase on its own — you accept it once in the app, and only then does it become a rule of yours.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">11. Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction or deletion of your personal data.</li>
              <li>Withdraw consent for data processing at any time.</li>
              <li>Request a copy of your data in a portable format.</li>
            </ul>
            <p className="mt-2">
              You can act on most of these inside the app already: any transaction can be edited or deleted, Settings exports your full transaction history as a CSV file, capture can be switched off, and shared rules can be withdrawn.
            </p>
            <p className="mt-2">
              <strong>Deleting your account.</strong> To have your account and everything in it erased, email us at the address below from the address you signed up with. We will delete it, and confirm, within 30 days. Deleting the app from your phone does not delete your account.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">12. Data Retention</h2>
            <p>
              We keep your data for as long as your account exists, because a budgeting app that forgot last year would not be much use. Anything you delete in the app is removed from our database. When an account is deleted, its transactions, budgets, settings, capture history and shared-rule contributions are removed with it; backups taken before the deletion are cycled out on their own schedule, within 30 days.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">13. Cookies and Local Storage</h2>
            <p>
              We use browser local storage to save your preferences (such as theme settings). We do not use tracking cookies for advertising purposes.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">14. Children's Privacy</h2>
            <p>
              Covault is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">15. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date above.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">16. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, or want your account deleted, please contact us at{' '}
              <a href="mailto:mostlydecentdev@gmail.com" className="text-emerald-600 dark:text-emerald-400 underline">
                mostlydecentdev@gmail.com
              </a>.
            </p>
          </div>
        </section>

        <div className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
          <a href="/" className="text-emerald-600 dark:text-emerald-400 underline">← Back to Covault</a>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
