import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

type Theme = 'dark' | 'light';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useLocalStorage<Theme>('llm-proxy:theme', 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return [theme, toggleTheme];
}
