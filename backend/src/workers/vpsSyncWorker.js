const TapLog = require('../models/TapLog');

// A background daemon to securely sync offline taps to the VPS.
//
// Uses a self-scheduling loop (setTimeout after each batch completes) instead of
// setInterval: a batch can take up to 50 x 5s = 250s when the VPS is slow, and
// setInterval would start overlapping batches that re-send the same taps.
const SYNC_INTERVAL_MS = 10000;
const BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 5000;

const startVpsSyncWorker = () => {
  // Same default as the live /tap forwarding path in routes/devices.js
  // (previously this fell back to a different, plain-HTTP IP address).
  const mainServerUrl = process.env.FLAP_SERVER_URL || 'https://flap.esainnovation.com/api/device/tap';
  if (mainServerUrl.startsWith('http://')) {
    console.warn('[SYNC WORKER] FLAP_SERVER_URL uses plain HTTP; tap data and API keys are sent unencrypted.');
  }

  console.log(`[SYNC WORKER] Store-and-Forward Daemon started. Syncing to: ${mainServerUrl}`);

  const runBatch = async () => {
    try {
      const pendingTaps = await TapLog.find({ forwardedMain: false })
        .select('+api_key')
        .sort({ timestamp: 1 })
        .limit(BATCH_SIZE);

      if (pendingTaps.length === 0) return;

      console.log(`[SYNC WORKER] Found ${pendingTaps.length} pending offline taps. Syncing...`);
      let consecutiveRejections = 0;

      for (const tap of pendingTaps) {
        if (consecutiveRejections >= 5) {
          console.error('[SYNC WORKER] Reached 5 consecutive rejected taps. Pausing sync batch to prevent flood.');
          break;
        }

        try {
          const payload = {
            device_id: tap.device_id,
            // Same precedence as the live /tap forwarding path: dedicated S2S key first.
            api_key: process.env.FLAP_SERVER_API_KEY || tap.api_key || '',
            business_id: tap.business_id,
            flapid: tap.flapid,
            uid: tap.uid,
            tag_uid: tap.uid,
            tag_type: tap.tag_type,
            type: tap.type,
            timestamp: tap.timestamp,
          };

          const ctrl = new AbortController();
          const timeoutId = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
          let response;
          try {
            response = await fetch(mainServerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          if (response.ok) {
            consecutiveRejections = 0;
            tap.forwardedMain = true;
            tap.targetResponse = await response.json().catch(() => null);
            tap.api_key = ''; // no longer needed once synced
            await tap.save();
            console.log(`[SYNC WORKER] Successfully synced tap ${tap._id}`);
          } else if (response.status >= 400 && response.status < 500) {
            consecutiveRejections++;
            console.warn(`[SYNC WORKER] VPS rejected tap ${tap._id} with status ${response.status}. Stopping retries for this tap.`);
            tap.forwardedMain = true;
            tap.targetResponse = { error: `Rejected with status ${response.status}`, details: await response.json().catch(() => null) };
            tap.api_key = '';
            await tap.save();
          } else {
            console.warn(`[SYNC WORKER] VPS returned status ${response.status} for tap ${tap._id}. Will retry later.`);
          }
        } catch (fetchErr) {
          console.warn(`[SYNC WORKER] Sync failed for tap ${tap._id}: ${fetchErr.message}. Will retry later.`);
          // VPS unreachable: stop this batch rather than timing out on every remaining tap.
          break;
        }
      }
    } catch (dbErr) {
      console.error('[SYNC WORKER] Error querying pending taps:', dbErr.message);
    }
  };

  const loop = async () => {
    await runBatch();
    setTimeout(loop, SYNC_INTERVAL_MS).unref?.();
  };
  setTimeout(loop, SYNC_INTERVAL_MS);
};

module.exports = { startVpsSyncWorker };
