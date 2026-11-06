export function TermsDocument() {
  return (
    <div className="p-1 sm:p-4">
      <h1 id="terms-document-title" tabIndex={-1} className="mt-3 text-3xl font-bold tracking-[-0.025em] text-[#102b3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f6872]">
        Terms and Conditions
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#667b89]">
        Please read these terms before using LIVE.
      </p>

      <div className="mt-8 space-y-6 text-sm leading-7 text-[#425866]">
        <section>
          <h2 className="font-bold text-[#102b3f]">1. Use of LIVE</h2>
          <p className="mt-2">
            LIVE helps users share emergency information with authorised response teams. Provide accurate information and use the service responsibly.
          </p>
        </section>
        <section>
          <h2 className="font-bold text-[#102b3f]">2. Emergencies</h2>
          <p className="mt-2">
            LIVE is a support tool and does not replace official emergency numbers or guarantee that emergency services have been contacted. In an immediate emergency, contact the appropriate emergency services directly.
          </p>
        </section>
        <section>
          <h2 className="font-bold text-[#102b3f]">3. Account information</h2>
          <p className="mt-2">
            Keep your account details secure and make sure your contact and emergency-contact information stays up to date.
          </p>
        </section>
        <section>
          <h2 className="font-bold text-[#102b3f]">4. Acceptance</h2>
          <p className="mt-2">
            After signing in, you must review and accept these terms before continuing to use LIVE.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-[#102b3f]">5. Your responsibilities</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use your own account and keep your password private.</li>
            <li>Only submit information that is accurate and relevant to the request.</li>
            <li>Do not misuse, disrupt, or attempt to gain unauthorised access to LIVE.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-bold text-[#102b3f]">6. Contact and medical information</h2>
          <p className="mt-2">
            LIVE uses the contact, emergency-contact, location, and optional medical information you provide to support an emergency request and share relevant details with authorised response teams. Keep this information accurate and provide only what is necessary.
          </p>
        </section>
      </div>
    </div>
  );
}
