'use strict';
const logger = require('./logger');
let io = null;
const setIO = (instance) => { io = instance; };
const getIO = () => io;

/** Emit to a room. Must only be called AFTER the DB transaction has committed. Never throws. */
function emit(room, event, payload) {
  try {
    if (io) io.to(room).emit(event, { ...payload, at: new Date().toISOString() });
  } catch (err) {
    logger.error('socket emit failed', { event, message: err.message });
  }
}
function disconnectUser(userId) {
  try { if (io) io.in(`user:${userId}`).disconnectSockets(true); } catch (err) { logger.error('socket disconnect failed', { message: err.message }); }
}
module.exports = { setIO, getIO, emit, disconnectUser };
