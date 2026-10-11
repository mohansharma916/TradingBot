const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const expoEnv = require('@expo/env');

module.exports = ({ config }) => {
  // Expo export also reads config before loading dotenv. Initialize app-local
  // files first when NODE_ENV is already supplied by the shell or build.
  if (!process.env.NODE_ENV || !expoEnv.isEnabled()) return config;
  expoEnv.load(__dirname, { silent: true });

  const rootEnvPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(rootEnvPath)) {
    const rootEnv = dotenv.parse(fs.readFileSync(rootEnvPath));
    for (const [key, value] of Object.entries(rootEnv)) {
      if (key.startsWith('EXPO_PUBLIC_') && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  return config;
};
