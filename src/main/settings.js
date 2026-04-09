const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

let state = null;
let settingsFile = null;

function defaultLibraryPath() {
  return path.join(app.getPath('userData'), 'library');
}

function defaults() {
  return {
    falApiKey: '',
    libraryPath: defaultLibraryPath(),
    lastFolder: '',
    lastModelId: 'fal-ai/flux/schnell',
    starredModelIds: [],
  };
}

async function init() {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  settingsFile = path.join(dir, 'settings.json');
  try {
    const raw = await fs.readFile(settingsFile, 'utf8');
    state = { ...defaults(), ...JSON.parse(raw) };
  } catch (e) {
    state = defaults();
    await save();
  }
  return state;
}

async function save() {
  await fs.writeFile(settingsFile, JSON.stringify(state, null, 2), 'utf8');
}

function getAll() {
  return { ...state };
}

function get(key) {
  return state ? state[key] : undefined;
}

async function update(patch) {
  state = { ...state, ...patch };
  await save();
  return getAll();
}

module.exports = { init, getAll, get, update, defaultLibraryPath };
