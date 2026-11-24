const mongoose = require('mongoose');

// A compiled firmware image (.bin) uploaded from the dashboard for over-the-air updates.
// The file itself lives on disk (services/firmwareStore.js); this is its metadata.
const FirmwareSchema = new mongoose.Schema(
  {
    org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
    // Which sketch this image was built from, e.g. "esp_gateway_node". A device only
    // accepts an image whose board matches the FLAP_OTA_BOARD it reports.
    board: { type: String, required: true, trim: true },
    version: { type: String, required: true, trim: true },
    chip: { type: String, enum: ['esp8266', 'esp32', 'unknown'], default: 'unknown' },
    filename: { type: String, default: '' },
    size: { type: Number, required: true },
    md5: { type: String, required: true },
    sha256: { type: String, required: true },
    notes: { type: String, default: '' },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

FirmwareSchema.index({ org_id: 1, board: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('Firmware', FirmwareSchema);
