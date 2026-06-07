'use strict';

const path    = require('path');
const os      = require('os');
const winston = require('winston');

const LOG_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent', 'logs');

const { combine, timestamp, printf } = winston.format;

const fmt = printf(({ level, message, timestamp: ts }) =>
  `${ts}  [${level.toUpperCase()}]  ${message}`
);

const logger = winston.createLogger({
  level: 'info',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), fmt),
  transports: [
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'agent.log'),
      maxsize:  5 * 1024 * 1024,
      maxFiles: 3,
    }),
    new winston.transports.Console(),
  ],
});

module.exports = logger;
