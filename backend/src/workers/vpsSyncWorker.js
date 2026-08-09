const TapLog = require('../models/TapLog');

// A background daemon to securely sync offline taps to the VPS
const startVpsSyncWorker = () => {
  const syncInterval = 10000; // Check every 10 seconds
  const mainServerUrl = process.env.FLAP_SERVER_URL || 'http://92.113.147.155:5001/api/device/tap';

  console.log(`[SYNC WORKER] Store-and-Forward Daemon started. Syncing to: ${mainServerUrl}`);

  setInterval(async () => {
    try {
      // Find up to 50 taps that haven't been successfully sent to the main VPS yet
      const pendingTaps = await TapLog.find({ forwardedMain: false }).limit(50);

      if (pendingTaps.length === 0) return;

      console.log(`[SYNC WORKER] Found ${pendingTaps.length} pending offline taps. Syncing...`);
      let consecutiveRejections = 0;

      for (const tap of pendingTaps) {
        if (consecutiveRejections >= 5) {
          console.error('[SYNC WORKER] FATAL: Reached 5 consecutive rejected taps. Pausing sync batch to prevent flood.');
          break;
        }

        try {
          const payload = {
            device_id: tap.device_id,
            api_key: tap.api_key || '',
            business_id: tap.business_id,
            flapid: tap.flapid,
            uid: tap.uid,
            tag_uid: tap.uid,
            tag_type: tap.tag_type,
            type: tap.type,
            timestamp: tap.timestamp,
          };

          const ctrl = new AbortController();
          const timeoutId = setTimeout(() => ctrl.abort(), 5000);

          const response = await fetch(mainServerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            consecutiveRejections = 0; // Reset on success
            const jsonResponse = await response.json().catch(() => null);
            tap.forwardedMain = true;
            tap.targetResponse = jsonResponse;
            await tap.save();
            console.log(`[SYNC WORKER] Successfully synced tap ${tap._id}`);
          } else if (response.status >= 400 && response.status < 500) {
            consecutiveRejections++;
            console.warn(`[SYNC WORKER] VPS rejected tap ${tap._id} with status ${response.status}. Stopping retries for this tap.`);
            const jsonResponse = await response.json().catch(() => null);
            tap.forwardedMain = true; 
            tap.targetResponse = { error: `Rejected with status ${response.status}`, details: jsonResponse };
            await tap.save();
          } else {
            console.warn(`[SYNC WORKER] VPS returned status ${response.status} for tap ${tap._id}. Will retry later.`);
          }
        } catch (fetchErr) {
          console.warn(`[SYNC WORKER] Sync failed for tap ${tap._id}: ${fetchErr.message}. Will retry later.`);
        }
      }
    } catch (dbErr) {
      console.error('[SYNC WORKER] Error querying pending taps:', dbErr.message);
    }
  }, syncInterval);
};

module.exports = { startVpsSyncWorker };
