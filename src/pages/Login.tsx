import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, LogIn, AlertCircle } from 'lucide-react';
import ThreeBackground from '../components/ThreeBackground';
import { redirectToTencyberLogin } from '../lib/auth';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const navigate = useNavigate();
    const { isAuthenticated, isLoading: authLoading } = useAuth();

    // ✅ Navigate inside useEffect — React requires this
    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            navigate('/dashboard', { replace: true });
        }
    }, [isAuthenticated, authLoading, navigate]);

    const handleLogin = async () => {
        setIsLoading(true);
        setErrorMsg('');
        try {
            // TENCYBER now handles session termination via end_session_endpoint.
            // Just initiate a normal PKCE login — if user was logged out via
            // endsession, TENCYBER will prompt for credentials automatically.
            await redirectToTencyberLogin();
        } catch (err) {
            console.error('[Login] redirect error:', err);
            setErrorMsg(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเริ่มต้น SSO กรุณาลองใหม่อีกครั้ง');
            setIsLoading(false);
        }
    };

    // Show nothing while AuthContext is checking session (prevents flash of login page)
    if (authLoading) return null;

    return (
        <div className="min-h-screen flex items-center justify-center relative px-4 overflow-hidden">
            <ThreeBackground />

            {/* Radial glow behind card */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div style={{
                    width: '480px', height: '480px', borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(37, 99, 235,0.12) 0%, transparent 70%)',
                    filter: 'blur(40px)',
                }} />
            </div>

            <motion.div
                className="w-full max-w-sm relative z-10"
                initial={{ opacity: 0, scale: 0.92, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            >
                <div className="neo-flat p-10 flex flex-col items-center" style={{ borderRadius: '24px' }}>

                    {/* Logo */}
                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.18 }}
                        className="w-28 h-auto mb-7"
                    >
                        <img src="/TENIX-LOGO.png" alt="OpsOne" className="w-full h-full object-contain" />
                    </motion.div>

                    {/* Title */}
                    <motion.h1
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.26 }}
                        className="text-xl font-black text-[var(--color-neo-text-primary)] text-center tracking-tight leading-tight"
                    >
                        OPERATIONS ONE
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.32 }}
                        className="text-xs font-bold tracking-[0.18em] uppercase mt-1 text-center"
                        style={{ color: 'var(--color-neo-accent)' }}
                    >
                        PLATFORM
                    </motion.p>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.38 }}
                        className="text-[13px] text-[var(--color-neo-text-secondary)] mt-3 font-medium text-center"
                    >
                        ระบบจัดการสำหรับทีมวิศวกร
                    </motion.p>

                    <div className="w-full my-7" style={{ borderTop: '1px solid var(--color-neo-text-secondary)', opacity: 0.1 }} />

                    {/* Error message */}
                    {errorMsg && (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full flex items-start gap-3 mb-5 rounded-2xl p-4"
                            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
                        >
                            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-600 font-medium leading-relaxed">{errorMsg}</p>
                        </motion.div>
                    )}

                    {/* Login Button */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.44 }}
                        className="w-full"
                    >
                        <button
                            type="button"
                            onClick={handleLogin}
                            disabled={isLoading}
                            className="w-full py-3.5 font-bold text-white flex items-center justify-center gap-2.5 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 rounded-2xl"
                            style={{
                                background: isLoading
                                    ? 'var(--color-neo-accent)'
                                    : 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                                boxShadow: isLoading ? 'none' : '0 6px 24px rgba(37, 99, 235,0.35)',
                            }}
                        >
                            {isLoading ? (
                                <>
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                                        className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                                    />
                                    <span>กำลังเชื่อมต่อ TENCYBER...</span>
                                </>
                            ) : (
                                <>
                                    <ShieldCheck className="w-4 h-4" />
                                    <LogIn className="w-4 h-4" />
                                    <span>เข้าสู่ระบบ (Login)</span>
                                </>
                            )}
                        </button>
                    </motion.div>

                    {/* Secured badge */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        className="mt-7"
                    >
                        <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-semibold text-[var(--color-neo-text-secondary)] neo-convex">
                            <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--color-neo-accent)' }} />
                            Secured by TENCYBER SSO
                        </div>
                    </motion.div>

                </div>
            </motion.div>
        </div>
    );
}
