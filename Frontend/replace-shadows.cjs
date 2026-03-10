const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;
      
      // Remove shadows and glows
      content = content.replace(/\bshadow-\[[^\]]+\]/g, '');
      content = content.replace(/\bdark:shadow-\[[^\]]+\]/g, '');
      content = content.replace(/\bshadow-2xl\b/g, '');
      content = content.replace(/\bshadow-lg\b/g, '');
      content = content.replace(/<div className="absolute top-0 right-0[^"]+blur-3xl[^"]+"\s*\/>/g, '');
      
      // Fix bad hover states
      content = content.replace(/hover:bg-red-200 dark:bg-red-500\/20/g, 'hover:bg-red-200 dark:hover:bg-red-500/20');
      
      // Cleanup extra spaces
      content = content.replace(/className="([^"]+)"/g, (match, p1) => `className="${p1.replace(/\s+/g, ' ').trim()}"`);
      
      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}
processDir(path.join(__dirname, 'src'));
