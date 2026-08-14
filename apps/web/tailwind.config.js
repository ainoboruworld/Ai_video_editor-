/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#0d0e10',
          1: '#111214',
          2: '#161719',
          3: '#1a1b1e',
          4: '#202126',
        },
        line: '#2a2b2f',
        ink: {
          1: '#e8e9ec',
          2: '#a7a9b0',
          3: '#6d6f78',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#7c7ff5',
          dim: '#4f51c4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['11px', '15px'],
        sm: ['12px', '17px'],
        base: ['13px', '19px'],
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
      },
    },
  },
  plugins: [],
};
