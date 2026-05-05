'use strict';

const crypto = require('crypto');

// FIX: genId should return a 20-byte Buffer (not recreate on every call)
let id = null;

function genId() {
  if (!id) {
    id = Buffer.alloc(20);
    // Use Azureus-style: -AT0001- + 12 random bytes
    Buffer.from('-AT0001-').copy(id, 0);
    crypto.randomBytes(12).copy(id, 8);
  }
  return id;
}

module.exports = { genId };
