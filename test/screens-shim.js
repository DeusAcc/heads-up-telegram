// screens.js is an ES module for the browser bundle; load it from CommonJS tests.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../web/src/screens.js'), 'utf8').replace(/export /g, '');
module.exports = new Function(`${src}; return { pageFor, digestScreen };`)();
