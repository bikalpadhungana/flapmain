const mongoose = require('mongoose');

const FieldDefinitionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['number', 'boolean', 'string'],
      required: true,
    },
    unit: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

const DeviceTypeSchema = new mongoose.Schema(
  {
    device_type: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    display_name: {
      type: String,
      required: true,
      trim: true,
    },
    fields: {
      type: Map,
      of: FieldDefinitionSchema,
      required: true,
    },
    commands: {
      type: [String],
      default: [],
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('DeviceType', DeviceTypeSchema);
