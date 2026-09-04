import React from 'react';

const PrivacyPolicy: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">Last updated: February 10, 2026</p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
            <p>
              Welcome to Covault ("we", "our", or "us"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains what information we collect, how we use it, and what rights you have in relation to it.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
            <p className="mb-2">We may collect the following types of information when you use our application:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Account Information:</strong> When you sign up, we collect your name, email address, and authentication credentials via third-party providers (e.g., Google).</li>
              <li><strong>Financial Data:</strong> Budget categories, transaction amounts, and related financial information you enter into the app. This data is stored securely and is used solely to provide the budgeting service.</li>
              <li><strong>Usage Data:</strong> We may collect information about how you interact with the app, including device type, browser type, and general usage patterns.</li>
              <li><strong>Device Information:</strong> If you use our mobile app, we may collect device identifiers and push notification tokens for delivering notifications.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>To provide, maintain, and improve the Covault budgeting service.</li>
              <li>To authenticate your identity and manage your account.</li>
              <li>To send you notifications related to your budgets and transactions (if enabled).</li>
              <li>To generate insights and reports about your spending.</li>
              <li>To respond to your requests or questions.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Data Storage and Security</h2>
            <p>
              Your data is stored using Supabase, a secure cloud database platform. We use industry-standard security measures, including encryption in transit and at rest, to protect your personal information. However, no method of electronic transmission or storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Third-Party Services</h2>
            <p className="mb-2">We use the following third-party services to operate the app:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Google (Authentication):</strong> For sign-in via OAuth.</li>
              <li><strong>Supabase:</strong> For data storage and authentication.</li>
              <li><strong>Hugging Face and jsDelivr:</strong> Covault reads your bank alerts using a small AI model that runs on your own phone. These two services host the model file and the code that runs it, which your phone downloads once. <strong>No transaction, notification, or other personal information is ever sent to them</strong> — the reading happens entirely on your device.</li>
              <li><strong>GitHub:</strong> To check whether a newer version of the app is available.</li>
            </ul>
            <p className="mt-2">
              These services have their own privacy policies, and we encourage you to review them.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Data Sharing</h2>
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
            <h2 className="text-lg font-semibold mb-2">7. Shared Rules</h2>
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
            <h2 className="text-lg font-semibold mb-2">8. Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction or deletion of your personal data.</li>
              <li>Withdraw consent for data processing at any time.</li>
              <li>Request a copy of your data in a portable format.</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, please contact us at the email address provided below.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">9. Cookies and Local Storage</h2>
            <p>
              We use browser local storage to save your preferences (such as theme settings). We do not use tracking cookies for advertising purposes.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Children's Privacy</h2>
            <p>
              Covault is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date above.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">12. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:support@covaultbudgeting.vercel.app" className="text-emerald-600 dark:text-emerald-400 underline">
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
