import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

export default {
  plugins: {
    // Use default configuration - settings are defined in styles.css @theme block
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
