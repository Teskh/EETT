const fs = require('fs');
const path = require('path');

const mappings = [
  // Flatter UI / Remove highlights
  { from: /\bshadow-\[0_0_15px_rgba\([^\]]+\)\]\b/g, to: '' },
  { from: /\bshadow-\[0_0_8px_rgba\([^\]]+\)\]\b/g, to: '' },
  { from: /\bshadow-\[0_0_20px_rgba\([^\]]+\)\]\b/g, to: '' },
  { from: /\bdark:shadow-\[inset_[^\]]+\]\b/g, to: '' },
  { from: /\bshadow-\[inset_[^\]]+\]\b/g, to: '' },
  { from: /<div className="absolute top-0 right-0[^"]+blur-3xl[^"]+"\s*\/>/g, to: '' },
  
  // Fix red button/alert contrast for light mode
  { from: /(?<!dark:)\bbg-red-500\/10\b/g, to: 'bg-red-100 dark:bg-red-500/10' },
  { from: /(?<!dark:)\bborder-red-500\/20\b/g, to: 'border-red-200 dark:border-red-500/20' },
  { from: /(?<!dark:)\btext-red-400\b/g, to: 'text-red-700 dark:text-red-400' },
  { from: /(?<!dark:)\btext-red-300\b/g, to: 'text-red-700 dark:text-red-300' },
  { from: /(?<!dark:)\btext-red-200\b/g, to: 'text-red-800 dark:text-red-200' },
  { from: /(?<!dark:)\bbg-red-500\/20\b/g, to: 'bg-red-200 dark:bg-red-500/20' },
  { from: /(?<!dark:)\bbg-red-500\/30\b/g, to: 'bg-red-300 dark:bg-red-500/30' },
  { from: /(?<!dark:)\bhover:bg-red-500\/20\b/g, to: 'hover:bg-red-200 dark:hover:bg-red-500/20' },
  { from: /(?<!dark:)\bhover:bg-red-500\/30\b/g, to: 'hover:bg-red-300 dark:hover:bg-red-500/30' },
];

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;
      for (const map of mappings) {
        content = content.replace(map.from, map.to);
      }
      // Fix any multiple spaces left by removing classes
      content = content.replace(/className="([^"]+)"/g, (match, p1) => {
        const cleaned = p1.replace(/\s+/g, ' ').trim();
        return `className="${cleaned}"`;
      });
      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
