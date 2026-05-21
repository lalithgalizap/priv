import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen text-[#e1e2eb] selection:bg-[#b8c3ff]/30" style={{ background: "#0b0e14", backgroundImage: "radial-gradient(circle at 50% -20%, #2a3f95 0%, transparent 40%)" }}>
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 backdrop-blur-xl border-b border-white/5 px-4 sm:px-8 py-4" style={{ background: "rgba(16,19,26,0.7)" }}>
        <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <img src="/logo.png" alt="Quintal AI" className="h-8 w-8 object-contain" />
            <span className="font-sans text-base sm:text-xl font-bold text-white tracking-tight">Quintal AI</span>
          </div>
          <div className="hidden md:flex items-center gap-10">
            <a className="font-mono text-xs text-[#c4c5d7] hover:text-[#b8c3ff] transition-colors" href="#solutions">Solutions</a>
            <a className="font-mono text-xs text-[#c4c5d7] hover:text-[#b8c3ff] transition-colors" href="#privacy">Security</a>
            <a className="font-mono text-xs text-[#c4c5d7] hover:text-[#b8c3ff] transition-colors" href="#footer">Network</a>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#00FF94]/20" style={{ background: "rgba(16,19,26,0.7)" }}>
              <span className="flex h-2 w-2 rounded-full bg-[#00FF94] animate-pulse" />
              <span className="font-mono text-[10px] text-[#00FF94]">System Online</span>
            </div>
            <Link href="/login" className="bg-[#b8c3ff] hover:bg-[#6d88ff] text-[#002388] px-4 sm:px-6 py-2 rounded-lg font-sans font-semibold text-sm transition-all active:scale-95 whitespace-nowrap">
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 sm:pt-40 pb-16 sm:pb-20 px-4 sm:px-8 flex flex-col items-center text-center overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] max-w-full h-[400px] bg-[#b8c3ff]/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative z-10 max-w-4xl">
          <div className="mb-6 sm:mb-8 flex justify-center">
            <img src="/logo.png" alt="Quintal AI" className="w-32 h-32 sm:w-48 sm:h-48 md:w-56 md:h-56 object-contain drop-shadow-[0_0_30px_rgba(42,63,149,0.4)]" />
          </div>
          <h1 className="font-sans text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6 leading-tight bg-gradient-to-r from-[#b8c3ff] to-[#6d88ff] bg-clip-text text-transparent">
            Intelligence Delivered. Privately.
          </h1>
          <p className="text-base sm:text-lg text-[#c4c5d7] max-w-2xl mx-auto mb-8 sm:mb-12 px-2">
            The next evolution of enterprise intelligence. Seamlessly integrate multi-modal AI into your core infrastructure with absolute data privacy.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="#solutions" className="px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-sans font-bold text-base sm:text-lg text-white hover:bg-white/10 transition-all border border-white/20" style={{ background: "rgba(16,19,26,0.7)" }}>
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Solutions Grid */}
      <section id="solutions" className="px-4 sm:px-8 py-16 sm:py-20 max-w-7xl mx-auto">
        <div className="mb-8 sm:mb-12">
          <h2 className="font-sans text-2xl sm:text-3xl md:text-4xl font-bold mb-4 text-white">Cognitive Solutions</h2>
          <p className="text-[#c4c5d7] max-w-xl">Modular neural components designed for massive-scale enterprise deployment.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[
            { title: "Generative Models", desc: "Bespoke transformer architectures optimized for industry-specific semantic understanding." },
            { title: "Strategic Intel", desc: "Predictive modeling engine that identifies market volatility before it manifests." },
            { title: "Neural Networks", desc: "Self-healing network topologies that adapt to changing computational loads in real-time." },
            { title: "Deep Integration", desc: "Seamless API bridging for legacy systems with native AI-first data pipelines." },
          ].map((card) => (
            <div key={card.title} className="p-6 sm:p-8 rounded-2xl group hover:border-[#b8c3ff]/50 transition-all duration-500 hover:-translate-y-2" style={{ background: "rgba(16,19,26,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="mb-4 sm:mb-6 h-12 w-12 rounded-xl bg-[#b8c3ff]/10 flex items-center justify-center group-hover:bg-[#b8c3ff]/20 transition-colors">
                <div className="w-5 h-5 rounded-full bg-[#b8c3ff]/60" />
              </div>
              <h3 className="font-sans text-lg sm:text-xl font-bold mb-3 text-white">{card.title}</h3>
              <p className="text-[#c4c5d7] text-sm mb-6">{card.desc}</p>
              <div className="h-px w-full bg-gradient-to-r from-[#b8c3ff]/30 to-transparent" />
            </div>
          ))}
        </div>
      </section>

      {/* Privacy Section */}
      <section id="privacy" className="px-4 sm:px-8 py-16 sm:py-20 max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-center">
          <div className="lg:w-1/2">
            <div className="mb-4 font-mono text-xs text-[#b8c3ff] tracking-[0.2em] uppercase">Security Protocol</div>
            <h2 className="font-sans text-2xl sm:text-3xl md:text-4xl font-bold mb-6 sm:mb-8 text-white">Privacy by Architecture</h2>
            <div className="space-y-6">
              {[
                { title: "Zero Data Tracking", desc: "No persistent logs of queries. Your intelligence is yours alone." },
                { title: "Per-User Encryption", desc: "Every message encrypted with a unique key derived from your identity." },
                { title: "Encrypted at Rest", desc: "All data protected by AES-256-GCM encryption standards." },
              ].map((item) => (
                <div key={item.title} className="flex gap-4">
                  <span className="text-[#00FF94] mt-1 text-lg">✓</span>
                  <div>
                    <h4 className="font-sans font-bold text-white mb-1">{item.title}</h4>
                    <p className="text-[#c4c5d7] text-sm">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:w-1/2 w-full">
            <div className="relative rounded-3xl p-6 overflow-hidden" style={{ background: "rgba(16,19,26,0.7)", border: "1px solid rgba(184,195,255,0.2)", boxShadow: "0 0 15px rgba(184,195,255,0.1)" }}>
              <div className="font-mono text-xs space-y-3 text-[#c4c5d7]">
                <p className="flex items-center gap-3"><span className="text-[#b8c3ff]/50">&gt;</span><span>encrypt(user_data, derive_key(user_id))</span><span className="text-[#00FF94] ml-auto">OK</span></p>
                <p className="flex items-center gap-3"><span className="text-[#b8c3ff]/50">&gt;</span><span>verify_integrity(AES-256-GCM)</span><span className="text-[#00FF94] ml-auto">OK</span></p>
                <p className="flex items-center gap-3"><span className="text-[#b8c3ff]/50">&gt;</span><span>isolation_check(tenant_boundary)</span><span className="text-[#00FF94] ml-auto">OK</span></p>
                <p className="flex items-center gap-3"><span className="text-[#b8c3ff]/50">&gt;</span><span>status: ALL_SYSTEMS_SECURE</span></p>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <span className="font-mono text-xs text-white">Vault Status: LOCKED</span>
                <span className="font-mono text-xs text-[#b8c3ff]">AES-256 ACTIVE</span>
              </div>
              <div className="mt-2 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#b8c3ff] w-full animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="footer" className="border-t border-[#444655]/30 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-12 sm:py-16 pb-safe">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-10 sm:mb-12">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <img src="/logo.png" alt="Quintal AI" className="h-6 w-6 object-contain" />
                <span className="font-sans text-lg font-bold text-[#b8c3ff]">Quintal AI</span>
              </div>
              <p className="text-[#c4c5d7] text-sm max-w-sm">Building the foundations of sovereign enterprise intelligence.</p>
            </div>
          </div>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-t border-[#444655]/20 pt-6">
            <p className="font-mono text-[10px] text-[#8e90a0] uppercase tracking-widest text-center md:text-left">&copy; 2025 Quintal AI. Enterprise AI Platform.</p>
            <div className="flex gap-6 font-mono text-[10px] text-[#8e90a0] uppercase tracking-widest">
              <a className="hover:text-[#b8c3ff] transition-colors" href="/privacy">Privacy</a>
              <a className="hover:text-[#b8c3ff] transition-colors" href="/terms">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
