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
      
      // Fix bad hovers caused by regex
      content = content.replace(/hover:bg-white\/40 dark:bg-white\/5/g, 'hover:bg-white/40 dark:hover:bg-white/5');
      content = content.replace(/hover:bg-white\/60 dark:bg-white\/10/g, 'hover:bg-white/60 dark:hover:bg-white/10');
      content = content.replace(/hover:bg-white\/80 dark:bg-white\/10/g, 'hover:bg-white/80 dark:hover:bg-white/10');
      content = content.replace(/hover:bg-white\/80 dark:bg-white\/5/g, 'hover:bg-white/80 dark:hover:bg-white/5');
      
      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
