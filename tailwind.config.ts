import type { Config } from 'tailwindcss';

/**
 * Design tokens for the editor. Dark, low-chroma surfaces so footage is the
 * brightest thing on screen; one accent used sparingly for state and action.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#08090c', // app background / canvas letterbox
          1: '#0e1015', // panels
          2: '#14171d', // raised surfaces, toolbars
          3: '#1b1f27', // hover / inputs
        },
        line: {
          DEFAULT: '#232833',
          strong: '#2f3542',
        },
        ink: {
          0: '#f4f6fa',
          1: '#b3bcca',
          2: '#7c8798',
          3: '#535d6d',
        },
        accent: {
          DEFAULT: '#7c5cff',
          soft: '#8f74ff',
          dim: '#4a3aa8',
          ghost: 'rgba(124,92,255,0.14)',
        },
        ok: '#34d399',
        warn: '#f5b544',
        danger: '#f4645f',
        track: {
          video: '#5b8cff',
          broll: '#7c5cff',
          overlay: '#c084fc',
          text: '#f5b544',
          caption: '#34d399',
          audio: '#22b8cf',
          music: '#2dd4bf',
          voice: '#f472b6',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', '14px'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 40px -12px rgba(0,0,0,0.8)',
        pop: '0 24px 60px -20px rgba(0,0,0,0.85)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-up': 'slide-up 160ms cubic-bezier(0.2,0.8,0.2,1)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
