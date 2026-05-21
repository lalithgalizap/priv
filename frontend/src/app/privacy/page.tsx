import Link from "next/link";

export default function PrivacyPage() {
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
        <h1 className="font-sans text-4xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="font-mono text-xs text-[#8e90a0] mb-12">Last updated: May 2025</p>

        <div className="space-y-8 text-[#c4c5d7] text-sm leading-relaxed">
          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">1. Data Collection</h2>
            <p>Quintal AI collects only the minimum data necessary to provide our services. This includes your email address for authentication, organization membership data, and usage metrics (token counts, not content).</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">2. Data Encryption</h2>
            <p>All user-generated content (prompts, AI responses, system prompts) is encrypted at rest using AES-256-GCM with per-user key derivation. Even in the event of a database breach, your content cannot be read without your unique encryption key.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">3. No Data Selling</h2>
            <p>We do not sell, share, or provide your data to third parties for advertising or marketing purposes. Your prompts and AI responses are never used to train models.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">4. AI Provider Data Handling</h2>
            <p>Prompts are forwarded to upstream AI providers for processing. Providers do not store or use your prompts for model training. Responses are encrypted before storage in our database.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">5. Data Retention</h2>
            <p>Chat history is retained as long as your account is active. You may delete individual sessions at any time. Upon account deletion, all associated data is permanently removed within 30 days.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">6. Organization Data Isolation</h2>
            <p>Each organization&apos;s data is logically isolated. Members of one organization cannot access another organization&apos;s data, usage metrics, or member information.</p>
          </section>

          <section>
            <h2 className="font-sans text-xl font-bold text-white mb-3">7. Contact</h2>
            <p>For privacy-related inquiries, contact us through the in-app support form.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
