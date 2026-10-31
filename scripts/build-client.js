// Wraps src/Logic.js in a <script> block so the browser page uses the same code as the server and tests.
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src');
const logic = fs.readFileSync(path.join(src, 'Logic.js'), 'utf8');
fs.writeFileSync(path.join(src, 'LogicClient.html'), '<script>\n' + logic + '</script>\n');
