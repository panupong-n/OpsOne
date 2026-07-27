import { createContext, useContext, useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'light', toggleTheme: () => {} });

export function ThemeProvider({ children, userKey }: { children: React.ReactNode; userKey?: string }) {
    const key = userKey ? `opsone_theme_${userKey}` : 'opsone_theme';

    const [theme, setTheme] = useState<Theme>(() => {
        try {
            const v = localStorage.getItem(key);
            return v === 'dark' ? 'dark' : 'light';
        } catch { return 'light'; }
    });

    // Re-read when user changes (login / switch account)
    useEffect(() => {
        try {
            const v = localStorage.getItem(key);
            if (v === 'dark' || v === 'light') setTheme(v);
            else setTheme('light');
        } catch {}
    }, [key]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        try { localStorage.setItem(key, theme); } catch {}
    }, [theme, key]);

    const toggleTheme = useCallback(() => setTheme(prev => prev === 'light' ? 'dark' : 'light'), []);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
