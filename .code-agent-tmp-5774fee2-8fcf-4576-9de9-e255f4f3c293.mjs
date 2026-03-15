
const fs = require('fs');
const path = require('path');

function findJsFiles(dir) {
  let jsFiles = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      jsFiles = jsFiles.concat(findJsFiles(filePath));
    } else if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.mjs')) {
      jsFiles.push(filePath);
    }
  }
  return jsFiles;
}

const jsFiles = findJsFiles('.');
console.log(jsFiles);
console.log('Total JavaScript files: ' + jsFiles.length);
