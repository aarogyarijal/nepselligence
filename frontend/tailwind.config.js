/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // hover: styles only where a real hover exists, so they don't stick after a tap
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        up: '#16a34a',
        down: '#dc2626',
        flat: '#6b7280',
      },
      screens: {
        // touch:… applies on finger-driven devices (tablets), whatever their width
        touch: { raw: '(pointer: coarse)' },
      },
    },
  },
  plugins: [],
}
