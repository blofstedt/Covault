import React from 'react';

// Static page at /delete — see index.tsx for the routing.
//
// Play Console's Data Safety form asks for a URL where a user can request
// account deletion without needing the app installed (the in-app button in
// DeleteAccountSection.tsx assumes they still have it). This is that URL. It
// has no backend of its own — same mailto: convention as
// lib/missedAlertReport.ts and the "Report a Problem" row in
// SupportFeedbackSection.tsx — because standing up a form-handling endpoint
// for a single low-volume request type is not worth the extra moving part.

const DELETE_REQUEST_SUBJECT = 'Covault: Delete My Account';

const DELETE_REQUEST_BODY = [
  'Please delete my Covault account and all data associated with it.',
  '',
  'The email address I signed up with:',
  '',
].join('\n');

const mailtoHref = `mailto:mostlydecentdev@gmail.com?subject=${encodeURIComponent(
  DELETE_REQUEST_SUBJECT
)}&body=${encodeURIComponent(DELETE_REQUEST_BODY)}`;

const DeleteAccountRequest: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Delete Your Account</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          Request that your Covault account and all of its data be deleted.
        </p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">Already have Covault installed?</h2>
            <p>
              The fastest way is in the app itself: open <strong>Settings</strong> and tap{' '}
              <strong>Delete Account</strong> at the bottom. That deletes your account and
              everything in it immediately — your name, email, every transaction, every budget,
              and every setting — with no need to wait on a reply here.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Don't have the app anymore?</h2>
            <p className="mb-4">
              Send us a deletion request by email from the address you signed up with, and we'll
              delete your account and confirm within 30 days. Deleting the app from your phone
              does not delete your account on its own — this is the way to do that without it.
            </p>
            <a
              href={mailtoHref}
              className="inline-block px-5 py-3 rounded-2xl bg-rose-500 text-white font-semibold text-sm active:scale-[0.97] transition-transform"
            >
              Request Account Deletion
            </a>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              This opens your email app with a message addressed to{' '}
              <a href="mailto:mostlydecentdev@gmail.com" className="underline">
                mostlydecentdev@gmail.com
              </a>
              . If it doesn't open automatically, email that address directly and tell us the
              address your account uses.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">What gets deleted</h2>
            <p>
              Your name, email, every transaction, every budget and category you've customized,
              your notification rules, and all account settings. If you share a vault with a
              partner, their account is unaffected — only the link between you is removed. There
              is no undo once a deletion is processed.
            </p>
          </div>
        </section>

        <div className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
          <a href="/" className="text-emerald-600 dark:text-emerald-400 underline">← Back to Covault</a>
          {' · '}
          <a href="/privacy" className="text-emerald-600 dark:text-emerald-400 underline">Privacy Policy</a>
        </div>
      </div>
    </div>
  );
};

export default DeleteAccountRequest;
