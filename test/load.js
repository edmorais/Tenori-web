// Loads dsp.js exactly as the page does: as plain source, no module system.
const fs = require('fs'), vm = require('vm'), path = require('path');
module.exports = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dsp.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.T=TENORI;', ctx);
  return { TenoriEngine: ctx.T.TenoriEngine, K: ctx.T };
};
