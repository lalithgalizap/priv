import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="min-h-screen text-[#e1e2eb]" style={{ background: "#0b0e14" }}>
      <nav className="fixed top-0 w-full z-50 backdrop-blur-xl border-b border-white/5 px-8 py-4" style={{ background: "rgba(16,19,26,0.7)" }}>
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="Quintal AI" className="h-7 w-7 object-contain" />
            <span className="font-sans text-lg font-bold text-white">Quintal AI</span>
          </Link>
          <Link href="/login" className="font-mono text-xs text-[#b8c3ff] hover:text-white transition-colors">Sign In</Link>
        </div>
      </nav>

      <main className="pt-28 pb-20 px-8 max-w-4xl mx-auto">
        <h1 className="font-sans text-4xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="font-mono text-xs text-[#8e90a0] mb-12">Last updated: May 2025</p>

        <div className="space-y-8 text-[#c4c5d7] text-sm leading-relaxed">
          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using Quintal AI, you agree to be bound by these Terms of Service. If you are using the service on behalf of an organization, you represent that you have authority to bind that organization.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">2. Service Description</h2>
            <p>Quintal AI provides an enterprise AI mediation platform that routes prompts to AI models on our behalf. The service includes credit-based usage management, team collaboration features, and encrypted data storage.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">3. Account Responsibilities</h2>
            <p>You are responsible for maintaining the security of your account credentials. Organization leaders are responsible for managing member access and credit allocation within their organization.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">4. Acceptable Use</h2>
            <p>You agree not to use the service to generate content that is illegal, harmful, or violates third-party rights. You may not attempt to circumvent usage limits, reverse-engineer the platform, or access other organizations&apos; data.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">5. Credits and Billing</h2>
            <p>Usage is measured in credits. Each organization receives a daily allocation per member. Additional credits may be purchased by organization leaders. Credits are non-refundable and non-transferable between organizations.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">6. Service Availability</h2>
            <p>We strive for high availability but do not guarantee uninterrupted service. Scheduled maintenance will be communicated in advance. We are not liable for downtime caused by third-party providers (AWS, Supabase).</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">7. Intellectual Property</h2>
            <p>You retain ownership of all content you submit. AI-generated responses are provided for your use without restriction. The Quintal AI platform, branding, and underlying technology remain our intellectual property.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">8. Termination</h2>
            <p>Either party may terminate the agreement at any time. Upon termination, your data will be retained for 30 days before permanent deletion. We reserve the right to suspend accounts that violate these terms.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">9. Contact</h2>
            <p>For questions about these terms, contact us through the in-app support form.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
