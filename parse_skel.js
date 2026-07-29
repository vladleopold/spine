const fs = require('fs');
const glob = require('glob');
const files = glob.sync('**/library/**/*.skel');
if (files.length > 0) {
  const buf = fs.readFileSync(files[0]);
  console.log("File:", files[0]);
  console.log(buf.slice(0, 64).toString('hex').match(/../g).join(' '));
  console.log(buf.slice(0, 64).toString('ascii').replace(/[^a-zA-Z0-9.\-]/g, '.'));
} else {
  console.log("No skel files found.");
}
