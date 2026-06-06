import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center text-white">
      <div className="text-center">
        <p className="text-6xl font-bold text-white/10 mb-4">404</p>
        <h1 className="text-xl font-semibold text-white mb-2">Page not found</h1>
        <p className="text-sm text-white/30 mb-6">This route doesn't exist in the ORACLEX dashboard.</p>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors border border-white/[0.08] px-4 py-2 rounded-lg">
          <ArrowLeft size={13} /> Back to home
        </Link>
      </div>
    </div>
  );
}
