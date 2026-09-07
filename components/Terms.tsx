import React from 'react';

const Terms: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">Last updated: September 7, 2026</p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Covault ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use the Service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. Description of Service</h2>
            <p>
              Covault is a personal budgeting application that allows users to track income, expenses, and budget categories. The Service may include features such as automatic capture of purchases from your phone's banking notifications, AI-powered transaction parsing that runs on your device, partner account linking, notifications, and financial reporting.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. Automatic Capture Is Not a Bank Feed</h2>
            <p className="mb-2">
              Covault records purchases by reading the alerts your banking apps post to your phone. It is not connected to your bank, and it is not an authoritative record of your accounts. In particular:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>If your bank does not send an alert for a purchase, or you have its alerts switched off, Covault will not know about that purchase.</li>
              <li>Alerts vary in wording between banks and change over time. Covault may read an amount or a shop name incorrectly, or miss a purchase entirely.</li>
              <li>Some charges — a pending fuel hold, for example — are announced at an amount that is not what you are finally charged.</li>
              <li>Captured purchases are shown to you for review precisely because they may be wrong. You are responsible for checking them.</li>
            </ul>
            <p className="mt-2">
              Your bank's own statements are the record of your money. Covault is a tool for planning, not a source of truth about your accounts.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Notification Access</h2>
            <p>
              Where you grant it, Covault uses Android's notification access permission solely to detect your own spending, only from the apps you have selected, and only as described in our{' '}
              <a href="/privacy" className="text-emerald-600 dark:text-emerald-400 underline">Privacy Policy</a>. You may withdraw that permission at any time in Android's settings, and you may turn capture off inside the app. Doing so stops the reading immediately and does not affect anything already recorded.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. User Accounts</h2>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>You must provide accurate and complete information when creating an account.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>You must notify us immediately of any unauthorized use of your account.</li>
              <li>You may delete your account at any time by contacting us; see the Privacy Policy for what that removes and how long it takes.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Shared Vaults</h2>
            <p>
              Linking with a partner lets both of you see and change the transactions, budgets and limits in the shared vault. Only link with someone you intend to share your spending with. Either person may unlink at any time; unlinking stops further sharing but does not remove transactions already recorded in the vault.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Price and Subscriptions</h2>
            <p className="mb-2">
              Covault is currently provided free of charge while it is in testing. We may introduce paid plans in future. If we do:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>We will tell you before any charge is made, and you will have to agree to it. Nothing you are using today will start billing you silently.</li>
              <li>Any free trial will be described plainly, including its length and what happens when it ends.</li>
              <li>Subscriptions purchased through an app store are billed, renewed, and refunded under that store's own terms, and can be cancelled there.</li>
              <li>Cancelling stops future renewals. Access continues to the end of the period already paid for.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Acceptable Use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
              <li>Attempt to gain unauthorized access to the Service or its systems.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service.</li>
              <li>Upload or transmit viruses, malware, or other harmful code.</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service.</li>
              <li>Use the Service to harass, abuse, or harm others.</li>
              <li>Use the Service to read, collect, or record notifications belonging to anyone but yourself.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">9. Financial Information Disclaimer</h2>
            <p>
              Covault is a budgeting tool provided for informational and organizational purposes only. The Service does not constitute financial, investment, tax, or legal advice. You should consult with qualified professionals regarding your financial decisions. We are not responsible for any financial decisions you make based on the information provided by the Service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Intellectual Property</h2>
            <p>
              All content, features, and functionality of the Service, including but not limited to text, graphics, logos, and software, are the property of Covault and are protected by copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written consent.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">11. User Data</h2>
            <p>
              You retain ownership of all data you input into the Service. By using the Service, you grant us a limited license to store, process, and display your data solely for the purpose of providing and improving the Service. Please refer to our{' '}
              <a href="/privacy" className="text-emerald-600 dark:text-emerald-400 underline">Privacy Policy</a>{' '}
              for more details on how we handle your data.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">12. Service Availability</h2>
            <p>
              We strive to keep the Service available at all times, but we do not guarantee uninterrupted or error-free operation. We may modify, suspend, or discontinue any part of the Service at any time without prior notice. We are not liable for any downtime or service interruptions.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">13. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, Covault and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, profits, or goodwill, arising out of or related to your use of the Service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">14. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">15. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your account at our sole discretion, without notice, for conduct that we determine violates these Terms or is harmful to the Service, other users, or third parties. Upon termination, your right to use the Service will immediately cease.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">16. Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you of any changes by posting the updated Terms on this page and updating the "Last updated" date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">17. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">18. Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at{' '}
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

export default Terms;
