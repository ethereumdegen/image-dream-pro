const fs = require('fs');
const path = require('path');

let cache = null;

function load() {
  if (cache) return cache;
  const file = path.join(__dirname, 'models.json');
  const raw = fs.readFileSync(file, 'utf8');
  cache = JSON.parse(raw);
  return cache;
}

function list() {
  return load().models;
}

function get(id) {
  return list().find((m) => m.id === id) || null;
}

module.exports = { list, get };
