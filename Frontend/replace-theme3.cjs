const fs = require('fs');
const path = require('path');

const mappings = [
  // Fix nested backgrounds in light mode to get lighter (towards white) instead of darker (grey)
  { from: /\bbg-black\/5 dark:bg-black\/20\b/g, to: 'bg-white/60 dark:bg-black/20' },
  { from: /\bbg-black\/10 dark:bg-black\/40\b/g, to: 'bg-white dark:bg-black/40' },
  { from: /\bbg-black\/10 dark:bg-black\/60\b/g, to: 'bg-white dark:bg-black/60' },
  { from: /\bbg-black\/5 dark:bg-white\/5\b/g, to: 'bg-white/40 dark:bg-white/5' },
  { from: /\bbg-black\/10 dark:bg-white\/10\b/g, to: 'bg-white/60 dark:bg-white/10' },
  { from: /\bbg-zinc-100\/50 dark:bg-zinc-900\/50\b/g, to: 'bg-white dark:bg-zinc-900/50' },
  { from: /\bhover:bg-black\/10 dark:hover:bg-white\/10\b/g, to: 'hover:bg-white/80 dark:hover:bg-white/10' },
  { from: /\bhover:bg-black\/10 dark:bg-white\/10\b/g, to: 'hover:bg-white/80 dark:hover:bg-white/10' },
  { from: /\bbg-black\/30\b/g, to: 'bg-white/80 dark:bg-white/5' }, // specific case in attribute editor

  // Fix accent button contrast in light mode
  { from: /\btext-accent-400\b/g, to: 'text-accent-700 dark:text-accent-400' },
  { from: /\btext-accent-500\b/g, to: 'text-accent-600 dark:text-accent-500' },
  { from: /\btext-zinc-300\b/g, to: 'text-zinc-700 dark:text-zinc-300' }, // also some zincs
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
      
      // Fix double classes
      content = content.replace(/text-accent-700 dark:text-accent-700 dark:text-accent-400/g, 'text-accent-700 dark:text-accent-400');
      content = content.replace(/text-accent-600 dark:text-accent-600 dark:text-accent-500/g, 'text-accent-600 dark:text-accent-500');
      content = content.replace(/text-zinc-800 dark:text-zinc-700 dark:text-zinc-300/g, 'text-zinc-800 dark:text-zinc-300');

      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
