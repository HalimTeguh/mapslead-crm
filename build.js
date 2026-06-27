// Runs at Vercel build time — generates config.js from environment variable
const fs = require('fs');
const key = process.env.MAPS_API_KEY || '';
if (!key) {
  console.warn('WARNING: MAPS_API_KEY environment variable is not set.');
}
fs.writeFileSync('config.js', `window.VARADATA_CONFIG={mapsApiKey:'${key}'};`);
console.log('config.js generated.');
