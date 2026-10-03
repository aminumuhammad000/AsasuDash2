const crypto = require('node:crypto');

function polyfill() {
  const getRandomValues = function (typedArray) {
    if (crypto.webcrypto && typeof crypto.webcrypto.getRandomValues === 'function') {
      return crypto.webcrypto.getRandomValues(typedArray);
    }
    return crypto.randomFillSync(typedArray);
  };

  if (typeof crypto.getRandomValues !== 'function') {
    try {
      Object.defineProperty(crypto, 'getRandomValues', {
        value: getRandomValues,
        writable: true,
        configurable: true,
        enumerable: true
      });
    } catch {
      crypto.getRandomValues = getRandomValues;
    }
  }

  if (typeof globalThis.crypto === 'undefined') {
    try {
      globalThis.crypto = crypto.webcrypto || {};
    } catch {}
  }

  if (typeof globalThis.crypto.getRandomValues !== 'function') {
    try {
      globalThis.crypto.getRandomValues = getRandomValues;
    } catch {}
  }
}

polyfill();
module.exports = polyfill;
