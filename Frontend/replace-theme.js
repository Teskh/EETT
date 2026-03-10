const fs = require('fs');
const path = require('path');

const mappings = [
  { from: /(?<!dark:)\btext-white\b/g, to: 'text-zinc-900 dark:text-white' },
  { from: /(?<!dark:)\btext-zinc-200\b/g, to: 'text-zinc-900 dark:text-zinc-200' },
  { from: /(?<!dark:)\btext-zinc-300\b/g, to: 'text-zinc-800 dark:text-zinc-300' },
  { from: /(?<!dark:)\btext-zinc-400\b/g, to: 'text-zinc-600 dark:text-zinc-400' },
  { from: /(?<!dark:)\bbg-white\/5\b/g, to: 'bg-black/5 dark:bg-white/5' },
  { from: /(?<!dark:)\bbg-white\/10\b/g, to: 'bg-black/10 dark:bg-white/10' },
  { from: /(?<!dark:)\bbg-white\/20\b/g, to: 'bg-black/20 dark:bg-white/20' },
  { from: /(?<!dark:)\bbg-black\/20\b/g, to: 'bg-black/5 dark:bg-black/20' },
  { from: /(?<!dark:)\bbg-black\/40\b/g, to: 'bg-black/10 dark:bg-black/40' },
  { from: /(?<!dark:)\bbg-black\/60\b/g, to: 'bg-black/10 dark:bg-black/60' },
  { from: /(?<!dark:)\bborder-white\/5\b/g, to: 'border-black/5 dark:border-white/5' },
  { from: /(?<!dark:)\bborder-white\/10\b/g, to: 'border-black/10 dark:border-white/10' },
  { from: /(?<!dark:)\bborder-white\/20\b/g, to: 'border-black/20 dark:border-white/20' },
  { from: /(?<!dark:)\bbg-zinc-900\/50\b/g, to: 'bg-zinc-100/50 dark:bg-zinc-900/50' },
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
      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
