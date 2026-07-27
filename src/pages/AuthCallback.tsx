import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ThreeBackground from '../components/ThreeBackground';

export default function AuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { handleCallback } = useAuth();

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');

        if (error) {
            setErrorMessage(`TENCYBER returned error: ${error} — ${searchParams.get('error_description') || ''}`);
            setStatus('error');
            return;
        }

        if (!code || !state) {
            setErrorMessage('ไม่พบ authorization code จาก TENCYBER');
            setStatus('error');
            return;
        }

        handleCallback(code, state)
            .then(() => {
                setStatus('success');
                setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
            })
            .catch((err: unknown) => {
                setErrorMessage(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ SSO');
                setStatus('error');
            });
    }, []); // Run once on mount

    return (
        <div className="min-h-screen flex items-center justify-center relative px-4 overflow-hidden">
            <ThreeBackground />

            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="neo-flat w-full max-w-sm p-10 relative z-10 flex flex-col items-center gap-6 text-center"
            >
                {status === 'loading' && (
                    <>
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                        >
                            <Loader2 className="w-12 h-12 text-[var(--color-neo-accent)]" />
                        </motion.div>
                        <div>
                            <h2 className="text-xl font-bold text-[var(--color-neo-text-primary)] mb-1">กำลังยืนยันตัวตน</h2>
                            <p className="text-sm text-[var(--color-neo-text-secondary)]">กรุณารอสักครู่...</p>
                        </div>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        >
                            <CheckCircle className="w-14 h-14 text-green-500" />
                        </motion.div>
                        <div>
                            <h2 className="text-xl font-bold text-[var(--color-neo-text-primary)] mb-1">เข้าสู่ระบบสำเร็จ!</h2>
                            <p className="text-sm text-[var(--color-neo-text-secondary)]">กำลังนำคุณไปยัง Dashboard...</p>
                        </div>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        >
                            <AlertCircle className="w-14 h-14 text-red-500" />
                        </motion.div>
                        <div>
                            <h2 className="text-xl font-bold text-[var(--color-neo-text-primary)] mb-2">เกิดข้อผิดพลาด</h2>
                            <p className="text-sm text-red-500 font-mono bg-red-50 rounded-lg p-3 text-left leading-relaxed">
                                {errorMessage}
                            </p>
                        </div>
                        <button
                            onClick={() => navigate('/login')}
                            className="neo-button px-6 py-2.5 font-bold text-sm text-[var(--color-neo-text-primary)]"
                        >
                            กลับหน้า Login
                        </button>
                    </>
                )}
            </motion.div>
        </div>
    );
}
