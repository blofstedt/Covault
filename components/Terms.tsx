import React from 'react';

const Terms: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">Last updated: February 10, 2026</p>

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
              Covault is a personal budgeting application that allows users to track income, expenses, and budget categories. The Service may include features such as AI-powered transaction parsing, partner account linking, notifications, and financial reporting.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. User Accounts</h2>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>You must provide accurate and complete information when creating an account.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>You must notify us immediately of any unauthorized use of your account.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Acceptable Use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
              <li>Attempt to gain unauthorized access to the Service or its systems.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service.</li>
              <li>Upload or transmit viruses, malware, or other harmful code.</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service.</li>
              <li>Use the Service to harass, abuse, or harm others.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Financial Information Disclaimer</h2>
            <p>
              Covault is a budgeting tool provided for informational and organizational purposes only. The Service does not constitute financial, investment, tax, or legal advice. You should consult with qualified professionals regarding your financial decisions. We are not responsible for any financial decisions you make based on the information provided by the Service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Intellectual Property</h2>
            <p>
              All content, features, and functionality of the Service, including but not limited to text, graphics, logos, and software, are the property of Covault and are protected by copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written consent.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. User Data</h2>
            <p>
              You retain ownership of all data you input into the Service. By using the Service, you grant us a limited license to store, process, and display your data solely for the purpose of providing and improving the Service. Please refer to our{' '}
              <a href="/privacy" className="text-emerald-600 dark:text-emerald-400 underline">Privacy Policy</a>{' '}
              for more details on how we handle your data.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Service Availability</h2>
            <p>
              We strive to keep the Service available at all times, but we do not guarantee uninterrupted or error-free operation. We may modify, suspend, or discontinue any part of the Service at any time without prior notice. We are not liable for any downtime or service interruptions.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">9. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, Covault and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, profits, or goodwill, arising out of or related to your use of the Service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Disclaimer of Warranties</h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">11. Termination</h2>
            <p>
              We reserve the right to suspend or terminate your account at our sole discretion, without notice, for conduct that we determine violates these Terms or is harmful to the Service, other users, or third parties. Upon termination, your right to use the Service will immediately cease.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">12. Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you of any changes by posting the updated Terms on this page and updating the "Last updated" date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">13. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">14. Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at{' '}
              <a href="mailto:support@covaultbudgeting.vercel.app" className="text-emerald-600 dark:text-emerald-400 underline">
                support@covaultbudgeting.vercel.app
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
