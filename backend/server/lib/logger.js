'use strict';
const fs = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');
const config = require('../config');

fs.mkdirSync(config.logDir, { recursive: true });

const transports = [];
if (!config.isTest) {
  transports.push(new winston.transports.Console());
  transports.push(new winston.transports.DailyRotateFile({
    dirname: config.logDir, filename: 'app-%DATE%.log', datePattern: 'YYYY-MM-DD', maxSize: '20m', maxFiles: '14d', zippedArchive: true,
  }));
  transports.push(new winston.transports.DailyRotateFile({
    dirname: config.logDir, filename: 'error-%DATE%.log', level: 'error', datePattern: 'YYYY-MM-DD', maxSize: '20m', maxFiles: '30d', zippedArchive: true,
  }));
} else {
  transports.push(new winston.transports.Console({ silent: true }));
}

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  transports,
});

// Security events get a dedicated tag so they are easy to grep / alert on.
logger.security = (event, meta = {}) => logger.warn(event, { security: true, ...meta });
module.exports = logger;
