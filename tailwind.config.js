/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        dark: {
          50: '#0d1117',
          100: '#151d28',
          200: '#1c2736',
          300: '#2a3a52',
          400: '#4a5f7a',
          500: '#6b809c',
          600: '#8899b0',
          700: '#a8b5c8',
          800: '#c8d3e0',
          900: '#e2e8f0',
          950: '#f0f4f8',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
