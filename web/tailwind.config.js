/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0d1117',
          raised: '#161b22',
          overlay: '#1c2128',
        },
        border: {
          DEFAULT: '#30363d',
          muted: '#21262d',
        },
        text: {
          primary: '#e1e4e8',
          secondary: '#8b949e',
          muted: '#484f58',
        },
        accent: {
          DEFAULT: '#1f6feb',
          hover: '#388bfd',
          muted: 'rgba(31,111,235,0.1)',
        },
        success: '#52c41a',
        warning: '#faad14',
        error: '#f85149',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
