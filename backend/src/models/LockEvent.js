const mongoose = require('mongoose');

// Audit log for door locks: every unlock / lock, who or what caused it.
const LockEventSchema = new mongoose.Schema(
  {
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', required: true },
    device_id: { type: String, required: true },
    // requested: dashboard asked; unlocked / locked: the lock reports it happened;
    // expired: the lock did not pick the command up in time; boot: the lock restarted
    event: { type: String, enum: ['requested', 'unlocked', 'locked', 'expired', 'boot'], required: true },
    action: { type: String, enum: ['unlock', 'lock', ''], default: '' },
    // dashboard | magnet | button | boot | timer
    source: { type: String, default: '' },
    by: { type: String, default: '' }, // dashboard user who asked
    command_id: { type: String, default: '' },
    message: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

LockEventSchema.index({ device_id: 1, timestamp: -1 });
LockEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 180 * 24 * 3600 }); // keep 180 days

module.exports = mongoose.model('LockEvent', LockEventSchema);
