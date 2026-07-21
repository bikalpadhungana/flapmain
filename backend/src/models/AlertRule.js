const mongoose = require('mongoose');

const AlertConditionSchema = new mongoose.Schema(
  {
    field: {
      type: String,
      required: true,
    },
    operator: {
      type: String,
      enum: ['>', '<', '==', '!='],
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { _id: false }
);

const AlertActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['actuator', 'webhook'],
      required: true,
    },
    target: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const AlertRuleSchema = new mongoose.Schema(
  {
    device_id: {
      type: String,
      required: true,
    },
    org_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Org',
      required: true,
    },
    condition: {
      type: AlertConditionSchema,
      required: true,
    },
    action: {
      type: AlertActionSchema,
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

AlertRuleSchema.index({ device_id: 1, enabled: 1 });
AlertRuleSchema.index({ org_id: 1 });

module.exports = mongoose.model('AlertRule', AlertRuleSchema);
